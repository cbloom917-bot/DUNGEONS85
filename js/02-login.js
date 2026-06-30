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

function setDmCharacterNameForMode(mode) {
    const nameInput = document.getElementById('char-name-input');
    if (!nameInput) return;

    if (mode === "rejoin") {
        const lastDmName = localStorage.getItem('d85LastDmName') || localStorage.getItem('d85LastPlayerName');
        nameInput.value = lastDmName || "Dungeon Master";
        return;
    }

    nameInput.value = "Dungeon Master";
}

function refreshDmRoomModeButtons() {
    const rejoinButton = document.getElementById('gm-rejoin');
    const createButton = document.getElementById('gm-create');
    const lastRoom = localStorage.getItem('d85LastRoomName');

    if (rejoinButton) {
        rejoinButton.innerText = lastRoom ? `REJOIN ${lastRoom}` : "REJOIN LAST";
        rejoinButton.classList.toggle('active', gmRoomMode === "rejoin");
    }

    if (createButton) {
        createButton.classList.toggle('active', gmRoomMode === "create");
    }
}

function applyDmRoomMode(mode) {
    const roomInput = document.getElementById('room-id-input');
    const lastRoom = localStorage.getItem('d85LastRoomName');

    if (mode === "rejoin" && lastRoom && roomInput) {
        gmRoomMode = "rejoin";
        roomInput.value = lastRoom;
        setDmCharacterNameForMode("rejoin");
    } else {
        gmRoomMode = "create";
        generateRandomRoomName(true);
        setDmCharacterNameForMode("create");
    }

    refreshDmRoomModeButtons();
}

function setRoleSelection(isDMSelection) {
    tableState.isDM = isDMSelection;

    const dmButton = document.getElementById('role-dm');
    const playerButton = document.getElementById('role-player');
    const gmRoomModeBox = document.getElementById('gm-room-mode');
    const gmRoomNote = document.getElementById('gm-room-note');
    const roomInput = document.getElementById('room-id-input');
    const nameInput = document.getElementById('char-name-input');

    if (dmButton) dmButton.classList.toggle('active', isDMSelection);
    if (playerButton) playerButton.classList.toggle('active', !isDMSelection);

    if (isDMSelection) {
        if (gmRoomModeBox) gmRoomModeBox.classList.remove('hidden');
        if (gmRoomNote) gmRoomNote.classList.remove('hidden');
        applyDmRoomMode("create");
    } else {
        gmRoomMode = "rejoin";
        if (gmRoomModeBox) gmRoomModeBox.classList.add('hidden');
        if (gmRoomNote) gmRoomNote.classList.add('hidden');
        if (roomInput) roomInput.value = "";
        if (nameInput) nameInput.value = localStorage.getItem('d85LastPlayerName') || "";
    }
}

function bindLoginControls() {
    const gmRejoinBtn = document.getElementById('gm-rejoin');
    const gmCreateBtn = document.getElementById('gm-create');

    if (gmRejoinBtn && gmCreateBtn) {
        gmCreateBtn.addEventListener('click', () => {
            applyDmRoomMode("create");
        });

        gmRejoinBtn.addEventListener('click', () => {
            applyDmRoomMode("rejoin");
        });
    }
}

function bindJoinButton() {
    const joinBtn = document.getElementById('join-btn');
    if (!joinBtn) return;

    joinBtn.addEventListener('click', async () => {
        const nameInput = document.getElementById('char-name-input').value.trim();
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
        if (tableState.isDM) localStorage.setItem('d85LastDmName', nameInput);

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
        closeAllPeerConnections();
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

            // Audio mute/unmute only toggles the existing track. Do not refresh
            // PeerJS calls here; renegotiating on mute caused remote videos to blink.
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
                refreshPeerMediaConnections("audio-permission");
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

            refreshPeerMediaConnections("camera-toggle");
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
                refreshPeerMediaConnections("camera-permission");
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


