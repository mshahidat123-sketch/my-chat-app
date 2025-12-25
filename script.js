import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, setDoc, getDocs, doc, query, where, orderBy, onSnapshot, serverTimestamp, updateDoc, arrayUnion, getDoc } 
from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- PASTE YOUR FIREBASE CONFIG HERE ---
// ⚠️ IF YOU DON'T PASTE YOUR KEYS HERE, LOGIN WILL NOT WORK!
const firebaseConfig = {
    apiKey: "AIzaSyAo_QQ_3i_GmQsyi3tTUWwmJK09z_Y3sNM",
  authDomain: "chatapp-e007a.firebaseapp.com",
  projectId: "chatapp-e007a",
  storageBucket: "chatapp-e007a.firebasestorage.app",
  messagingSenderId: "853709166914",
  appId: "1:853709166914:web:21f0bb1b8e03a796b010db",
  measurementId: "G-X6S69KD32H"
};
// ----------------------------------------

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let currentUser = null;
let selectedChatUser = null;
let unsubscribeMessages = null;
let mediaRecorder = null;
let audioChunks = [];
let uploadedAvatar = null;

// --- IMAGE HANDLING ---
window.previewAvatar = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.src = e.target.result;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            // Resize to 200x200 for speed
            const maxSize = 200;
            let width = img.width;
            let height = img.height;
            if (width > height) {
                if (width > maxSize) { height *= maxSize / width; width = maxSize; }
            } else {
                if (height > maxSize) { width *= maxSize / height; height = maxSize; }
            }
            canvas.width = width;
            canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);
            uploadedAvatar = canvas.toDataURL('image/jpeg', 0.7);
            document.getElementById('avatar-preview').src = uploadedAvatar;
        };
    };
    reader.readAsDataURL(file);
};

// --- LOGIN LOGIC (FIXED) ---
window.usernameLogin = async () => {
    const usernameInput = document.getElementById('login-username').value.trim();
    if (!usernameInput) return alert("Please enter a username");
    
    const btn = document.getElementById('login-btn');
    const originalText = btn.innerText;
    btn.innerText = "Loading...";
    btn.disabled = true;

    try {
        const q = query(collection(db, "users"), where("username", "==", usernameInput.toLowerCase()));
        const snapshot = await getDocs(q);

        // Default photo if they didn't upload one
        let finalPhoto = uploadedAvatar || `https://ui-avatars.com/api/?name=${usernameInput}&background=random`;

        if (!snapshot.empty) {
            // --- EXISTING USER LOGIC (FIXED) ---
            // We take the first matching user directly
            const userDoc = snapshot.docs[0];
            currentUser = userDoc.data();

            // If they uploaded a NEW photo this time, update it
            if (uploadedAvatar) {
                await updateDoc(doc(db, "users", currentUser.uid), { photoURL: uploadedAvatar });
                currentUser.photoURL = uploadedAvatar;
            }
        } else {
            // --- NEW USER LOGIC ---
            const newUid = "user_" + Date.now(); 
            const newUser = {
                uid: newUid,
                username: usernameInput.toLowerCase(),
                displayName: usernameInput, 
                photoURL: finalPhoto,
                friends: []
            };
            await setDoc(doc(db, "users", newUid), newUser);
            currentUser = newUser;
        }

        // Switch Screens
        document.getElementById('my-mini-avatar').src = currentUser.photoURL;
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('app-screen').classList.remove('hidden');
        loadFriendsList();

    } catch (error) {
        console.error("Login Error:", error);
        alert("Login failed! Did you paste your Firebase Keys? \n\nError details: " + error.message);
        btn.innerText = originalText;
        btn.disabled = false;
    }
};

window.logout = () => location.reload();

// --- FRIEND SYSTEM ---
window.addFriend = async () => {
    const input = prompt("Enter the exact Username to add:");
    if (!input) return;
    try {
        const q = query(collection(db, "users"), where("username", "==", input.toLowerCase()));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            alert("User not found!");
        } else {
            const friendData = snapshot.docs[0].data();
            if (friendData.uid === currentUser.uid) return alert("You cannot add yourself.");
            
            await updateDoc(doc(db, "users", currentUser.uid), { 
                friends: arrayUnion(friendData.uid) 
            });
            alert("Friend added!");
        }
    } catch (e) {
        alert("Error adding friend: " + e.message);
    }
};

function loadFriendsList() {
    onSnapshot(doc(db, "users", currentUser.uid), async (docSnap) => {
        if (!docSnap.exists()) return;
        const myData = docSnap.data();
        const friendListEl = document.getElementById('friend-list');
        friendListEl.innerHTML = "";
        
        if (!myData.friends || myData.friends.length === 0) {
            friendListEl.innerHTML = `<div class="p-4 text-center text-gray-500 text-sm">No friends yet.<br>Click "+" to search!</div>`;
            return;
        }

        for (const friendUid of myData.friends) {
            const friendSnap = await getDoc(doc(db, "users", friendUid));
            if (friendSnap.exists()) {
                const friend = friendSnap.data();
                const div = document.createElement("div");
                div.className = "p-3 border-b hover:bg-gray-50 cursor-pointer flex items-center gap-3 transition";
                div.onclick = () => openChat(friend);
                div.innerHTML = `<img src="${friend.photoURL}" class="w-12 h-12 rounded-full border object-cover"><div><p class="font-semibold text-gray-800 capitalize">${friend.displayName}</p></div>`;
                friendListEl.appendChild(div);
            }
        }
    });
}

// --- CHAT UI ---
window.openChat = (friend) => {
    selectedChatUser = friend;
    document.getElementById('sidebar').classList.add('hidden');
    document.getElementById('sidebar').classList.remove('flex');
    document.getElementById('chat-area').classList.remove('hidden');
    document.getElementById('chat-area').classList.add('flex');
    document.getElementById('chat-header-name').innerText = friend.displayName;
    document.getElementById('chat-header-img').src = friend.photoURL;
    loadMessages();
};

window.backToList = () => {
    selectedChatUser = null;
    if (unsubscribeMessages) unsubscribeMessages();
    document.getElementById('sidebar').classList.remove('hidden');
    document.getElementById('sidebar').classList.add('flex');
    document.getElementById('chat-area').classList.add('hidden');
    document.getElementById('chat-area').classList.remove('flex');
};

// --- MESSAGING ---
function getChatID() {
    const ids = [currentUser.uid, selectedChatUser.uid].sort();
    return ids[0] + "_" + ids[1];
}

function loadMessages() {
    if (unsubscribeMessages) unsubscribeMessages();
    const chatID = getChatID();
    const q = query(collection(db, "chats", chatID, "messages"), orderBy("createdAt"));
    const msgList = document.getElementById('msg-list');

    unsubscribeMessages = onSnapshot(q, (snapshot) => {
        msgList.innerHTML = "";
        snapshot.forEach(doc => {
            const data = doc.data();
            const isMe = data.senderId === currentUser.uid;
            const msgDiv = document.createElement("div");
            msgDiv.className = `flex ${isMe ? 'justify-end' : 'justify-start'} mb-2`;
            
            let content = "";
            if (data.type === "audio") {
                content = `<audio controls src="${data.audioData}" class="h-8 w-48"></audio>`;
            } else {
                content = data.text;
            }

            msgDiv.innerHTML = `<div class="px-3 py-2 rounded-2xl max-w-[85%] text-sm ${isMe ? 'bg-blue-600 text-white' : 'bg-gray-200 text-black'} shadow-sm">${content}</div>`;
            msgList.appendChild(msgDiv);
        });
        msgList.scrollTop = msgList.scrollHeight;
    });
}

window.sendMessage = async () => {
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if (!text || !selectedChatUser) return;
    const chatID = getChatID();
    await addDoc(collection(db, "chats", chatID, "messages"), {
        text: text, senderId: currentUser.uid, createdAt: serverTimestamp(), type: "text"
    });
    input.value = "";
};

// --- VOICE RECORDING ---
const micBtn = document.getElementById('mic-btn');

window.startRecording = async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        mediaRecorder.ondataavailable = e => audioChunks.push(e.data);

        mediaRecorder.onstop = async () => {
            stream.getTracks().forEach(track => track.stop());
            if(audioChunks.length === 0) return;
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            const reader = new FileReader();
            reader.readAsDataURL(audioBlob);
            reader.onloadend = async () => {
                const base64Audio = reader.result;
                if(base64Audio.length > 900000) { alert("Voice note too long!"); return; }
                const chatID = getChatID();
                await addDoc(collection(db, "chats", chatID, "messages"), {
                    audioData: base64Audio, senderId: currentUser.uid, createdAt: serverTimestamp(), type: "audio"
                });
            };
        };
        mediaRecorder.start();
        micBtn.classList.add('recording-anim');
    } catch (err) { alert("Microphone permission denied."); }
};

window.stopRecording = () => {
    if(mediaRecorder && mediaRecorder.state === "recording") {
        mediaRecorder.stop();
        micBtn.classList.remove('recording-anim');
    }
};

document.addEventListener('DOMContentLoaded', () => {
    micBtn.addEventListener('mousedown', window.startRecording);
    micBtn.addEventListener('mouseup', window.stopRecording);
    micBtn.addEventListener('touchstart', (e) => { e.preventDefault(); window.startRecording(); }, {passive: false});
    micBtn.addEventListener('touchend', (e) => { e.preventDefault(); window.stopRecording(); }, {passive: false});
});

