// Dungeons '85 Public Beta 9.6 — 02-login.js
// Refactor-only split from js/main.js. Preserve load order in index.html.

// ============================================================
// Login and room selection
// ============================================================

function generateRandomRoomName(force = false) {
    const roomInput = document.getElementById('room-id-input');
    if (!roomInput) return;

    if (!force && roomInput.value.trim()) return;

    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const num = Math.floor(100 + Math.random() * 900);

    roomInput.value = `${adj}${noun}${num}`;
}

function setRoleSelection(isDMSelection) {
    tableState.isDM = isDMSelection;

    const dmButton = document.getElementById('role-dm');
    const playerButton = document.getElementById('role-player');
    const gmRoomModeBox = document.getElementById('gm-room-mode');
    const gmRoomNote = document.getElementById('gm-room-note');
    const roomInput = document.getElementById('room-id-input');

    if (dmButton) dmButton.classList.toggle('active', isDMSelection);
    if (playerButton) playerButton.classList.toggle('active', !isDMSelection);

    if (isDMSelection) {
        if (gmRoomModeBox) gmRoomModeBox.classList.remove('hidden');
        if (gmRoomNote) gmRoomNote.classList.remove('hidden');

        const lastRoom = localStorage.getItem('d85LastRoomName');
        const rejoinButton = document.getElementById('gm-rejoin');
        const createButton = document.getElementById('gm-create');

        if (lastRoom) {
            gmRoomMode = "rejoin";
            if (rejoinButton) {
                rejoinButton.innerText = `REJOIN ${lastRoom}`;
                rejoinButton.classList.add('active');
            }
            if (createButton) createButton.classList.remove('active');
            if (roomInput) roomInput.value = lastRoom;
        } else {
            gmRoomMode = "create";
            if (rejoinButton) {
                rejoinButton.innerText = "REJOIN LAST";
                rejoinButton.classList.remove('active');
            }
            if (createButton) createButton.classList.add('active');
            generateRandomRoomName(true);
        }
    } else {
        gmRoomMode = "rejoin";
        if (gmRoomModeBox) gmRoomModeBox.classList.add('hidden');
        if (gmRoomNote) gmRoomNote.classList.add('hidden');
        if (roomInput) roomInput.value = "";
    }
}

function bindLoginControls() {
    const gmRejoinBtn = document.getElementById('gm-rejoin');
    const gmCreateBtn = document.getElementById('gm-create');
    const roomInput = document.getElementById('room-id-input');

    if (gmRejoinBtn && gmCreateBtn) {
        gmRejoinBtn.addEventListener('click', () => {
            const lastRoom = localStorage.getItem('d85LastRoomName');
            if (!lastRoom || !roomInput) return;

            gmRoomMode = "rejoin";
            roomInput.value = lastRoom;
            gmRejoinBtn.classList.add('active');
            gmCreateBtn.classList.remove('active');
        });

        gmCreateBtn.addEventListener('click', () => {
            gmRoomMode = "create";
            generateRandomRoomName(true);
            gmCreateBtn.classList.add('active');
            gmRejoinBtn.classList.remove('active');
        });
    }
}

function bindJoinButton() {
    const joinBtn = document.getElementById('join-btn');
    if (!joinBtn) return;

    joinBtn.addEventListener('click', async () => {
        const nameInput = document.getElementById('char-name-input').value.trim();

        if (tableState.isDM && gmRoomMode === "create") {
            generateRandomRoomName(true);
        }

        const roomInput = document.getElementById('room-id-input').value.trim().toUpperCase();

        if (!nameInput || !roomInput) {
            alert("Please enter both a Character Name and a Room Name.");
            return;
        }

        tableState.playerName = nameInput;
        activeRoomName = roomInput;

        localStorage.setItem('d85LastRoomName', roomInput);
        localStorage.setItem('d85LastPlayerName', nameInput);
        localStorage.setItem('d85LastWasDM', tableState.isDM ? 'true' : 'false');

        try {
            await setupCameraAndVideo();
            initHybridMediaVttStack(roomInput, nameInput);
        } catch (e) {
            console.error("Failed to join: Camera setup failed.", e);
        }
    });
}

function resizeCanvas() {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    fogCanvas.width = canvas.width;
    fogCanvas.height = canvas.height;
    draw();
}

function initializeClient() {
    window.addEventListener('click', () => { ctxMenu.style.display = 'none'; });
    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('beforeunload', () => {
        if (socket) socket.disconnect();
        if (peer) peer.destroy();
    });

    window.addEventListener('keydown', (e) => {
        if (!tableState.isDM) return;
        if (e.code !== 'Space') return;

        const tag = document.activeElement?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'button') return;

        e.preventDefault();
        advanceInitiativeSpotlight();
    });

    bindLoginControls();
    bindJoinButton();
    draw();
}

window.setRoleSelection = setRoleSelection;
window.generateRandomRoomName = generateRandomRoomName;
window.addEventListener('DOMContentLoaded', initializeClient);

function forcePlayerFocus() {
        if (!tableState.isDM || !socket) return;
        socket.emit('forceCamera', tableState.camera);
        addResultToHistoryTicker("[SYS]", 0, "GM FORCED CAMERA FOCUS");
    }


async function toggleLocalAudio() {
        if (!localStream) {
            localStream = new MediaStream();
        }

        const existingTrack = localStream.getAudioTracks()[0];
        const btn = document.getElementById('toggle-mic-btn');

        if (existingTrack) {
            existingTrack.enabled = !existingTrack.enabled;
            if (btn) {
                btn.innerText = existingTrack.enabled ? "Mute" : "Unmute";
                btn.classList.toggle('muted-state', !existingTrack.enabled);
            }

            if (existingTrack.enabled) {
                clearLocalMediaStatus("mic");
            } else {
                showLocalMediaStatus("mic", "MIC OFF");
            }

            refreshPeerMediaConnections();
            return;
        }

        try {
            const micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            const audioTrack = micStream.getAudioTracks()[0];

            if (audioTrack) {
                localStream.addTrack(audioTrack);

                const localVideo = document.getElementById('local-video');
                if (localVideo) localVideo.srcObject = localStream;

                if (btn) {
                    btn.innerText = "Mute";
                    btn.classList.remove('muted-state');
                }

                clearLocalMediaStatus("mic");
                console.log("DEBUG: Microphone permission granted on demand.");
                refreshPeerMediaConnections();
            }
        } catch (err) {
            console.warn("DEBUG: Microphone access denied on demand:", err);
            showLocalMediaStatus("mic", "MIC BLOCKED — ENABLE IT IN BROWSER SETTINGS");
            if (btn) {
                btn.innerText = "Unmute";
                btn.classList.add('muted-state');
            }
        }
    }


async function toggleLocalVideo() {
        if (!localStream) {
            localStream = new MediaStream();
        }

        const existingTrack = localStream.getVideoTracks()[0];
        const btn = document.getElementById('toggle-cam-btn');

        if (existingTrack) {
            existingTrack.enabled = !existingTrack.enabled;
            if (btn) {
                btn.innerText = existingTrack.enabled ? "Cam Off" : "Cam On";
                btn.classList.toggle('muted-state', !existingTrack.enabled);
            }

            if (existingTrack.enabled) {
                clearLocalMediaStatus("cam");
            } else {
                showLocalMediaStatus("cam", "CAMERA OFF");
            }

            refreshPeerMediaConnections();
            return;
        }

        try {
            const cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            const videoTrack = cameraStream.getVideoTracks()[0];

            if (videoTrack) {
                localStream.addTrack(videoTrack);

                const localVideo = document.getElementById('local-video');
                if (localVideo) localVideo.srcObject = localStream;

                if (btn) {
                    btn.innerText = "Cam Off";
                    btn.classList.remove('muted-state');
                }

                clearLocalMediaStatus("cam");
                console.log("DEBUG: Camera permission granted on demand.");
                refreshPeerMediaConnections();
            }
        } catch (err) {
            console.warn("DEBUG: Camera access denied on demand:", err);
            showLocalMediaStatus("cam", "CAMERA BLOCKED — ENABLE IT IN BROWSER SETTINGS");
            if (btn) {
                btn.innerText = "Cam On";
                btn.classList.add('muted-state');
            }
        }
    }


