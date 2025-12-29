/* script.js */

// --- Helper to generate random waveform bars ---
function generateWaveformHtml(numBars = 28) {
    let html = '';
    for (let i = 0; i < numBars; i++) {
        // Generate a random height between 30% and 100%
        const height = Math.floor(Math.random() * (100 - 30 + 1) + 30);
        html += `<div class="waveform-bar" style="height: ${height}%;"></div>`;
    }
    return html;
}

// --- State Management ---
const state = {
    currentUser: { username: '', avatar: '' },
    activeChatId: null,
    // Mock Data
    friends: [
        { id: 1, name: 'Sarah Jenkins', avatar: 'https://i.pravatar.cc/150?img=1', status: 'Online', lastMsg: 'See you tomorrow!', time: '10:30 AM', unread: 2 },
        { id: 2, name: 'David Miller', avatar: 'https://i.pravatar.cc/150?img=11', status: 'Offline', lastMsg: '🎤 Voice Message (0:07)', time: 'Yesterday', unread: 0 },
        { id: 3, name: 'Jessica Wong', avatar: 'https://i.pravatar.cc/150?img=5', status: 'Online', lastMsg: 'Haha, that is funny.', time: 'Mon', unread: 0 },
    ],
    friendRequests: [
        { id: 4, name: 'Mike Ross', avatar: 'https://i.pravatar.cc/150?img=3' }
    ],
    messages: {
        1: [
            { id: 1, text: "Hey! How are you?", type: 'received', time: '10:00 AM' },
            { id: 2, text: "I'm doing good, just working on the new project.", type: 'sent', time: '10:05 AM' },
            { id: 3, text: "That sounds cool. See you tomorrow!", type: 'received', time: '10:30 AM' },
            // MOCK AUDIO MESSAGE
            { id: 4, type: 'audio', durationStr: '0:05', sentBy: 'received', time: '10:31 AM' },
            { id: 5, type: 'audio', durationStr: '0:12', sentBy: 'sent', time: '10:32 AM' }
        ],
        2: [
             { id: 201, type: 'audio', durationStr: '0:07', sentBy: 'received', time: 'Yesterday' }
        ],
        3: []
    }
};

// --- DOM Elements ---
const dom = {
    screens: {
        splash: document.getElementById('splash-screen'),
        login: document.getElementById('login-screen'),
        app: document.getElementById('app-screen')
    },
    login: {
        input: document.getElementById('login-username'),
        btn: document.getElementById('login-btn'),
        avatarInput: document.getElementById('avatar-input'),
        avatarPreview: document.getElementById('avatar-preview-img')
    },
    nav: {
        sidebar: document.getElementById('sidebar'),
        chatArea: document.getElementById('chat-area'),
        backBtn: document.getElementById('back-btn'),
        myAvatar: document.getElementById('my-avatar'),
        logoutBtn: document.getElementById('logout-btn')
    },
    chat: {
        headerName: document.getElementById('chat-header-name'),
        headerImg: document.getElementById('chat-header-img'),
        headerStatus: document.getElementById('chat-header-status'),
        list: document.getElementById('friend-list'),
        msgList: document.getElementById('msg-list'),
        input: document.getElementById('msg-input'),
        sendBtn: document.getElementById('send-btn'),
        micBtn: document.getElementById('mic-btn')
    },
    audio: {
        lockedUi: document.getElementById('locked-ui'),
        timer: document.getElementById('lock-timer'),
        cancel: document.getElementById('cancel-lock-btn'),
        send: document.getElementById('send-lock-btn')
    },
    requests: {
        btn: document.getElementById('requests-btn'),
        badge: document.getElementById('requests-badge'),
        modal: document.getElementById('requests-modal'),
        close: document.getElementById('close-requests-btn'),
        list: document.getElementById('requests-list-container')
    },
    msgOptions: {
        modal: document.getElementById('msg-options-modal'),
        closeOverlay: document.getElementById('close-msg-options'),
        unsendBtn: document.getElementById('unsend-msg-btn')
    }
};

// --- Initialization ---

// 1. Handle Avatar Upload Preview
dom.login.avatarInput.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            dom.login.avatarPreview.src = e.target.result;
            state.currentUser.avatar = e.target.result;
        }
        reader.readAsDataURL(file);
    }
});

// 2. Login Logic
dom.login.btn.addEventListener('click', () => {
    const username = dom.login.input.value.trim();
    if (!username) {
        alert("Please enter a username");
        return;
    }
    
    // Set user state
    state.currentUser.username = username;
    if(!state.currentUser.avatar) state.currentUser.avatar = dom.login.avatarPreview.src;

    // Transition UI
    dom.login.btn.innerHTML = `<ion-icon name="sync" class="animate-spin text-xl"></ion-icon>`;
    
    setTimeout(() => {
        dom.screens.login.classList.add('fade-out');
        dom.screens.login.style.display = 'none';
        dom.screens.app.classList.remove('hidden');
        dom.screens.app.classList.add('animate-fade-in');
        
        // Init App Data
        dom.nav.myAvatar.src = state.currentUser.avatar;
        renderFriendList();
        updateRequestBadge();
    }, 1000);
});

// 3. Friend List Rendering
function renderFriendList() {
    dom.chat.list.innerHTML = '';
    state.friends.forEach(friend => {
        const isActive = state.activeChatId === friend.id;
        const div = document.createElement('div');
        div.className = `p-3 flex items-center gap-3 rounded-xl cursor-pointer transition ${isActive ? 'bg-[#262626]' : 'hover:bg-[#1a1a1a]'}`;
        div.onclick = () => openChat(friend);
        
        div.innerHTML = `
            <div class="relative">
                <img src="${friend.avatar}" class="w-12 h-12 rounded-full object-cover">
                ${friend.status === 'Online' ? '<div class="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-black"></div>' : ''}
            </div>
            <div class="flex-1 min-w-0">
                <div class="flex justify-between items-baseline mb-0.5">
                    <h3 class="font-bold text-white truncate">${friend.name}</h3>
                    <span class="text-xs text-gray-500">${friend.time}</span>
                </div>
                <div class="flex justify-between items-center">
                    <p class="text-sm text-gray-400 truncate w-4/5">${friend.lastMsg}</p>
                    ${friend.unread > 0 ? `<span class="bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">${friend.unread}</span>` : ''}
                </div>
            </div>
        `;
        dom.chat.list.appendChild(div);
    });
}

// 4. Open Chat Logic
function openChat(friend) {
    state.activeChatId = friend.id;
    
    // Reset Unread
    friend.unread = 0;
    renderFriendList();

    // UI Updates
    dom.chat.headerName.innerText = friend.name;
    dom.chat.headerImg.src = friend.avatar;
    dom.chat.headerStatus.innerHTML = friend.status === 'Online' 
        ? `<span class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span> Online`
        : `<span class="text-gray-500">Offline</span>`;

    // Mobile View Toggle
    if (window.innerWidth < 768) {
        dom.nav.sidebar.classList.add('hidden');
        dom.nav.chatArea.classList.remove('hidden');
    }

    renderMessages(friend.id);
}

// 5. Render Messages (UPDATED)
function renderMessages(chatId) {
    dom.chat.msgList.innerHTML = '';
    const msgs = state.messages[chatId] || [];
    
    msgs.forEach(msg => {
        appendMessageToDom(msg);
    });
    
    scrollToBottom();
}

function appendMessageToDom(msg) {
    const div = document.createElement('div');
    // Determine sender type (sent/received)
    const sentBy = msg.sentBy || msg.type; // Fallback for older text messages
    div.className = `flex flex-col mb-1 ${sentBy === 'sent' ? 'items-end' : 'items-start'}`;
    div.id = `msg-${msg.id}`; // Add an ID for easy selection

    // Add long press/right click event for options
    div.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openMessageOptions(msg.id);
    });

    let bubbleHtml = '';

    if (msg.type === 'audio') {
        // --- NEW: Voice Message HTML Structure ---
        bubbleHtml = `
            <div class="msg-bubble voice-msg-bubble ${sentBy === 'sent' ? 'msg-sent' : 'msg-received'}">
                <button class="play-pause-btn" onclick="playVoiceMessage(${msg.id}, '${msg.durationStr}')">
                    <ion-icon name="play"></ion-icon>
                </button>
                <div class="waveform-container" id="waveform-${msg.id}">
                    ${generateWaveformHtml()} </div>
                <span class="duration" id="duration-${msg.id}">${msg.durationStr}</span>
            </div>
        `;
    } else {
        // --- Standard Text Message HTML ---
        bubbleHtml = `
            <div class="msg-bubble ${sentBy === 'sent' ? 'msg-sent' : 'msg-received'}">
                ${msg.text}
            </div>
        `;
    }

    div.innerHTML = `
        ${bubbleHtml}
        <span class="text-[10px] text-gray-600 mt-1 px-1">${msg.time}</span>
    `;
    dom.chat.msgList.appendChild(div);
}

// --- NEW: Voice Message Playback Logic (Simulation) ---
window.playVoiceMessage = (msgId, durationStr) => {
    const msgElement = document.getElementById(`msg-${msgId}`);
    if (!msgElement) return;
    
    const playBtn = msgElement.querySelector('.play-pause-btn');
    const icon = playBtn.querySelector('ion-icon');
    const waveformContainer = document.getElementById(`waveform-${msgId}`);
    const bars = waveformContainer.querySelectorAll('.waveform-bar');

    const isPlaying = icon.getAttribute('name') === 'pause';

    if (isPlaying) {
        // Stop logic
        icon.setAttribute('name', 'play');
        bars.forEach(bar => bar.classList.remove('playing'));
        // In a real app, you'd pause the audio object here.
    } else {
        // Play logic
        icon.setAttribute('name', 'pause');

        // Calculate animation delay per bar based on duration
        const [mins, secs] = durationStr.split(':').map(Number);
        const totalSeconds = mins * 60 + secs;
        const delayPerBar = (totalSeconds * 1000) / bars.length;

        bars.forEach((bar, index) => {
            setTimeout(() => {
                // Only add 'playing' if still in play mode
                if (icon.getAttribute('name') === 'pause') {
                    bar.classList.add('playing');
                }
            }, index * delayPerBar);
        });

        // Auto-reset after playback finishes
        setTimeout(() => {
            if (icon.getAttribute('name') === 'pause') {
                icon.setAttribute('name', 'play');
                bars.forEach(bar => bar.classList.remove('playing')); // Reset waveform
            }
        }, totalSeconds * 1000);
    }
};

function scrollToBottom() {
    dom.chat.msgList.scrollTop = dom.chat.msgList.scrollHeight;
}

// 6. Send Message Logic
dom.chat.sendBtn.addEventListener('click', sendMessage);
dom.chat.input.addEventListener('keypress', (e) => {
    if(e.key === 'Enter') sendMessage();
});

function sendMessage() {
    const text = dom.chat.input.value.trim();
    if (!text || !state.activeChatId) return;

    const newMsg = {
        id: Date.now(),
        text: text,
        type: 'text', // Explicitly set type
        sentBy: 'sent',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    // Update state
    state.messages[state.activeChatId].push(newMsg);
    
    // Update UI
    appendMessageToDom(newMsg);
    dom.chat.input.value = '';
    dom.chat.sendBtn.classList.add('hidden');
    scrollToBottom();

    // Update Sidebar Preview
    const friend = state.friends.find(f => f.id === state.activeChatId);
    friend.lastMsg = "You: " + text;
    friend.time = "Just now";
    renderFriendList();

    // Simulate Reply
    setTimeout(() => {
        receiveMockReply(state.activeChatId);
    }, 2000);
}

function receiveMockReply(chatId) {
    const replies = ["That's interesting!", "Okay, got it.", "Can we talk later?", "LOL 😂", "Sure thing."];
    const randomReply = replies[Math.floor(Math.random() * replies.length)];
    
    const replyMsg = {
        id: Date.now(),
        text: randomReply,
        type: 'text',
        sentBy: 'received',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    state.messages[chatId].push(replyMsg);
    
    if (state.activeChatId === chatId) {
        appendMessageToDom(replyMsg);
        scrollToBottom();
    }
    
    // Update Sidebar
    const friend = state.friends.find(f => f.id === chatId);
    friend.lastMsg = randomReply;
    friend.time = "Just now";
    renderFriendList();
}

// 7. Audio Recording Mock UI (UPDATED)
let recordInterval;
let recordSeconds = 0;

dom.chat.micBtn.addEventListener('click', () => {
    // Show Locked UI
    dom.audio.lockedUi.classList.remove('hidden');
    dom.chat.micBtn.classList.add('hidden'); // Hide original mic
    
    // Start Timer
    recordSeconds = 0;
    dom.audio.timer.innerText = "0:00";
    recordInterval = setInterval(() => {
        recordSeconds++;
        const mins = Math.floor(recordSeconds / 60);
        const secs = recordSeconds % 60;
        dom.audio.timer.innerText = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }, 1000);
});

dom.audio.cancel.addEventListener('click', stopRecording);
dom.audio.send.addEventListener('click', () => {
    stopRecording();
    if (recordSeconds < 1) return; // Don't send empty

    const durationStr = (recordSeconds < 10 ? '0' : '') + recordSeconds;
    const audioMsg = {
        id: Date.now(),
        type: 'audio', // Set type to audio
        durationStr: "0:" + durationStr,
        sentBy: 'sent',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    
    state.messages[state.activeChatId].push(audioMsg);
    appendMessageToDom(audioMsg);
    scrollToBottom();

    // Update sidebar
    const friend = state.friends.find(f => f.id === state.activeChatId);
    friend.lastMsg = "🎤 Voice Message";
    friend.time = "Just now";
    renderFriendList();
});

function stopRecording() {
    clearInterval(recordInterval);
    dom.audio.lockedUi.classList.add('hidden');
    dom.chat.micBtn.classList.remove('hidden');
}

// 8. Navigation (Mobile)
dom.nav.backBtn.addEventListener('click', () => {
    dom.nav.chatArea.classList.add('hidden');
    dom.nav.sidebar.classList.remove('hidden');
    state.activeChatId = null;
    renderFriendList(); // remove active highlight
});

// 9. Requests Modal
function updateRequestBadge() {
    if (state.friendRequests.length > 0) {
        dom.requests.badge.classList.remove('hidden');
        dom.requests.btn.classList.remove('hidden');
    }
}

dom.requests.btn.addEventListener('click', () => {
    dom.requests.modal.classList.remove('hidden');
    renderRequests();
});

dom.requests.close.addEventListener('click', () => {
    dom.requests.modal.classList.add('hidden');
});

function renderRequests() {
    dom.requests.list.innerHTML = '';
    if(state.friendRequests.length === 0) {
        dom.requests.list.innerHTML = '<p class="text-gray-500 text-center">No pending requests</p>';
        return;
    }

    state.friendRequests.forEach(req => {
        const div = document.createElement('div');
        div.className = "flex items-center justify-between bg-gray-900 p-3 rounded-xl";
        div.innerHTML = `
            <div class="flex items-center gap-3">
                <img src="${req.avatar}" class="w-10 h-10 rounded-full">
                <span class="font-bold text-white">${req.name}</span>
            </div>
            <div class="flex gap-2">
                <button onclick="acceptRequest(${req.id})" class="bg-blue-600 text-white p-2 rounded-full hover:bg-blue-500"><ion-icon name="checkmark"></ion-icon></button>
                <button onclick="rejectRequest(${req.id})" class="bg-gray-700 text-red-500 p-2 rounded-full hover:bg-gray-600"><ion-icon name="close"></ion-icon></button>
            </div>
        `;
        dom.requests.list.appendChild(div);
    });
}

// Expose these to global scope
window.acceptRequest = (id) => {
    const reqIndex = state.friendRequests.findIndex(r => r.id === id);
    if (reqIndex > -1) {
        const newFriend = {
            ...state.friendRequests[reqIndex],
            status: 'Online',
            lastMsg: 'You are now friends',
            time: 'Just now',
            unread: 0
        };
        state.friends.push(newFriend);
        state.messages[newFriend.id] = []; // Init msg array
        state.friendRequests.splice(reqIndex, 1);
        
        renderRequests();
        renderFriendList();
        
        if(state.friendRequests.length === 0) {
            dom.requests.badge.classList.add('hidden');
            dom.requests.modal.classList.add('hidden');
        }
    }
};

window.rejectRequest = (id) => {
    state.friendRequests = state.friendRequests.filter(r => r.id !== id);
    renderRequests();
    if(state.friendRequests.length === 0) {
        dom.requests.badge.classList.add('hidden');
    }
};

// 10. Message Options (Unsend Mock)
function openMessageOptions(msgId) {
    dom.msgOptions.modal.classList.remove('hidden');
    // In a real app, you'd save the msgId to delete it later
}

dom.msgOptions.closeOverlay.addEventListener('click', () => {
    dom.msgOptions.modal.classList.add('hidden');
});

dom.nav.logoutBtn.addEventListener('click', () => {
    location.reload(); // Simple reload to "logout"
});

