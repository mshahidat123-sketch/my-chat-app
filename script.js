import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, setDoc, getDocs, doc, query, where, orderBy, onSnapshot, serverTimestamp, updateDoc, arrayUnion, getDoc } 
from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ==========================================
// PASTE YOUR FIREBASE CONFIG HERE
// ==========================================
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

// --- 1. AVATAR UPLOAD PREVIEW ---
getEl('avatar-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        // Limit to 100KB to ensure Firestore can save it and others can load it fast
        if (file.size > 100000) return alert("Image too large! Please use a smaller image.");
        
        const reader = new FileReader();
        reader.onload = (ev) => {
            selectedAvatarBase64 = ev.target.result;
            getEl('avatar-preview-img').src = selectedAvatarBase64;
            getEl('avatar-overlay').classList.add('hidden');
        };
        reader.readAsDataURL(file);
    }
});

// --- 2. LOGIN / REGISTER ---
getEl('login-btn').addEventListener('click', async () => {
    const username = getEl('login-username').value.trim().toLowerCase();
    if (!username) return alert("Enter a username");
    
    getEl('login-btn').innerText = "Entering...";
    getEl('login-btn').disabled = true;

    try {
        const q = query(collection(db, "users"), where("username", "==", username));
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
            // --- LOGIN EXISTING USER ---
            snapshot.forEach(doc => currentUser = doc.data());
            
            // If they just uploaded a new photo, update it in the database
            if (selectedAvatarBase64) {
                await updateDoc(doc(db, "users", currentUser.uid), { photoURL: selectedAvatarBase64 });
                currentUser.photoURL = selectedAvatarBase64;
            }
        } else {
            // --- REGISTER NEW USER ---
            const newUid = "u_" + Date.now();
            
            // Default Avatar (Initials) if no photo uploaded
            const defaultAvatar = `https://ui-avatars.com/api/?name=${username}&background=22c55e&color=000`;
            const finalAvatar = selectedAvatarBase64 || defaultAvatar;

            const newUser = {
                uid: newUid,
                username: username,
                displayName: username,
                photoURL: finalAvatar,
                friends: [],
                isOnline: true,
                createdAt: serverTimestamp()
            };
            await setDoc(doc(db, "users", newUid), newUser);
            currentUser = newUser;
        }

        // Set Online Status immediately
        await updateDoc(doc(db, "users", currentUser.uid), { isOnline: true });

        // Switch Screens
        getEl('login-screen').classList.add('hidden');
        getEl('app-screen').classList.remove('hidden');
        
        // Load MY Profile Pic (with fallback)
        getEl('my-avatar').src = currentUser.photoURL || `https://ui-avatars.com/api/?name=${currentUser.username}`;
        
        loadFriendsList();
        setupPresenceSystem();

    } catch (err) {
        console.error(err);
        alert("Login failed: " + err.message);
        getEl('login-btn').innerText = "Enter Shotta";
        getEl('login-btn').disabled = false;
    }
});

// --- 3. FIX: ROBUST ONLINE/OFFLINE SYSTEM ---
function setupPresenceSystem() {
    // 1. If tab is closed or reloaded
    window.addEventListener('beforeunload', () => {
        setOffline();
    });

    // 2. If user switches tabs or minimizes app (Mobile Fix)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            updateDoc(doc(db, "users", currentUser.uid), { isOnline: true });
        } else {
            setOffline();
        }
    });
}

async function setOffline() {
    if (currentUser) {
        // We use Beacon API for reliability on page close
        const data = new Blob([JSON.stringify({ isOnline: false })], { type: 'application/json; charset=UTF-8' });
        // Note: Firestore doesn't support sendBeacon natively easily, so we try standard update
        // The visibilitychange listener handles 90% of mobile cases
        await updateDoc(doc(db, "users", currentUser.uid), { isOnline: false });
    }
}

getEl('logout-btn').addEventListener('click', async () => {
    await setOffline();
    location.reload();
});

// --- 4. FRIEND LIST (FIXED PFP VISIBILITY) ---
getEl('add-friend-btn').addEventListener('click', async () => {
    const input = prompt("Enter username to add:");
    if (!input) return;
    
    // Search for user
    const q = query(collection(db, "users"), where("username", "==", input.toLowerCase().trim()));
    const snapshot = await getDocs(q);

    if (snapshot.empty) return alert("User not found");
    
    let friendID = null;
    snapshot.forEach(doc => friendID = doc.data().uid);
    
    if (friendID === currentUser.uid) return alert("Cannot add yourself");

    // Add to my friend list
    await updateDoc(doc(db, "users", currentUser.uid), { friends: arrayUnion(friendID) });
});

function loadFriendsList() {
    onSnapshot(doc(db, "users", currentUser.uid), (docSnap) => {
        const data = docSnap.data();
        const listEl = getEl('friend-list');
        listEl.innerHTML = "";
        
        // Clean up old listeners
        friendListeners.forEach(unsub => unsub());
        friendListeners = [];

        if (!data?.friends?.length) {
            listEl.innerHTML = `<div class="text-center text-gray-500 mt-10 text-xs">No friends yet.</div>`;
            return;
        }

        // Listen to each friend
        data.friends.forEach(friendUid => {
            const unsub = onSnapshot(doc(db, "users", friendUid), (fSnap) => {
                if (!fSnap.exists()) return;
                const fData = fSnap.data();
                
                // --- FIX: IMAGE FALLBACK ---
                // If photoURL is empty/undefined, generate one based on name
                const displayPhoto = fData.photoURL && fData.photoURL.length > 10 
                    ? fData.photoURL 
                    : `https://ui-avatars.com/api/?name=${fData.username}&background=333&color=fff`;

                const isOnline = fData.isOnline === true;
                const statusColor = isOnline ? "bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.6)]" : "bg-gray-600";
                
                // Check if element exists to update or create
                let card = document.getElementById(`friend-${fData.uid}`);
                
                const html = `
                    <div class="relative">
                        <img src="${displayPhoto}" class="w-12 h-12 rounded-full border border-gray-700 object-cover bg-gray-800">
                        <div class="absolute bottom-0 right-0 w-3.5 h-3.5 ${statusColor} rounded-full border-2 border-black"></div>
                    </div>
                    <div>
                        <p class="font-bold text-gray-200 capitalize text-sm">${fData.displayName}</p>
                        <p class="text-[10px] ${isOnline ? 'text-green-500' : 'text-gray-500'} uppercase tracking-wider font-semibold">
                            ${isOnline ? "Online" : "Offline"}
                        </p>
                    </div>
                `;

                if (card) {
                    card.innerHTML = html;
                } else {
                    card = document.createElement("div");
                    card.id = `friend-${fData.uid}`;
                    card.className = "p-3 rounded-xl hover:bg-gray-900 cursor-pointer flex items-center gap-3 transition border border-transparent hover:border-gray-800";
                    card.innerHTML = html;
                    card.onclick = () => openChat(fData, displayPhoto); // Pass the verified photo
                    listEl.appendChild(card);
                }

                // Update Header if chatting with this person
                if (selectedChatUser && selectedChatUser.uid === fData.uid) {
                    getEl('chat-header-status').innerText = isOnline ? "Online" : "Offline";
                    getEl('chat-header-status').className = isOnline ? "text-xs text-green-500 font-bold" : "text-xs text-gray-500";
                }
            });
            friendListeners.push(unsub);
        });
    });
}

// --- 5. CHAT AREA ---
window.openChat = (friend, verifiedPhoto) => {
    selectedChatUser = friend;
    // Mobile Transition
    getEl('sidebar').classList.add('hidden');
    getEl('sidebar').classList.remove('flex');
    getEl('chat-area').classList.remove('hidden');
    getEl('chat-area').classList.add('flex');

    // Setup Header
    getEl('chat-header-name').innerText = friend.displayName;
    // Use the verified photo we calculated in the friend list
    getEl('chat-header-img').src = verifiedPhoto || friend.photoURL || `https://ui-avatars.com/api/?name=${friend.username}`;
    
    // Initial Status Check
    const isOnline = friend.isOnline === true;
    getEl('chat-header-status').innerText = isOnline ? "Online" : "Offline";
    getEl('chat-header-status').className = isOnline ? "text-xs text-green-500 font-bold" : "text-xs text-gray-500";

    loadMessages();
};

getEl('back-btn').addEventListener('click', () => {
    selectedChatUser = null;
    if (unsubscribeMessages) unsubscribeMessages();
    getEl('sidebar').classList.remove('hidden');
    getEl('sidebar').classList.add('flex');
    getEl('chat-area').classList.add('hidden');
    getEl('chat-area').classList.remove('flex');
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
        
        snapshot.forEach(doc => {
            const data = doc.data();
            const isMe = data.senderId === currentUser.uid;
            
            const div = document.createElement("div");
            div.className = `flex ${isMe ? 'justify-end' : 'justify-start'}`;
            
            let content = "";
            if (data.type === "audio") {
                content = `<audio controls src="${data.content}" class="h-8 w-48"></audio>`;
            } else {
                content = `<p class="break-words">${data.content}</p>`;
            }

            div.innerHTML = `
                <div class="max-w-[75%] p-3 rounded-2xl text-sm shadow-sm ${isMe ? 'bg-green-600 text-black rounded-tr-none' : 'bg-gray-800 text-white rounded-tl-none'}">
                    ${content}
                    <p class="text-[9px] opacity-50 text-right mt-1">
                        ${data.createdAt ? new Date(data.createdAt.seconds * 1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '...'}
                    </p>
                </div>
            `;
            list.appendChild(div);
        });
        // Auto Scroll to bottom
        setTimeout(() => list.scrollTop = list.scrollHeight, 100);
    });
}

// --- 6. SENDING ---
getEl('send-btn').addEventListener('click', async () => {
    const input = getEl('msg-input');
    const text = input.value.trim();
    if (!text || !selectedChatUser) return;
    
    await addDoc(collection(db, "chats", getChatID(), "messages"), {
        content: text, 
        senderId: currentUser.uid, 
        createdAt: serverTimestamp(), 
        type: "text"
    });
    input.value = "";
    getEl('msg-list').scrollTop = getEl('msg-list').scrollHeight;
});

// Audio Logic
const micBtn = getEl('mic-btn');
const startRecording = async () => {
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
                // Size Check for Audio
                if(base64.length > 500000) return alert("Audio too long!");
                
                await addDoc(collection(db, "chats", getChatID(), "messages"), {
                    content: base64, 
                    senderId: currentUser.uid, 
                    createdAt: serverTimestamp(), 
                    type: "audio"
                });
            };
        };
        mediaRecorder.start();
        micBtn.classList.add('text-red-500', 'animate-pulse');
    } catch(e) { alert("Mic permission denied"); }
};

const stopRecording = () => {
    if (mediaRecorder && mediaRecorder.state === "recording") {
        mediaRecorder.stop();
        micBtn.classList.remove('text-red-500', 'animate-pulse');
    }
};

// Handle Desktop & Mobile Touch for Mic
micBtn.addEventListener('mousedown', startRecording);
micBtn.addEventListener('mouseup', stopRecording);
micBtn.addEventListener('touchstart', (e) => { e.preventDefault(); startRecording(); });
micBtn.addEventListener('touchend', (e) => { e.preventDefault(); stopRecording(); });

