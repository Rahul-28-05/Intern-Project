class ChatApp {
    constructor() {
        this.ws = null;
        this.currentRoom = null;
        this.currentUsername = null;
        this.isConnected = false;

        this.peerConnection = null;
        this.localStream = null;
        this.remoteStream = null;
        this.currentPeer = null;
        this.isCaller = false;

        this.pendingRemoteCandidates = [];
        this.remoteDescriptionSet = false;

        this.initializeElements();
        this.bindEvents();
    }

    initializeElements() {
        this.landingPanel = document.getElementById('landing-panel');
        this.joinForm = document.getElementById('join-form');
        this.roomNameInput = document.getElementById('room-name');
        this.usernameInput = document.getElementById('username');
        this.joinBtn = document.getElementById('join-btn');

        this.chatContainer = document.getElementById('chat-container');
        this.currentRoomDisplay = document.getElementById('current-room');
        this.connectionStatus = document.getElementById('connection-status');
        this.statusIndicator = this.connectionStatus.querySelector('.status-indicator');
        this.statusText = document.getElementById('status-text');
        this.usersList = document.getElementById('users-list');
        this.messagesPane = document.getElementById('messages-pane');
        this.messageForm = document.getElementById('message-form');
        this.messageInput = document.getElementById('message-input');

        this.audioCallBtn = document.getElementById('audio-call-btn');
        this.videoCallBtn = document.getElementById('video-call-btn');
        this.incomingCallModal = document.getElementById('incoming-call-modal');
        this.callInfo = document.getElementById('call-info');
        this.acceptCallBtn = document.getElementById('accept-call-btn');
        this.rejectCallBtn = document.getElementById('reject-call-btn');
        this.callOverlay = document.getElementById('call-overlay');
        this.localVideo = document.getElementById('local-video');
        this.remoteVideo = document.getElementById('remote-video');
        this.muteBtn = document.getElementById('mute-btn');
        this.endCallBtn = document.getElementById('end-call-btn');

        this.themeToggleBtn = document.getElementById('theme-toggle');
    }

    bindEvents() {
        this.joinForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.joinRoom();
        });

        this.messageForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.sendMessage();
        });

        this.audioCallBtn.addEventListener('click', () => this.initiateCall('audio'));
        this.videoCallBtn.addEventListener('click', () => this.initiateCall('video'));

        this.acceptCallBtn.addEventListener('click', () => this.answerCall(true));
        this.rejectCallBtn.addEventListener('click', () => this.answerCall(false));

        this.muteBtn.addEventListener('click', () => this.toggleMute());
        this.endCallBtn.addEventListener('click', () => this.endCall());
  
        this.messageInput.addEventListener('input', () => this.autoResizeTextarea());
        this.messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        
        if (this.themeToggleBtn) {
            this.themeToggleBtn.addEventListener('click', () => this.toggleTheme());

            
            const savedTheme = localStorage.getItem("theme") || "light";
            if (savedTheme === "dark") {
                document.body.classList.add("dark");
                this.themeToggleBtn.textContent = "☀️";
            }
        }
    }

    toggleTheme() {
        document.body.classList.toggle("dark");
        const isDark = document.body.classList.contains("dark");
        this.themeToggleBtn.textContent = isDark ? "☀️" : "🌙";
        localStorage.setItem("theme", isDark ? "dark" : "light");
    }

    async joinRoom() {
        const roomName = this.roomNameInput.value.trim();
        const username = this.usernameInput.value.trim();
        if (!roomName || !username) {
            alert('Please enter both room name and username');
            return;
        }
        this.currentRoom = roomName;
        this.currentUsername = username;
        this.joinBtn.disabled = true;
        this.joinBtn.textContent = 'Connecting...';

        try {
            await this.connectWebSocket();
            this.switchToChat();
        } catch (err) {
            alert('Failed to connect.');
            this.joinBtn.disabled = false;
            this.joinBtn.textContent = 'Join Room';
        }
    }

    connectWebSocket() {
        return new Promise((resolve, reject) => {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}/ws/${this.currentRoom}/${this.currentUsername}`;
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                console.log("[WS] Connected");
                this.isConnected = true;
                this.updateConnectionStatus(true);
                resolve();
            };

            this.ws.onmessage = async (event) => {
                const data = JSON.parse(event.data);
                console.log("[WS] Message:", data);
                await this.handleMessage(data);
            };

            this.ws.onclose = () => {
                this.isConnected = false;
                this.updateConnectionStatus(false);
                this.addSystemMessage("Connection closed.");
            };

            this.ws.onerror = (err) => reject(err);

            setTimeout(() => {
                if (!this.isConnected) reject(new Error("timeout"));
            }, 8000);
        });
    }

    switchToChat() {
        this.landingPanel.style.display = 'none';
        this.chatContainer.style.display = 'flex';
        this.currentRoomDisplay.textContent = `Room: ${this.currentRoom}`;
    }

    updateConnectionStatus(isOnline) {
        if (isOnline) {
            this.statusIndicator.classList.add('online');
            this.statusText.textContent = 'Connected';
        } else {
            this.statusIndicator.classList.remove('online');
            this.statusText.textContent = 'Disconnected';
        }
    }

    async handleMessage(data) {
        switch (data.type) {
            case "message":
                this.addChatMessage(data.user, data.content);
                break;

            case "join":
                this.updateUsersList(data.online);
                break;

            case "leave":
                this.updateUsersList(data.online);
                break;

            case "call_offer":
                if (data.to_user === this.currentUsername) {
                    this.showIncomingCall(data);
                }
                break;

            case "call_answer":
                await this.handleCallAnswer(data);
                break;

            case "ice_candidate":
                if (data.to_user === this.currentUsername && this.peerConnection) {
                    const cand = new RTCIceCandidate(data.candidate);
                    if (this.remoteDescriptionSet) {
                        await this.peerConnection.addIceCandidate(cand);
                    } else {
                        this.pendingRemoteCandidates.push(cand);
                    }
                }
                break;
        }
    }

    updateUsersList(users) {
        this.usersList.innerHTML = '';
        users.forEach(u => {
            const li = document.createElement('li');
            li.textContent = u;
            if (u === this.currentUsername) li.style.fontWeight = 'bold';
            this.usersList.appendChild(li);
        });
        this.onlineUsers = users;
    }

    sendMessage() {
        const content = this.messageInput.value.trim();
        if (!content) return;
        this.ws.send(JSON.stringify({ type: "message", content }));
        this.messageInput.value = '';
    }

    autoResizeTextarea() {
        this.messageInput.style.height = 'auto';
        this.messageInput.style.height = Math.min(this.messageInput.scrollHeight, 100) + 'px';
    }

    addChatMessage(username, content) {
        const div = document.createElement('div');
        div.className = `message ${username === this.currentUsername ? 'own' : 'other'}`;
        div.innerHTML = `<div class="message-header">${username}</div><div class="message-content">${content}</div>`;
        this.messagesPane.appendChild(div);
        this.messagesPane.scrollTop = this.messagesPane.scrollHeight;
    }

    addSystemMessage(content) {
        const div = document.createElement('div');
        div.className = 'system-message';
        div.textContent = content;
        this.messagesPane.appendChild(div);
    }

    createPeerConnection() {
        const iceServers = [
            { urls: "stun:stun.l.google.com:19302" },
            {
                urls: "turn:global.relay.metered.ca:80",
                username: "openai",
                credential: "openai123"
            },
            {
                urls: "turn:global.relay.metered.ca:443",
                username: "openai",
                credential: "openai123"
            }
        ];

        this.peerConnection = new RTCPeerConnection({ iceServers });

        this.peerConnection.onicecandidate = (e) => {
            if (e.candidate) {
                this.ws.send(JSON.stringify({
                    type: "ice_candidate",
                    from_user: this.currentUsername,
                    to_user: this.currentPeer,
                    candidate: e.candidate
                }));
            }
        };
        this.peerConnection.ontrack = (e) => {
            this.remoteVideo.srcObject = e.streams[0];
            this.remoteVideo.play().catch(()=>{});
        };
    }

    async startLocalStream(type) {
        this.localStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: type === "video" ? {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 30 }
            } : false
        });
        this.localVideo.srcObject = this.localStream;
        await this.localVideo.play().catch(()=>{});

        this.createPeerConnection();
        this.localStream.getTracks().forEach(t => this.peerConnection.addTrack(t, this.localStream));

        if (this.isCaller) {
            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);
            this.ws.send(JSON.stringify({
                type: "call_offer",
                from_user: this.currentUsername,
                to_user: this.currentPeer,
                call_type: type,
                sdp: offer
            }));
        }
    }

    initiateCall(type) {
        this.currentPeer = this.onlineUsers.find(u => u !== this.currentUsername);
        if (!this.currentPeer) {
            alert("No one to call.");
            return;
        }
        this.isCaller = true;
        this.callOverlay.classList.remove('hidden');
        this.startLocalStream(type);
    }

    showIncomingCall(offer) {
        this.pendingOffer = offer;
        this.callInfo.textContent = `${offer.from_user} is calling (${offer.call_type})`;
        this.incomingCallModal.classList.remove('hidden');
    }

    async answerCall(accepted) {
        this.incomingCallModal.classList.add('hidden');
        const offer = this.pendingOffer;
        this.pendingOffer = null;
        if (!offer) return;

        if (!accepted) {
            this.ws.send(JSON.stringify({ type: "call_answer", from_user: this.currentUsername, to_user: offer.from_user, accepted: false }));
            return;
        }

        this.currentPeer = offer.from_user;
        this.isCaller = false;
        this.callOverlay.classList.remove('hidden');
        await this.startLocalStream(offer.call_type);

        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer.sdp));
        this.remoteDescriptionSet = true;
        for (const c of this.pendingRemoteCandidates) await this.peerConnection.addIceCandidate(c);
        this.pendingRemoteCandidates = [];

        const answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);
        this.ws.send(JSON.stringify({ type: "call_answer", from_user: this.currentUsername, to_user: offer.from_user, accepted: true, sdp: answer }));
    }

    async handleCallAnswer(answer) {
        if (!answer.accepted) {
            this.endCall();
            return;
        }
        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer.sdp));
        this.remoteDescriptionSet = true;
        for (const c of this.pendingRemoteCandidates) await this.peerConnection.addIceCandidate(c);
        this.pendingRemoteCandidates = [];
    }

    toggleMute() {
        if (!this.localStream) return;
        const track = this.localStream.getAudioTracks()[0];
        track.enabled = !track.enabled;
        this.muteBtn.textContent = track.enabled ? "🔇" : "🔈";
    }

    endCall() {
        this.callOverlay.classList.add('hidden');
        if (this.localStream) this.localStream.getTracks().forEach(t => t.stop());
        if (this.remoteStream) this.remoteStream.getTracks().forEach(t => t.stop());
        if (this.peerConnection) this.peerConnection.close();
        this.localVideo.srcObject = null;
        this.remoteVideo.srcObject = null;
        this.peerConnection = null;
        this.localStream = null;
        this.remoteStream = null;
        this.isCaller = false;
        this.currentPeer = null;
    }
}

document.addEventListener("DOMContentLoaded", () => new ChatApp());