import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, setDoc, getDocs, doc, query, where, orderBy, onSnapshot, serverTimestamp, updateDoc, arrayUnion, arrayRemove, increment, deleteField, getDoc } 
from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyAo_QQ_3i_GmQsyi3tTUWwmJK09z_Y3sNM",
    authDomain: "chatapp-e007a.firebaseapp.com",
    projectId: "chatapp-e007a",
    storageBucket: "chatapp-e007a.firebasestorage.app",
    messagingSenderId: "853709166914",
    appId: "1:853709166914:web:21f0bb1b8e03a796b010db"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// --- VARIABLES ---
let currentUser = null;
let selectedChatUser = null;
let unsubscribeMessages = null;
let friendListeners = []; 
let mediaRecorder = null;
let audioChunks = [];
let selectedAvatarBase64 = null;

const getEl = (id) => document.getElementById(id);

// --- 1. GLOBAL REQUEST HANDLER ---
window.respondRequest = async function(targetUid, isAccepted) {
    if (!currentUser) return;
    try {
        const myRef = doc(db, "users", currentUser.uid);
        const theirRef = doc(db, "users", targetUid);

        // Remove request
        await updateDoc(myRef, { friendRequests: arrayRemove(targetUid) });

        if (isAccepted) {
            await updateDoc(myRef, { friends: arrayUnion(targetUid) });
            await updateDoc(theirRef, { friends: arrayUnion(currentUser.uid) });
            alert("Friend added!");
        }
        
        // Refresh modal if empty
        const modal = getEl('requests-modal');
        if (!currentUser.friendRequests || currentUser.friendRequests.length <= 1) {
            modal.classList.add('hidden');
        }

    } catch(e) { console.error(e); alert("Error: " + e.message); }
};

// --- 2. MODAL LOGIC ---
const requestsBtn = getEl('requests-btn');
const requestsModal = getEl('requests-modal');
const closeRequestsBtn = getEl('close-requests-btn');

requestsBtn.addEventListener('click', () => {
    requestsModal.classList.remove('hidden');
    // Re-render requests when opening to ensure freshness
    if (currentUser && currentUser.friendRequests) {
        renderRequestsModal(currentUser.friendRequests);
    }
});

closeRequestsBtn.addEventListener('click', () => {
    requestsModal.classList.add('hidden');
});

// --- 3. AVATAR UPLOAD ---
getEl('avatar-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        if (file.size > 100000) return alert("Image too big! Max 100KB.");
        const reader = new FileReader();
        reader.onload = (ev) => {
            selectedAvatarBase64 = ev.target.result;
            getEl('avatar-preview-img').src = selectedAvatarBase64;
            getEl('avatar-overlay').classList.add('hidden');
        };
        reader.readAsDataURL(file);
    }
});

// --- 4. LOGIN ---
getEl('login-btn').addEventListener('click', async () => {
    const username = getEl('login-username').value.trim().toLowerCase();
    if (!username) return alert("Enter a username");
    
    getEl('login-btn').innerText = "Entering...";
    getEl('login-btn').disabled = true;

    try {
        const q = query(collection(db, "users"), where("username", "==", username));
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
            snapshot.forEach(doc => currentUser = doc.data());
            if (selectedAvatarBase64) {
                await updateDoc(doc(db, "users", currentUser.uid), { photoURL: selectedAvatarBase64 });
                currentUser.photoURL = selectedAvatarBase64;
            }
        } else {
            const newUid = "u_" + Date.now();
            const defaultAvatar = `https://ui-avatars.com/api/?name=${username}&background=22c55e&color=000`;
            const newUser = {
                uid: newUid,
                username: username,
                displayName: username,
                photoURL: selectedAvatarBase64 || defaultAvatar,
                friends: [],
                friendRequests: [], 
                unread: {},         
                isOnline: true,
                createdAt: serverTimestamp()
            };
            await setDoc(doc(db, "users", newUid), newUser);
            currentUser = newUser;
        }

        await updateDoc(doc(db, "users", currentUser.uid), { 
            isOnline: true,
            lastSeen: serverTimestamp() 
        });

        getEl('login-screen').classList.add('hidden');
        getEl('app-screen').classList.remove('hidden');
        getEl('my-avatar').src = currentUser.photoURL;
        
        loadData(); 
        setupPresenceSystem();

    } catch (err) {
        console.error(err);
        alert("LOGIN ERROR: " + err.message);
        getEl('login-btn').innerText = "Enter Shotta";
        getEl('login-btn').disabled = false;
    }
});

// --- 5. DATA LOADING ---
function loadData() {
    onSnapshot(doc(db, "users", currentUser.uid), (docSnap) => {
        const data = docSnap.data();
        if(!data) return;
        currentUser = data; 

        // HANDLE REQUESTS ICON & BADGE
        const reqBtn = getEl('requests-btn');
        const reqBadge = getEl('requests-badge');
        
        if (data.friendRequests && data.friendRequests.length > 0) {
            reqBtn.classList.remove('hidden'); // Show Bell
            reqBadge.classList.remove('hidden'); // Show Red Dot
            
            // If modal is open, refresh the list live
            if (!getEl('requests-modal').classList.contains('hidden')) {
                renderRequestsModal(data.friendRequests);
            }
        } else {
            reqBtn.classList.add('hidden'); // Hide Bell if no requests
            getEl('requests-modal').classList.add('hidden'); // Close modal if empty
        }

        // RENDER FRIENDS
        renderFriendsList(data.friends || [], data.unread || {});
    });
}

// --- 6. RENDER REQUESTS MODAL ---
async function renderRequestsModal(requestUids) {
    const container = getEl('requests-list-container');
    container.innerHTML = ""; // Clear existing
    
    if (!requestUids || requestUids.length === 0) {
        container.innerHTML = `<p class="text-center text-gray-500 py-4">No pending requests.</p>`;
        return;
    }

    for (const uid of requestUids) {
        try {
            // Cleanup: If already friend, remove request
            if (currentUser.friends.includes(uid)) {
                updateDoc(doc(db, "users", currentUser.uid), { friendRequests: arrayRemove(uid) });
                continue;
            }

            const userDoc = await getDoc(doc(db, "users", uid));
            
            // Cleanup: If user deleted, remove request
            if (!userDoc.exists()) {
                updateDoc(doc(db, "users", currentUser.uid), { friendRequests: arrayRemove(uid) });
                continue;
            }

            const uData = userDoc.data();

            const div = document.createElement('div');
            div.className = "flex items-center justify-between p-3 mb-2 bg-gray-800 rounded-xl border border-gray-700";
            
            div.innerHTML = `
                <div class="flex items-center gap-3">
                    <img src="${uData.photoURL}" class="w-12 h-12 rounded-full border-2 border-gray-600 object-cover">
                    <div class="flex flex-col">
                        <span class="text-sm font-bold text-white">${uData.displayName}</span>
                        <span class="text-[10px] text-gray-400">Wants to chat</span>
                    </div>
                </div>
                <div class="flex gap-2">
                    <button onclick="window.respondRequest('${uData.uid}', true)" class="bg-green-600 hover:bg-green-500 text-white p-2 rounded-lg transition shadow-lg" title="Accept">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" /></svg>
                    </button>
                    <button onclick="window.respondRequest('${uData.uid}', false)" class="bg-red-600 hover:bg-red-500 text-white p-2 rounded-lg transition shadow-lg" title="Decline">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>
                    </button>
                </div>
            `;
            container.appendChild(div);
        } catch(e) { console.error(e); }
    }
}

// --- 7. RENDER FRIENDS ---
function renderFriendsList(friendsList, unreadMap) {
    const listEl = getEl('friend-list');
    listEl.innerHTML = "";
    
    friendListeners.forEach(unsub => unsub());
    friendListeners = [];

    if (!friendsList.length) {
        listEl.innerHTML = `<div class="text-center text-gray-500 mt-10 text-xs">No chats yet. Add a friend!</div>`;
        return;
    }

    friendsList.forEach(friendUid => {
        const unsub = onSnapshot(doc(db, "users", friendUid), (fSnap) => {
            if (!fSnap.exists()) return;
            const fData = fSnap.data();
            
            let isOnline = false;
            if (fData.lastSeen) {
                const lastSeenTime = fData.lastSeen.toMillis ? fData.lastSeen.toMillis() : 0;
                isOnline = (Date.now() - lastSeenTime) < 65000;
            }
            
            const unreadCount = unreadMap[fData.uid] || 0;
            const unreadBadge = unreadCount > 0 
                ? `<div class="bg-red-500 text-white text-[10px] font-bold h-5 min-w-[1.25rem] px-1 flex items-center justify-center rounded-full shadow-lg shadow-red-900 animate-pulse">${unreadCount}</div>` 
                : '';
            
            const isActive = selectedChatUser && selectedChatUser.uid === fData.uid;
            const bgClass = isActive ? "bg-green-900/20 border-green-500/30" : "hover:bg-gray-900 border-transparent hover:border-gray-800";

            let card = document.getElementById(`friend-${fData.uid}`);
            const html = `
                <div class="relative">
                    <img src="${fData.photoURL || 'https://ui-avatars.com/api/?name=?'}" class="w-12 h-12 rounded-full border border-gray-700 object-cover bg-gray-800">
                    <div class="absolute bottom-0 right-0 w-3.5 h-3.5 ${isOnline ? "bg-green-500" : "bg-gray-600"} rounded-full border-2 border-black"></div>
                </div>
                <div class="flex-1 min-w-0">
                    <div class="flex justify-between items-center">
                        <p class="font-bold text-gray-200 capitalize text-sm truncate">${fData.displayName}</p>
                        ${unreadBadge}
                    </div>
                    <p class="text-[10px] ${isOnline ? 'text-green-500' : 'text-gray-500'} uppercase tracking-wider font-semibold">
                        ${isOnline ? "Online" : "Offline"}
                    </p>
                </div>
            `;

            if (card) { 
                card.innerHTML = html;
                card.className = `p-3 rounded-xl cursor-pointer flex items-center gap-3 transition border ${bgClass}`;
            } else {
                card = document.createElement("div");
                card.id = `friend-${fData.uid}`;
                card.className = `p-3 rounded-xl cursor-pointer flex items-center gap-3 transition border ${bgClass}`;
                card.innerHTML = html;
                card.onclick = () => openChat(fData);
                listEl.appendChild(card);
            }

            if (isActive) {
                const statusEl = getEl('chat-header-status');
                if(statusEl) {
                    statusEl.innerText = isOnline ? "Online" : "Offline";
                    statusEl.className = isOnline ? "text-xs text-green-500 font-bold" : "text-xs text-gray-500";
                }
            }
        });
        friendListeners.push(unsub);
    });
}

// --- 8. SEND REQUEST BUTTON ---
getEl('add-friend-btn').addEventListener('click', async () => {
    const input = prompt("Enter username to add:");
    if (!input) return;
    try {
        const q = query(collection(db, "users"), where("username", "==", input.toLowerCase().trim()));
        const snapshot = await getDocs(q);
        if (snapshot.empty) return alert("User not found");
        
        let friendDoc = snapshot.docs[0];
        let friendID = friendDoc.data().uid;

        if (friendID === currentUser.uid) return alert("Cannot add yourself");
        if (currentUser.friends && currentUser.friends.includes(friendID)) return alert("Already friends!");

        await updateDoc(doc(db, "users", friendID), { 
            friendRequests: arrayUnion(currentUser.uid) 
        });
        alert("Friend request sent!");

    } catch(e) { alert("Error: " + e.message); }
});

// --- 9. CHAT LOGIC ---
window.openChat = async (friend) => {
    selectedChatUser = friend;
    getEl('sidebar').classList.add('hidden');
    getEl('sidebar').classList.remove('flex');
    getEl('chat-area').classList.remove('hidden');
    getEl('chat-area').classList.add('flex');

    getEl('chat-header-name').innerText = friend.displayName;
    getEl('chat-header-img').src = friend.photoURL;

    if (currentUser.unread && currentUser.unread[friend.uid]) {
        await updateDoc(doc(db, "users", currentUser.uid), {
            [`unread.${friend.uid}`]: deleteField()
        });
    }

    loadMessages();
    renderFriendsList(currentUser.friends, currentUser.unread || {}); 
};

getEl('back-btn').addEventListener('click', () => {
    selectedChatUser = null;
    if (unsubscribeMessages) unsubscribeMessages();
    getEl('sidebar').classList.remove('hidden');
    getEl('sidebar').classList.add('flex');
    getEl('chat-area').classList.add('hidden');
    getEl('chat-area').classList.remove('flex');
    renderFriendsList(currentUser.friends, currentUser.unread || {}); 
});

function getChatID() {
    return [currentUser.uid, selectedChatUser.uid].sort().join("_");
}

function loadMessages() {
    if (unsubscribeMessages) unsubscribeMessages();
    const q = query(collection(db, "chats", getChatID(), "messages"), orderBy("createdAt", "asc"));
    unsubscribeMessages = onSnapshot(q, (snapshot) => {
        const list = getEl('msg-list');
        list.innerHTML = "";
        if (snapshot.empty) {
            list.innerHTML = `<div class="text-center text-gray-600 mt-10 text-xs">No messages yet.</div>`;
            return;
        }
        snapshot.forEach(doc => {
            const data = doc.data();
            const isMe = data.senderId === currentUser.uid;
            
            let timeString = "...";
            if (data.createdAt && data.createdAt.seconds) {
                timeString = new Date(data.createdAt.seconds * 1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            }

            let contentHtml = "";
            if (data.type === "audio") {
                contentHtml = `<div class="flex items-center gap-2"><span class="text-xs">🎤 Voice</span><audio controls src="${data.content}" class="h-8 w-48 rounded bg-transparent"></audio></div>`;
            } else {
                contentHtml = `<p class="break-words">${data.content}</p>`;
            }

            const div = document.createElement("div");
            div.className = `flex w-full ${isMe ? 'justify-end' : 'justify-start'} mb-4`;
            div.innerHTML = `
                <div class="max-w-[75%] p-3 rounded-2xl text-sm shadow-sm relative group ${isMe ? 'bg-green-600 text-black rounded-tr-none' : 'bg-gray-800 text-white rounded-tl-none'}">
                    ${contentHtml}
                    <p class="text-[9px] opacity-60 text-right mt-1 font-mono">${timeString}</p>
                </div>
            `;
            list.appendChild(div);
        });
        setTimeout(() => list.scrollTop = list.scrollHeight, 100);
    });
}

getEl('send-btn').addEventListener('click', async () => {
    const input = getEl('msg-input');
    const text = input.value.trim();
    if (!text || !selectedChatUser) return;
    try {
        await addDoc(collection(db, "chats", getChatID(), "messages"), {
            content: text, senderId: currentUser.uid, createdAt: serverTimestamp(), type: "text"
        });
        await updateDoc(doc(db, "users", selectedChatUser.uid), {
            [`unread.${currentUser.uid}`]: increment(1)
        });
        input.value = "";
    } catch (e) { alert("SEND FAILED: " + e.message); }
});

// --- PRESENCE & AUDIO ---
function setupPresenceSystem() {
    setInterval(() => {
        if (currentUser) {
            updateDoc(doc(db, "users", currentUser.uid), { isOnline: true, lastSeen: serverTimestamp() });
        }
    }, 30000);
    window.addEventListener('beforeunload', () => setOffline());
}
async function setOffline() {
    if (currentUser) await updateDoc(doc(db, "users", currentUser.uid), { isOnline: false });
}
getEl('logout-btn').addEventListener('click', async () => {
    await setOffline();
    location.reload();
});

const micBtn = getEl('mic-btn');
const startRecording = async () => {
    if (!navigator.mediaDevices) return alert("Mic blocked.");
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
        mediaRecorder.onstop = async () => {
            stream.getTracks().forEach(t => t.stop());
            const blob = new Blob(audioChunks, { type: 'audio/webm' });
            const reader = new FileReader();
            reader.readAsDataURL(blob);
            reader.onloadend = async () => {
                const base64 = reader.result;
                if(base64.length > 800000) return alert("Too long!");
                try {
                    await addDoc(collection(db, "chats", getChatID(), "messages"), {
                        content: base64, senderId: currentUser.uid, createdAt: serverTimestamp(), type: "audio"
                    });
                    await updateDoc(doc(db, "users", selectedChatUser.uid), {
                        [`unread.${currentUser.uid}`]: increment(1)
                    });
                } catch(e) { alert("Failed: " + e.message); }
            };
        };
        mediaRecorder.start();
        micBtn.classList.add('text-red-500', 'animate-pulse');
    } catch(e) { alert("Permission Denied"); }
};
const stopRecording = () => {
    if (mediaRecorder && mediaRecorder.state === "recording") {
        mediaRecorder.stop();
        micBtn.classList.remove('text-red-500', 'animate-pulse');
    }
};
micBtn.addEventListener('mousedown', startRecording);
micBtn.addEventListener('mouseup', stopRecording);
micBtn.addEventListener('touchstart', (e) => { e.preventDefault(); startRecording(); });
micBtn.addEventListener('touchend', (e) => { e.preventDefault(); stopRecording(); });

