import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, setDoc, getDocs, doc, query, where, orderBy, onSnapshot, serverTimestamp, updateDoc, arrayUnion, getDoc } 
from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ============================================
// 1. CONFIGURATION (REPLACE THIS SECTION!)
// ============================================
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

// ============================================
// 2. STATE MANAGEMENT
// ============================================
let currentUser = null;
let selectedChatUser = null;
let unsubscribeMessages = null;
let mediaRecorder = null;
let audioChunks = [];
let selectedAvatarBase64 = null;

// ============================================
// 3. UI HELPER FUNCTIONS
// ============================================
const getEl = (id) => document.getElementById(id);

// --- Handle Avatar Upload Preview ---
getEl('avatar-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        if (file.size > 150000) return alert("Image too large! Use < 150KB"); // 150KB Limit
        const reader = new FileReader();
        reader.onload = (ev) => {
            selectedAvatarBase64 = ev.target.result;
            getEl('avatar-preview-img').src = selectedAvatarBase64;
            getEl('avatar-preview-img').classList.remove('opacity-50');
            getEl('avatar-overlay').classList.add('hidden');
        };
        reader.readAsDataURL(file);
    }
});

// ============================================
// 4. AUTHENTICATION & LOGIN
// ============================================
getEl('login-btn').addEventListener('click', async () => {
    const username = getEl('login-username').value.trim().toLowerCase();
    if (!username) return alert("Please enter a username");
    
    const btn = getEl('login-btn');
    btn.innerText = "Authenticating...";
    btn.disabled = true;

    try {
        const q = query(collection(db, "users"), where("username", "==", username));
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
            // Login existing
            snapshot.forEach(doc => currentUser = doc.data());
        } else {
            // Register new
            const newUid = "u_" + Date.now();
            const avatar = selectedAvatarBase64 || `https://ui-avatars.com/api/?name=${username}&background=22c55e&color=000`;
            
            const newUser = {
                uid: newUid,
                username: username,
                displayName: username,
                photoURL: avatar,
                friends: [],
                createdAt: serverTimestamp()
            };
            await setDoc(doc(db, "users", newUid), newUser);
            currentUser = newUser;
        }

        // Transition UI
        getEl('login-screen').classList.add('hidden');
        getEl('app-screen').classList.remove('hidden');
        getEl('my-avatar').src = currentUser.photoURL;
        loadFriendsList();

    } catch (err) {
        console.error(err);
        alert("Login Error: " + err.message);
        btn.innerText = "Start Messaging";
        btn.disabled = false;
    }
});

// ============================================
// 5. FRIEND SYSTEM
// ============================================
getEl('add-friend-btn').addEventListener('click', async () => {
    const input = prompt("Enter exact username to add:");
    if (!input) return;
    
    const q = query(collection(db, "users"), where("username", "==", input.toLowerCase().trim()));
    const snapshot = await getDocs(q);

    if (snapshot.empty) return alert("User not found.");
    
    let friendID = null;
    snapshot.forEach(doc => friendID = doc.data().uid);
    
    if (friendID === currentUser.uid) return alert("Can't add yourself.");
    
    await updateDoc(doc(db, "users", currentUser.uid), { 
        friends: arrayUnion(friendID) 
    });
});

function loadFriendsList() {
    onSnapshot(doc(db, "users", currentUser.uid), async (docSnap) => {
        const data = docSnap.data();
        const listEl = getEl('friend-list');
        listEl.innerHTML = "";
        
        if (!data?.friends?.length) {
            listEl.innerHTML = `<div class="text-center text-gray-600 mt-10 text-sm">No chats yet.<br>Click + to add friends.</div>`;
            return;
        }

        for (const uid of data.friends) {
            const fSnap = await getDoc(doc(db, "users", uid));
            if (fSnap.exists()) {
                const fData = fSnap.data();
                const div = document.createElement("div");
                div.className = "p-3 rounded-xl hover:bg-gray-800/50 cursor-pointer flex items-center gap-3 transition group";
                div.onclick = () => openChat(fData);
                div.innerHTML = `
                    <div class="relative">
                        <img src="${fData.photoURL}" class="w-12 h-12 rounded-full border border-gray-700 object-cover group-hover:border-green-500 transition">
                        <div class="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-black"></div>
                    </div>
                    <div>
                        <p class="font-bold text-gray-200 capitalize group-hover:text-green-400 transition">${fData.displayName}</p>
                        <p class="text-xs text-gray-500">Tap to chat</p>
                    </div>
                `;
                listEl.appendChild(div);
            }
        }
    });
}

// ============================================
// 6. CHAT LOGIC
// ============================================
window.openChat = (friend) => {
    selectedChatUser = friend;
    
    // UI Toggle for Mobile
    getEl('sidebar').classList.add('hidden');
    getEl('sidebar').classList.remove('flex'); // Fix for flex layout
    getEl('chat-area').classList.remove('hidden');
    getEl('chat-area').classList.add('flex');

    // Set Header
    getEl('chat-header-name').innerText = friend.displayName;
    getEl('chat-header-img').src = friend.photoURL;

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
                content = `<audio controls src="${data.content}" class="h-8 w-48 custom-audio"></audio>`;
            } else {
                content = `<p>${data.content}</p>`;
            }

            div.innerHTML = `
                <div class="max-w-[80%] p-3 rounded-2xl text-sm ${isMe ? 'bg-green-600 text-black rounded-tr-none' : 'bg-gray-800 text-white rounded-tl-none'}">
                    ${content}
                </div>
            `;
            list.appendChild(div);
        });
        list.scrollTop = list.scrollHeight;
    });
}

// ============================================
// 7. SENDING MESSAGES (TEXT & AUDIO)
// ============================================
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
});

// Audio Recording
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
        micBtn.classList.add('recording-pulse');
    } catch(e) {
        console.error(e);
        alert("Mic permission denied");
    }
};

const stopRecording = () => {
    if (mediaRecorder && mediaRecorder.state === "recording") {
        mediaRecorder.stop();
        micBtn.classList.remove('recording-pulse');
    }
};

// Mouse & Touch Events for Mic
micBtn.addEventListener('mousedown', startRecording);
micBtn.addEventListener('mouseup', stopRecording);
micBtn.addEventListener('mouseleave', stopRecording);
micBtn.addEventListener('touchstart', (e) => { e.preventDefault(); startRecording(); });
micBtn.addEventListener('touchend', (e) => { e.preventDefault(); stopRecording(); });
getEl('logout-btn').addEventListener('click', () => location.reload());

