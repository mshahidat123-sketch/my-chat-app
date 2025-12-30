import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, collection, addDoc, setDoc, getDocs, doc, query, where, orderBy, onSnapshot, serverTimestamp, updateDoc, arrayUnion, arrayRemove, increment, deleteField, getDoc, deleteDoc, writeBatch } 
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
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

// --- VARIABLES ---
let currentUser = null;
let selectedChatUser = null;
let unsubscribeMessages = null;
let friendListeners = []; 
let mediaRecorder = null;
let audioChunks = [];
let selectedAvatarBase64 = null;
let recordingTimerInterval = null;
let pressTimer = null; 
let longPressTimer = null;
let messageToDeleteId = null;

const getEl = (id) => document.getElementById(id);

// --- 1. PRESENCE SYSTEM (DEFINED FIRST) ---
function setupPresenceSystem() {
    setInterval(() => {
        if (currentUser) {
            updateDoc(doc(db, "users", currentUser.uid), { isOnline: true, lastSeen: serverTimestamp() });
        }
    }, 30000);

    window.addEventListener('beforeunload', () => {
        if (currentUser) updateDoc(doc(db, "users", currentUser.uid), { isOnline: false });
    });
}

// --- 2. AUTHENTICATION LOGIC (THE FIX) ---

// Listen for Auth State Changes
onAuthStateChanged(auth, async (user) => {
    if (user) {
        // User is signed in with Google. Check DB for username.
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
            // CASE 1: EXISTING USER (Skip Username Screen)
            currentUser = userSnap.data();
            await updateDoc(userRef, { isOnline: true, lastSeen: serverTimestamp() });
            
            getEl('google-screen').classList.add('hidden');
            getEl('username-screen').classList.add('hidden');
            getEl('app-screen').classList.remove('hidden');
            
            getEl('my-avatar').src = currentUser.photoURL;
            loadData();
            setupPresenceSystem();
        } else {
            // CASE 2: NEW USER (Show Username Screen)
            getEl('google-screen').classList.add('hidden');
            getEl('username-screen').classList.remove('hidden');
        }
    } else {
        // CASE 3: LOGGED OUT
        getEl('google-screen').classList.remove('hidden');
        getEl('username-screen').classList.add('hidden');
        getEl('app-screen').classList.add('hidden');
    }
});

// Google Login Button
getEl('google-login-btn').addEventListener('click', () => {
    signInWithPopup(auth, provider).catch((error) => {
        alert("Google Login Failed: " + error.message);
    });
});

// Finish Setup Button (Save Username & Go to App)
getEl('finish-setup-btn').addEventListener('click', async () => {
    const username = getEl('setup-username').value.trim().toLowerCase();
    const googleUser = auth.currentUser;

    if (!username) return alert("Enter a username");
    
    getEl('finish-setup-btn').innerText = "Saving...";
    getEl('finish-setup-btn').disabled = true;

    try {
        // Check availability
        const q = query(collection(db, "users"), where("username", "==", username));
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
            getEl('finish-setup-btn').innerText = "Start Messaging";
            getEl('finish-setup-btn').disabled = false;
            return alert("Username taken!");
        }

        // Create Doc
        const defaultAvatar = "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3e%3ccircle cx='12' cy='12' r='12' fill='%236B7280'/%3e%3cpath fill='%23E5E7EB' d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3e%3c/svg%3e";
        
        const newUser = {
            uid: googleUser.uid,
            username: username,
            displayName: username,
            photoURL: selectedAvatarBase64 || googleUser.photoURL || defaultAvatar, 
            friends: [],
            friendRequests: [],
            unread: {},
            isOnline: true,
            createdAt: serverTimestamp()
        };

        await setDoc(doc(db, "users", googleUser.uid), newUser);
        
        // MANUALLY ENTER APP (Because onAuthStateChanged won't re-fire instantly)
        currentUser = newUser;
        getEl('username-screen').classList.add('hidden');
        getEl('app-screen').classList.remove('hidden');
        getEl('my-avatar').src = currentUser.photoURL;
        loadData();
        setupPresenceSystem();
        
    } catch (err) {
        console.error(err);
        alert("Setup Error: " + err.message);
        getEl('finish-setup-btn').disabled = false;
    }
});

// Logout
getEl('logout-btn').addEventListener('click', async () => {
    if (currentUser) await updateDoc(doc(db, "users", currentUser.uid), { isOnline: false });
    signOut(auth).then(() => {
        location.reload();
    });
});

// --- 3. GLOBAL HELPERS (Audio, etc) ---
function formatTime(seconds) {
    if(isNaN(seconds) || seconds === Infinity) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

window.setAudioDuration = (id) => {
    const audio = document.getElementById(`audio-${id}`);
    const durationEl = document.getElementById(`duration-${id}`);
    if (audio && durationEl) durationEl.innerText = formatTime(audio.duration);
};

window.updateAudioProgress = (id) => {
    const audio = document.getElementById(`audio-${id}`);
    const playhead = document.getElementById(`playhead-${id}`);
    const waveform = document.getElementById(`waveform-${id}`);
    const durationEl = document.getElementById(`duration-${id}`);
    
    if (!audio) return;
    
    const timeLeft = audio.duration - audio.currentTime;
    if(durationEl) durationEl.innerText = formatTime(timeLeft);

    const percent = (audio.currentTime / audio.duration) * 100;
    if(playhead) {
        playhead.style.display = 'block';
        playhead.style.left = `${percent}%`;
    }

    if(waveform) {
        const bars = waveform.querySelectorAll('.insta-bar');
        const activeCount = Math.floor((percent/100) * bars.length);
        bars.forEach((bar, idx) => {
            if(idx < activeCount) bar.classList.add('played');
            else bar.classList.remove('played');
        });
    }
};

window.toggleAudio = (id) => {
    const audio = document.getElementById(`audio-${id}`);
    const playIcon = document.getElementById(`icon-play-${id}`);
    const pauseIcon = document.getElementById(`icon-pause-${id}`);

    document.querySelectorAll('audio').forEach(a => {
        if(a.id !== `audio-${id}`) {
            a.pause(); a.currentTime = 0;
            window.resetAudio(a.id.replace('audio-', ''));
        }
    });

    if (audio.paused) {
        audio.play();
        playIcon.classList.add('hidden');
        pauseIcon.classList.remove('hidden');
    } else {
        audio.pause();
        playIcon.classList.remove('hidden');
        pauseIcon.classList.add('hidden');
    }
};

window.resetAudio = (id) => {
    const playIcon = document.getElementById(`icon-play-${id}`);
    const pauseIcon = document.getElementById(`icon-pause-${id}`);
    const playhead = document.getElementById(`playhead-${id}`);
    const waveform = document.getElementById(`waveform-${id}`);
    const durationEl = document.getElementById(`duration-${id}`);
    const audio = document.getElementById(`audio-${id}`);

    if(playIcon) playIcon.classList.remove('hidden');
    if(pauseIcon) pauseIcon.classList.add('hidden');
    if(playhead) { playhead.style.display = 'none'; playhead.style.left = '0%'; }
    if(waveform) waveform.querySelectorAll('.insta-bar').forEach(b => b.classList.remove('played'));
    if(audio && durationEl) durationEl.innerText = formatTime(audio.duration);
};

window.respondRequest = async function(targetUid, isAccepted) {
    if (!currentUser) return;
    try {
        const myRef = doc(db, "users", currentUser.uid);
        const theirRef = doc(db, "users", targetUid);
        await updateDoc(myRef, { friendRequests: arrayRemove(targetUid) });

        if (isAccepted) {
            await updateDoc(myRef, { friends: arrayUnion(targetUid) });
            await updateDoc(theirRef, { friends: arrayUnion(currentUser.uid) });
            alert("Friend added!");
        }
        if (!currentUser.friendRequests || currentUser.friendRequests.length <= 1) {
            getEl('requests-modal').classList.add('hidden');
        }
    } catch(e) { console.error(e); }
};

// --- 4. HEADER ACTIONS ---
getEl('add-friend-btn').addEventListener('click', async () => {
    const input = prompt("Enter username to add:");
    if (!input) return;
    try {
        const q = query(collection(db, "users"), where("username", "==", input.toLowerCase().trim()));
        const snapshot = await getDocs(q);
        if (snapshot.empty) return alert("User not found");
        let friendID = snapshot.docs[0].data().uid;
        if (friendID === currentUser.uid) return alert("Cannot add yourself");
        await updateDoc(doc(db, "users", friendID), { friendRequests: arrayUnion(currentUser.uid) });
        alert("Friend request sent!");
    } catch(e) { alert("Error: " + e.message); }
});

// --- 5. UNSEND LOGIC ---
const msgOptionsModal = getEl('msg-options-modal');
const unsendBtn = getEl('unsend-msg-btn');
const closeMsgOptions = getEl('close-msg-options');

function attachLongPress(element, msgId) {
    element.addEventListener('touchstart', (e) => {
        longPressTimer = setTimeout(() => openMessageOptions(msgId), 800);
    });
    element.addEventListener('touchend', () => clearTimeout(longPressTimer));
    element.addEventListener('touchmove', () => clearTimeout(longPressTimer));
    element.addEventListener('mousedown', () => {
        longPressTimer = setTimeout(() => openMessageOptions(msgId), 800);
    });
    element.addEventListener('mouseup', () => clearTimeout(longPressTimer));
    element.addEventListener('mouseleave', () => clearTimeout(longPressTimer));
}

function openMessageOptions(msgId) {
    if (navigator.vibrate) navigator.vibrate(50);
    messageToDeleteId = msgId;
    msgOptionsModal.classList.remove('hidden');
}

closeMsgOptions.addEventListener('click', () => {
    msgOptionsModal.classList.add('hidden');
    messageToDeleteId = null;
});

unsendBtn.addEventListener('click', async () => {
    if (!messageToDeleteId || !selectedChatUser) return;
    try {
        const chatId = getChatID();
        await deleteDoc(doc(db, "chats", chatId, "messages", messageToDeleteId));
        msgOptionsModal.classList.add('hidden');
    } catch (e) { alert("Error unsending: " + e.message); }
});

// --- 6. SETUP AVATAR ---
getEl('avatar-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (ev) => {
            selectedAvatarBase64 = ev.target.result;
            getEl('avatar-preview-img').src = selectedAvatarBase64;
            getEl('avatar-overlay').classList.add('hidden');
        };
        reader.readAsDataURL(file);
    }
});

// --- 7. DATA LOADING ---
function loadData() {
    onSnapshot(doc(db, "users", currentUser.uid), (docSnap) => {
        const data = docSnap.data();
        if(!data) return;
        currentUser = data; 
        const reqBtn = getEl('requests-btn');
        const reqBadge = getEl('requests-badge');
        if (data.friendRequests && data.friendRequests.length > 0) {
            reqBtn.classList.remove('hidden');
            reqBadge.classList.remove('hidden');
            if (!getEl('requests-modal').classList.contains('hidden')) renderRequestsModal(data.friendRequests);
        } else {
            reqBtn.classList.add('hidden');
        }
        renderFriendsList(data.friends || [], data.unread || {});
    });
}

function renderFriendsList(friendsList, unreadMap) {
    const listEl = getEl('friend-list');
    listEl.innerHTML = "";
    friendListeners.forEach(unsub => unsub());
    friendListeners = [];

    if (!friendsList.length) {
        listEl.innerHTML = `<div class="text-center text-gray-500 mt-10 text-xs">No chats yet.</div>`;
        return;
    }

    friendsList.forEach(friendUid => {
        const unsub = onSnapshot(doc(db, "users", friendUid), (fSnap) => {
            if (!fSnap.exists()) return;
            const fData = fSnap.data();
            let isOnline = false;
            if (fData.lastSeen) {
                const diff = Date.now() - (fData.lastSeen.toMillis ? fData.lastSeen.toMillis() : 0);
                isOnline = diff < 65000;
            }
            const unreadCount = unreadMap[fData.uid] || 0;
            const unreadBadge = unreadCount > 0 ? `<div class="bg-red-500 text-white text-[10px] font-bold h-5 min-w-[1.25rem] px-1 flex items-center justify-center rounded-full shadow-lg shadow-red-900">${unreadCount}</div>` : '';
            const isActive = selectedChatUser && selectedChatUser.uid === fData.uid;
            const bgClass = isActive ? "bg-gray-800 border-gray-700" : "hover:bg-gray-900 border-transparent hover:border-gray-800";

            let card = document.getElementById(`friend-${fData.uid}`);
            const html = `
                <div class="relative">
                    <img src="${fData.photoURL}" class="w-12 h-12 rounded-full border border-gray-700 object-cover bg-gray-800">
                    <div class="absolute bottom-0 right-0 w-3.5 h-3.5 ${isOnline ? "bg-green-500" : "bg-gray-600"} rounded-full border-2 border-black"></div>
                </div>
                <div class="flex-1 min-w-0">
                    <div class="flex justify-between items-center">
                        <p class="font-bold text-gray-200 capitalize text-sm truncate">${fData.displayName}</p>
                        ${unreadBadge}
                    </div>
                    <p class="text-[10px] ${isOnline ? 'text-green-500' : 'text-gray-500'} uppercase tracking-wider font-semibold">${isOnline ? "Online" : "Offline"}</p>
                </div>`;

            if (card) { card.innerHTML = html; card.className = `p-3 rounded-xl cursor-pointer flex items-center gap-3 transition border ${bgClass}`; } 
            else {
                card = document.createElement("div");
                card.id = `friend-${fData.uid}`;
                card.className = `p-3 rounded-xl cursor-pointer flex items-center gap-3 transition border ${bgClass}`;
                card.innerHTML = html;
                card.onclick = () => openChat(fData);
                listEl.appendChild(card);
            }
            if (isActive && getEl('chat-header-status')) {
                getEl('chat-header-status').innerText = isOnline ? "Online" : "Offline";
                getEl('chat-header-status').className = isOnline ? "text-xs text-green-500 font-bold" : "text-xs text-gray-500";
            }
        });
        friendListeners.push(unsub);
    });
}

// --- 8. CHAT LOGIC ---
window.openChat = async (friend) => {
    selectedChatUser = friend;
    getEl('sidebar').classList.add('hidden');
    getEl('sidebar').classList.remove('flex');
    getEl('chat-area').classList.remove('hidden');
    getEl('chat-area').classList.add('flex');
    getEl('chat-header-name').innerText = friend.displayName;
    getEl('chat-header-img').src = friend.photoURL;

    if (currentUser.unread && currentUser.unread[friend.uid]) {
        await updateDoc(doc(db, "users", currentUser.uid), { [`unread.${friend.uid}`]: deleteField() });
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
});

function getChatID() { return [currentUser.uid, selectedChatUser.uid].sort().join("_"); }

function loadMessages() {
    if (unsubscribeMessages) unsubscribeMessages();
    const q = query(collection(db, "chats", getChatID(), "messages"), orderBy("createdAt", "asc"));
    
    unsubscribeMessages = onSnapshot(q, async (snapshot) => {
        const list = getEl('msg-list');
        list.innerHTML = "";
        if (snapshot.empty) { list.innerHTML = `<div class="text-center text-gray-600 mt-10 text-xs">No messages yet.</div>`; return; }

        const batch = writeBatch(db);
        let hasUpdates = false;
        let lastSeenMessageId = null;

        snapshot.docs.forEach(docSnap => {
            const data = docSnap.data();
            if (data.senderId !== currentUser.uid && !data.seen) {
                batch.update(docSnap.ref, { seen: true });
                hasUpdates = true;
            }
            if (data.senderId === currentUser.uid && data.seen) {
                lastSeenMessageId = docSnap.id;
            }
        });

        if (hasUpdates) { try { await batch.commit(); } catch (e) {} }

        snapshot.forEach(doc => {
            const data = doc.data();
            const isMe = data.senderId === currentUser.uid;
            const avatarSrc = isMe ? currentUser.photoURL : selectedChatUser.photoURL;
            let contentHtml = "";

            if (data.type === "audio") {
                const uId = doc.id;
                contentHtml = `
                    <div class="insta-audio-wrapper">
                        <div class="insta-audio-container" id="container-${uId}">
                            <audio id="audio-${uId}" src="${data.content}" onended="resetAudio('${uId}')" onloadedmetadata="setAudioDuration('${uId}')" ontimeupdate="updateAudioProgress('${uId}')"></audio>
                            
                            <div class="insta-play-btn" onclick="toggleAudio('${uId}')">
                                <ion-icon id="icon-play-${uId}" name="play" class="text-xl"></ion-icon>
                                <ion-icon id="icon-pause-${uId}" name="pause" class="text-xl hidden"></ion-icon>
                            </div>
                            
                            <div class="insta-waveform" id="waveform-${uId}">
                                <div class="insta-bar"></div><div class="insta-bar"></div><div class="insta-bar"></div>
                                <div class="insta-bar"></div><div class="insta-bar"></div><div class="insta-bar"></div>
                                <div class="insta-bar"></div><div class="insta-bar"></div><div class="insta-bar"></div>
                                <div class="insta-bar"></div><div class="insta-bar"></div><div class="insta-bar"></div>
                                <div class="insta-bar"></div><div class="insta-bar"></div><div class="insta-bar"></div>
                            </div>

                            <div class="insta-meta">
                                <span id="duration-${uId}" class="insta-duration">...</span>
                                <span class="insta-speed-pill">1x</span>
                            </div>
                        </div>
                        <p class="transcription-text">View transcription</p>
                    </div>`;
            } else {
                contentHtml = `<p class="text-[15px] leading-snug">${data.content}</p>`;
            }

            const div = document.createElement("div");
            div.className = `flex w-full ${isMe ? 'justify-end' : 'justify-start'} mb-2 items-end gap-2`;
            const avatarHtml = !isMe ? `<img src="${avatarSrc}" class="w-7 h-7 rounded-full mb-1 object-cover border border-gray-800">` : ``;
            const bubbleColor = isMe ? 'bg-[#374151] text-white rounded-[22px] rounded-br-sm' : 'bg-[#262626] text-white rounded-[22px] rounded-bl-sm';
            
            const bubbleContent = document.createElement("div");
            bubbleContent.className = `max-w-[85%] px-4 py-2 ${bubbleColor} shadow-sm relative group cursor-pointer active:scale-95 transition-transform select-none`;
            bubbleContent.innerHTML = contentHtml;
            
            if (isMe) attachLongPress(bubbleContent, doc.id);

            if (isMe && doc.id === lastSeenMessageId) {
                const wrapper = document.createElement("div");
                wrapper.className = "flex flex-col items-end";
                wrapper.appendChild(bubbleContent);
                const seenLabel = document.createElement('p');
                seenLabel.className = "text-[10px] text-gray-500 text-right mt-1 mr-1 font-medium";
                seenLabel.innerText = "Seen";
                wrapper.appendChild(seenLabel);
                div.appendChild(wrapper);
            } else {
                div.innerHTML = avatarHtml;
                div.appendChild(bubbleContent);
            }
            list.appendChild(div);
        });
        setTimeout(() => list.scrollTop = list.scrollHeight, 100);
    });
}

// --- 9. SENDING ---
getEl('send-btn').addEventListener('click', async () => {
    const input = getEl('msg-input');
    const text = input.value.trim();
    if (!text || !selectedChatUser) return;
    try {
        await addDoc(collection(db, "chats", getChatID(), "messages"), { content: text, senderId: currentUser.uid, createdAt: serverTimestamp(), type: "text", seen: false });
        await updateDoc(doc(db, "users", selectedChatUser.uid), { [`unread.${currentUser.uid}`]: increment(1) });
        input.value = "";
        input.dispatchEvent(new Event('input'));
    } catch (e) { alert("Send failed"); }
});

const micBtn = getEl('mic-btn');
const lockTooltip = getEl('lock-tooltip');
const lockedUI = getEl('locked-ui');
const lockTimer = getEl('lock-timer');
const inputBar = getEl('input-bar');

let isRecording = false;
let isLocked = false;
let startY = 0;
let startTime = 0;

const updateTimer = () => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const m = Math.floor(elapsed / 60);
    const s = elapsed % 60;
    lockTimer.innerText = `${m}:${s.toString().padStart(2, '0')}`;
};

const startRecordingProcess = async () => {
    if (!navigator.mediaDevices) return alert("Mic blocked");
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
        mediaRecorder.start();
        
        isRecording = true;
        startTime = Date.now();
        micBtn.classList.add('mic-active');
        lockTooltip.classList.remove('hidden'); 
        
        recordingTimerInterval = setInterval(updateTimer, 1000);
    } catch(e) { alert("Mic Error: " + e.message); }
};

const stopAndSend = async () => {
    if (!mediaRecorder || mediaRecorder.state !== 'recording') return;
    mediaRecorder.onstop = async () => {
        const blob = new Blob(audioChunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = async () => {
            const base64 = reader.result;
            if(base64.length > 800000) return alert("Audio too long!");
            try {
                await addDoc(collection(db, "chats", getChatID(), "messages"), { content: base64, senderId: currentUser.uid, createdAt: serverTimestamp(), type: "audio", seen: false });
                await updateDoc(doc(db, "users", selectedChatUser.uid), { [`unread.${currentUser.uid}`]: increment(1) });
            } catch(e) { alert("Send failed"); }
        };
        mediaRecorder.stream.getTracks().forEach(t => t.stop());
    };
    mediaRecorder.stop();
    resetRecordingUI();
};

const resetRecordingUI = () => {
    isRecording = false;
    isLocked = false;
    clearInterval(recordingTimerInterval);
    micBtn.classList.remove('mic-active');
    lockTooltip.classList.add('hidden');
    lockedUI.classList.add('hidden');
    inputBar.classList.remove('invisible');
};

micBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    startY = e.touches[0].clientY;
    pressTimer = setTimeout(() => {
        startRecordingProcess();
    }, 100);
});

micBtn.addEventListener('touchmove', (e) => {
    if (!isRecording || isLocked) return;
    const currentY = e.touches[0].clientY;
    const diff = startY - currentY;
    lockTooltip.style.transform = `translateY(-${diff}px)`;
    if (diff > 60) {
        isLocked = true;
        lockTooltip.classList.add('hidden');
        lockedUI.classList.remove('hidden');
        inputBar.classList.add('invisible');
    }
});

micBtn.addEventListener('touchend', (e) => {
    e.preventDefault();
    if (pressTimer) clearTimeout(pressTimer);
    lockTooltip.style.transform = `translateY(0)`; 
    if (!isRecording || isLocked) return;
    stopAndSend();
});

getEl('cancel-lock-btn').addEventListener('click', () => {
    if(mediaRecorder) { mediaRecorder.stop(); mediaRecorder.stream.getTracks().forEach(t => t.stop()); }
    resetRecordingUI();
});
getEl('send-lock-btn').addEventListener('click', () => {
    stopAndSend();
});

