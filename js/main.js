// ============================================================
// Dungeons '85 — Client Runtime
// Version 9.0 Public Beta cleanup pass
// ============================================================

const APP_VERSION = "9.0 Public Beta";
const SERVER_URL = "https://newvtt.onrender.com";
const DEFAULT_TOKEN_SIZE = 70;
const GRID_SIZE = 40;

let tableState = {
    playerName: '',
    isDM: false,
    mapSrc: null,
    tokens: [],
    camera: { x: 0, y: 0, zoom: 1 },
    fowEnabled: false,
    fowPolygons: [],
    isDarknessActive: false
};

let tokenImageCache = {};
let socket = null;
let peer = null;
let localStream = null;
let currentActiveRoomArray = [];
let localPeerId = null;
let activeRoomName = '';
let initiativePeerId = null;
let customVideoOrder = [];

let isDrawingFoW = false;
let currentFoWPolygon = [];
let currentMouseWorldX = 0;
let currentMouseWorldY = 0;
let contextSelectedToken = null;
let gmRoomMode = "create";

const canvas = document.getElementById('vtt-canvas');
const ctx = canvas.getContext('2d');
const ctxMenu = document.getElementById('ctx-menu');
const fogCanvas = document.createElement('canvas');
const fogCtx = fogCanvas.getContext('2d');

const adjectives = ["Dark", "Iron", "Black", "Silent", "Bitter", "Deep", "Lost", "Fallen", "Death", "Broken"];
const nouns = ["Crypt", "Spawn", "Vault", "Temple", "Bloom", "Pit", "Crawl", "Keep", "Void", "Abyss"];

// ============================================================
// Loading overlay and asset loading
// ============================================================

function showLoading(msg = "RECONSTRUCTING DUNGEON...") {
    document.getElementById('loading-msg').innerText = msg;
    document.getElementById('loading-overlay').style.display = 'flex';
}

function hideLoading() {
    document.getElementById('loading-overlay').style.display = 'none';
}

async function loadCloudImage(src) {
    if (!src) return null;
    if (tokenImageCache[src] && tokenImageCache[src].complete) return tokenImageCache[src];

    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            tokenImageCache[src] = img;
            resolve(img);
        };
        img.onerror = () => reject(new Error(`Image failed to load: ${src}`));
        img.src = src;
    });
}

function selectLocalFile(mode) {
    if (!tableState.isDM) return;

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';

    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        showLoading("PROCESSING ASSET...");

        const reader = new FileReader();
        reader.onload = (event) => {
            const dataUrl = event.target.result;

            if (mode === 'MAP') {
                tableState.mapSrc = dataUrl;
                if (socket) socket.emit('updateMapImage', dataUrl);
            } else {
                tableState.tokens.push({
                    id: `token-${Date.now()}`,
                    src: dataUrl,
                    x: (canvas.width / 2 - tableState.camera.x) / tableState.camera.zoom,
                    y: (canvas.height / 2 - tableState.camera.y) / tableState.camera.zoom,
                    size: DEFAULT_TOKEN_SIZE,
                    hidden: true
                });
                broadcastTokensMatrixChange();
            }

            loadCloudImage(dataUrl).then(() => {
                hideLoading();
                draw();
            }).catch((err) => {
                console.error(err);
                hideLoading();
            });
        };

        reader.readAsDataURL(file);
    };

    input.click();
}

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


    function toggleLocalAudio() {
        if (!localStream) return;
        const track = localStream.getAudioTracks()[0];
        if (track) {
            track.enabled = !track.enabled;
            const btn = document.getElementById('toggle-mic-btn');
            btn.innerText = track.enabled ? "Mute" : "Unmute";
            btn.classList.toggle('muted-state', !track.enabled);
        }
    }


    function toggleLocalVideo() {
        if (!localStream) return;
        const track = localStream.getVideoTracks()[0];
        if (track) {
            track.enabled = !track.enabled;
            const btn = document.getElementById('toggle-cam-btn');
            btn.innerText = track.enabled ? "Cam Off" : "Cam On";
            btn.classList.toggle('muted-state', !track.enabled);
        }
    }


// ============================================================
// Networking: Socket.IO + PeerJS
// ============================================================

function initHybridMediaVttStack(roomName, playerName) {
    console.log("DEBUG: initHybridMediaVttStack started", roomName, playerName);

    if (socket) {
        socket.disconnect();
        socket = null;
    }

    if (peer) {
        peer.destroy();
        peer = null;
    }

    const webrtcIceConfig = {
        config: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' }
            ]
        }
    };

    peer = new Peer(undefined, webrtcIceConfig);

    peer.on('disconnected', () => {
        console.log("DEBUG: PeerJS disconnected; attempting reconnect");
        peer.reconnect();
    });

    peer.on('error', (err) => {
        console.error("DEBUG: PeerJS error:", err);
    });

    peer.on('open', (peerId) => {
        console.log("DEBUG: PeerJS open", peerId);
        localPeerId = peerId;

        socket = io(SERVER_URL, {
            transports: ["websocket"]
        });

        socket.on('connect', () => {
            console.log("DEBUG: Socket connected", socket.id);
            activeRoomName = roomName;

            const localVideoBox = document.getElementById('local-video-container');
            if (localVideoBox) {
                localVideoBox.dataset.peerId = localPeerId || "local";
                localVideoBox.dataset.name = tableState.playerName || "You";
                localVideoBox.dataset.isDm = tableState.isDM ? "true" : "false";
                setupVideoBoxInitiative(localVideoBox);
            }

            document.getElementById('room-display').innerText = `Room: ${roomName}`;
            document.getElementById('top-nav').classList.add('hidden');
            document.getElementById('login-screen').classList.add('hidden');
            document.getElementById('vtt-interface').classList.remove('hidden');
            sortVideoRibbon();

            const emptyMsg = document.getElementById('ticker-empty-msg');
            if (emptyMsg) emptyMsg.remove();

            if (!tableState.isDM) {
                const dmToolbar = document.getElementById('toolbar-right');
                if (dmToolbar) dmToolbar.remove();
            }

            setTimeout(() => {
                resizeCanvas();
                makeElementsDraggable();
            }, 50);

            socket.emit('joinRoom', {
                roomName,
                playerName,
                isDM: tableState.isDM,
                peerId
            });

            setTimeout(() => {
                const entryMessage = tableState.isDM
                    ? `${tableState.playerName} HAS CREATED THE TABLE`
                    : `${tableState.playerName} HAS JOINED THE TABLE`;

                socket.emit('playerNotification', entryMessage);
            }, 500);
        });

        socket.on('connect_error', (err) => {
            console.error("DEBUG: Socket connection error:", err);
        });

        socket.on('joinError', (message) => {
            alert(message);
            window.location.reload();
        });

        socket.on('updatePlayerList', (playersArray) => {
            console.log("DEBUG: updatePlayerList", playersArray);

            const previousPlayers = currentActiveRoomArray || [];

            previousPlayers.forEach(oldPlayer => {
                const stillConnected = playersArray.some(p => p.peerId === oldPlayer.peerId);
                if (!stillConnected) {
                    const deadBox = document.getElementById(`video-${oldPlayer.peerId}`);
                    if (deadBox) deadBox.remove();
                }
            });

            playersArray.forEach(p => {
                const existingVideoBox = document.getElementById(`video-${p.peerId}`);
                if (existingVideoBox) {
                    existingVideoBox.dataset.name = p.name || 'Player';
                    existingVideoBox.dataset.isDm = p.isDM ? 'true' : 'false';
                    setupVideoBoxInitiative(existingVideoBox);
                    const label = document.getElementById(`label-${p.peerId}`);
                    if (label) label.innerText = p.name || 'Player';
                }
            });

            playersArray.forEach(p => {
                const wasKnown = previousPlayers.some(existing => existing.peerId === p.peerId);

                if (p.peerId !== peerId && !wasKnown && localStream) {
                    const call = peer.call(p.peerId, localStream);

                    call.on('stream', (remoteStream) => {
                        addVideoFeed(remoteStream, call.peer, p.name, p.isDM);
                    });

                    call.on('error', (err) => {
                        console.error("DEBUG: Outgoing PeerJS call error:", err);
                    });
                }
            });

            currentActiveRoomArray = sortPlayersForRibbon(playersArray);
            sortVideoRibbon();
        });

        peer.on('call', (call) => {
            console.log("DEBUG: Incoming PeerJS call from", call.peer);

            if (!localStream) {
                console.warn("DEBUG: No local stream available to answer call");
                return;
            }

            call.answer(localStream);

            call.on('stream', (remoteStream) => {
                const caller = currentActiveRoomArray.find(p => p.peerId === call.peer);
                const displayName = caller ? caller.name : "Player";
                addVideoFeed(remoteStream, call.peer, displayName, caller ? caller.isDM : false);
            });

            call.on('error', (err) => {
                console.error("DEBUG: Incoming PeerJS call error:", err);
            });
        });

        socket.on('syncMap', (mapSrc) => {
            tableState.mapSrc = mapSrc;
            loadCloudImage(mapSrc).then(() => draw());
        });

        socket.on('syncTokens', (incomingTokens) => {
            tableState.tokens = incomingTokens;
            incomingTokens.forEach(t => loadCloudImage(t.src).then(() => draw()));
            draw();
        });

        socket.on('tokenMoved', (data) => {
            const match = tableState.tokens.find(t => t.id === data.id);
            if (match) {
                match.x = data.x;
                match.y = data.y;
                draw();
            }
        });

        socket.on('diceRolledAnimation', (data) => {
            executeDiceOverlayAnimation(
                data.sides,
                data.result,
                data.player,
                data.screenX,
                data.screenY
            );
        });

        socket.on('playerNotification', (msg) => {
            addResultToHistoryTicker("[SYS]", 0, msg);
        });

        socket.on('syncCamera', (cameraData) => {
            if (tableState.isDM) return;

            tableState.camera.x = cameraData.x;
            tableState.camera.y = cameraData.y;
            tableState.camera.zoom = cameraData.zoom;

            draw();
            addResultToHistoryTicker("[SYS]", 0, "VIEW FOCUSED BY GM");
        });

        socket.on('syncFoW', (fowData) => {
            tableState.fowEnabled = fowData.enabled;
            tableState.fowPolygons = fowData.polygons;

            if (fowData.darkness !== undefined) {
                tableState.isDarknessActive = fowData.darkness;
            }

            if (tableState.isDM) updateFogUI();
            draw();
        });

        socket.on('syncInitiativeSpotlight', (peerId) => {
            console.log("DEBUG: syncInitiativeSpotlight received", peerId);
            setInitiativeSpotlight(peerId);
        });

        socket.on('syncVideoOrder', (peerOrder) => {
            applyVideoOrder(peerOrder);
        });
    });
}

// ============================================================
// Fog of War, darkness, and table-state broadcasting
// ============================================================

function toggleFogPanel() {
        if (!tableState.isDM) return;
        document.getElementById('fog-panel').classList.toggle('hidden');
    }


    function broadcastFoW() {
        if (!tableState.isDM || !socket) return;
        socket.emit('updateFoW', { 
            enabled: tableState.fowEnabled, 
            polygons: tableState.fowPolygons,
            darkness: tableState.isDarknessActive 
        });
    }
    function broadcastFullTableState() {
        if (!tableState.isDM || !socket) return;

        if (tableState.mapSrc) {
        socket.emit('updateMapImage', tableState.mapSrc);
        }

        broadcastTokensMatrixChange();
        broadcastFoW();
    }

    function toggleFogMode() {
        if (!tableState.isDM) return;
        tableState.fowEnabled = !tableState.fowEnabled;
        if (!tableState.fowEnabled) {
            isDrawingFoW = false; 
            currentFoWPolygon = [];
        }
        updateFogUI();
        broadcastFoW();
        draw();
    }


    function toggleFogDraw() {
        if (!tableState.isDM || !tableState.fowEnabled) return;
        isDrawingFoW = !isDrawingFoW;
        currentFoWPolygon = [];
        updateFogUI();
        draw();
    }


    function resetFog() {
        if (!tableState.isDM) return;
        tableState.fowPolygons = [];
        currentFoWPolygon = [];
        isDrawingFoW = false;
        updateFogUI();
        broadcastFoW();
        draw();
    }


    function updateFogUI() {
    const btnToggle = document.getElementById('btn-fog-toggle');
    const btnDraw = document.getElementById('btn-fog-draw');
    const btnReset = document.getElementById('btn-fog-reset');

    if (!btnToggle) return;

    if (tableState.fowEnabled) {
        btnToggle.innerText = "Disable Fog";
        btnToggle.style.background = "#fff";
        btnToggle.style.color = "#000";
        btnDraw.style.display = "block";
        btnReset.style.display = "block";
    } else {
        btnToggle.innerText = "Enable Fog";
        btnToggle.style.background = "#000";
        btnToggle.style.color = "#fff";
        btnDraw.style.display = "none";
        btnReset.style.display = "none";
    }

    if (isDrawingFoW) {
        btnDraw.innerText = "[ PLOTTING ]";
        btnDraw.style.background = "#ff3333";
        btnDraw.style.color = "#fff";
        btnDraw.style.borderColor = "#ff3333";
        document.getElementById('vtt-canvas').classList.add('plotting');
    } else {
        btnDraw.innerText = "PLOT REVEAL";
        btnDraw.style.background = "#000";
        btnDraw.style.color = "#fff";
        btnDraw.style.borderColor = "#fff";
        document.getElementById('vtt-canvas').classList.remove('plotting');
    }
}


    function broadcastTokensMatrixChange() {
        if (!tableState.isDM || !socket) return;
        const leanTokens = tableState.tokens.map(t => ({
            id: t.id,
            src: t.src, 
            x: t.x,
            y: t.y,
            size: t.size,
            hidden: t.hidden
        }));
        socket.emit('updateTokensMatrix', leanTokens);
    }


    function importAdventureJson(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const json = JSON.parse(e.target.result);
                tableState.tokens = json.tokens || [];
                tableState.mapSrc = json.savedMapSrc || null;


                tableState.fowEnabled = json.fowEnabled || false;
                tableState.fowPolygons = json.fowPolygons || [];
                tableState.isDarknessActive = json.isDarknessActive || false;


                if (tableState.mapSrc) {
                    socket.emit('updateMapImage', tableState.mapSrc);
                    loadCloudImage(tableState.mapSrc).then(() => draw());
                }
                broadcastTokensMatrixChange();


                if (tableState.isDM) {
                    updateFogUI();
                    broadcastFoW();
                }


                tableState.tokens.forEach(t => loadCloudImage(t.src).then(() => draw()));
                draw();
            } catch (err) { alert("JSON Parse Error."); }
        };
        reader.readAsText(file);
    }


// ============================================================
// Canvas interaction: camera, tokens, context menu
// ============================================================

let isDraggingWorkspace = false;
    let dragStart = { x: 0, y: 0 };
    let selectedToken = null;


    canvas.addEventListener('contextmenu', (e) => {
        if (!tableState.isDM) return; 
        e.preventDefault();


        if (isDrawingFoW) {
            currentFoWPolygon = [];
            isDrawingFoW = false;
            updateFogUI();
            draw();
            return;
        }


        const rect = canvas.getBoundingClientRect();
        const worldX = (e.clientX - rect.left - tableState.camera.x) / tableState.camera.zoom;
        const worldY = (e.clientY - rect.top - tableState.camera.y) / tableState.camera.zoom;
        contextSelectedToken = null;
        for (let i = tableState.tokens.length - 1; i >= 0; i--) {
            const t = tableState.tokens[i];
            if (Math.hypot(t.x - worldX, t.y - worldY) < t.size / 2) { contextSelectedToken = t; break; }
        }
        if (contextSelectedToken) {
            ctxMenu.style.left = `${e.clientX}px`; ctxMenu.style.top = `${e.clientY}px`; ctxMenu.style.display = 'block';
        }
    });


    canvas.addEventListener('mousedown', (e) => {
        if (e.button === 2) return; 
        ctxMenu.style.display = 'none';
        const rect = canvas.getBoundingClientRect();
        const worldX = (e.clientX - rect.left - tableState.camera.x) / tableState.camera.zoom;
        const worldY = (e.clientY - rect.top - tableState.camera.y) / tableState.camera.zoom;


        if (tableState.isDM && isDrawingFoW && e.button === 0) {
            const dist = currentFoWPolygon.length > 0 ? Math.hypot(currentFoWPolygon[0].x - worldX, currentFoWPolygon[0].y - worldY) : Infinity;


            if (currentFoWPolygon.length > 2 && dist < (20 / tableState.camera.zoom)) {
                tableState.fowPolygons.push([...currentFoWPolygon]);
                currentFoWPolygon = [];
                isDrawingFoW = false;
                updateFogUI();
                broadcastFoW();
            } else {
                currentFoWPolygon.push({x: worldX, y: worldY});
            }
            draw();
            return; 
        }


        selectedToken = null;
        for (let i = tableState.tokens.length - 1; i >= 0; i--) {
            const t = tableState.tokens[i];
            if (!tableState.isDM && t.hidden) continue;
            if (Math.hypot(t.x - worldX, t.y - worldY) < t.size / 2) {
                selectedToken = t; 
                break; 
            }
        }
        isDraggingWorkspace = !selectedToken; 
        dragStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    });


    canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left; 
        const mouseY = e.clientY - rect.top;


        currentMouseWorldX = (mouseX - tableState.camera.x) / tableState.camera.zoom;
        currentMouseWorldY = (mouseY - tableState.camera.y) / tableState.camera.zoom;


        if (tableState.isDM && isDrawingFoW && currentFoWPolygon.length > 0) {
            draw(); 
        }


        if (!isDraggingWorkspace && !selectedToken) return;


        const dx = (mouseX - dragStart.x) / tableState.camera.zoom;
        const dy = (mouseY - dragStart.y) / tableState.camera.zoom;


        if (selectedToken) {
            selectedToken.x += dx;
            selectedToken.y += dy;
            if (socket) { socket.emit('tokenMove', { id: selectedToken.id, x: selectedToken.x, y: selectedToken.y }); }
        } else if (isDraggingWorkspace) {
            tableState.camera.x += (mouseX - dragStart.x);
            tableState.camera.y += (mouseY - dragStart.y);
        }
        dragStart = { x: mouseX, y: mouseY }; 
        draw();
    });


    window.addEventListener('mouseup', () => {
        if (selectedToken) broadcastTokensMatrixChange();
        isDraggingWorkspace = false; selectedToken = null;
    });


    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        if (e.deltaY < 0) tableState.camera.zoom *= 1.1; else tableState.camera.zoom /= 1.1;
        draw();
    });


    function executeContextResize(newSize) {
        if (!contextSelectedToken) return;
        contextSelectedToken.size = newSize;
        draw();
        broadcastTokensMatrixChange();
    }


    function executeContextReveal() {
        if (!contextSelectedToken) return; contextSelectedToken.hidden = !contextSelectedToken.hidden;
        draw(); broadcastTokensMatrixChange();
    }


    function executeContextDuplicate() {
        if (!contextSelectedToken) return;
        const clone = {
            id: "token-" + Date.now() + Math.random(), src: contextSelectedToken.src,
            x: contextSelectedToken.x + 20, y: contextSelectedToken.y,
            size: contextSelectedToken.size, hidden: contextSelectedToken.hidden
        };
        tableState.tokens.push(clone); draw(); broadcastTokensMatrixChange();
    }


    function executeContextDelete() {
        if (!contextSelectedToken) return;
        tableState.tokens = tableState.tokens.filter(t => t.id !== contextSelectedToken.id);
        draw(); broadcastTokensMatrixChange();
    }


    function makeElementsDraggable() {
        document.querySelectorAll('.toolbar').forEach(toolbar => {
            const handle = toolbar.querySelector('.panel-label');
            let xOffset = 0, yOffset = 0, xStart = 0, yStart = 0;
            handle.onmousedown = (e) => {
                xStart = e.clientX; yStart = e.clientY;
                document.onmousemove = (ev) => {
                    ev.preventDefault();
                    xOffset = xStart - ev.clientX; yOffset = yStart - ev.clientY;
                    xStart = ev.clientX; yStart = ev.clientY;
                    toolbar.style.top = (toolbar.offsetTop - yOffset) + "px";
                    toolbar.style.left = (toolbar.offsetLeft - xOffset) + "px";
                };
                document.onmouseup = () => { document.onmousemove = null; document.onmouseup = null; };
            };
        });
    }


// ============================================================
// Canvas rendering
// ============================================================

async function draw() {
        ctx.fillStyle = '#000000'; 
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.save(); 
        ctx.translate(tableState.camera.x, tableState.camera.y); 
        ctx.scale(tableState.camera.zoom, tableState.camera.zoom);


        const viewLeft = -tableState.camera.x / tableState.camera.zoom;
        const viewRight = (canvas.width - tableState.camera.x) / tableState.camera.zoom;
        const viewTop = -tableState.camera.y / tableState.camera.zoom;
        const viewBottom = (canvas.height - tableState.camera.y) / tableState.camera.zoom;


        let mapImgAsset = tokenImageCache[tableState.mapSrc];
        if (mapImgAsset && mapImgAsset.complete) {
            ctx.drawImage(mapImgAsset, -mapImgAsset.width / 2, -mapImgAsset.height / 2);
        } else {
            ctx.strokeStyle = '#1c1c1c'; ctx.lineWidth = 1;
            const startX = Math.floor(viewLeft / 40) * 40;
            const endX = Math.ceil(viewRight / 40) * 40;
            const startY = Math.floor(viewTop / 40) * 40;
            const endY = Math.ceil(viewBottom / 40) * 40;


            ctx.beginPath();
            for (let i = startX; i <= endX; i += 40) { ctx.moveTo(i, startY); ctx.lineTo(i, endY); }
            for (let i = startY; i <= endY; i += 40) { ctx.moveTo(startX, i); ctx.lineTo(endX, i); }
            ctx.stroke();
        }


        for (let t of tableState.tokens) {
            if (t.hidden && !tableState.isDM) continue;
            if (t.x + t.size / 2 < viewLeft || t.x - t.size / 2 > viewRight || t.y + t.size / 2 < viewTop || t.y - t.size / 2 > viewBottom) {
                continue;
            }


            ctx.save();
            if (tableState.isDM && t.hidden) ctx.globalAlpha = 0.50;
            let imgAsset = tokenImageCache[t.src];
            if (imgAsset && imgAsset.complete) {
                ctx.drawImage(imgAsset, t.x - t.size / 2, t.y - t.size / 2, t.size, t.size);
            }
            ctx.restore();
        }


        if (tableState.fowEnabled) {
            fogCtx.globalCompositeOperation = 'source-over';
            fogCtx.clearRect(0, 0, fogCanvas.width, fogCanvas.height);
            fogCtx.fillStyle = tableState.isDM ? 'rgba(0, 0, 0, 0.65)' : '#000000';
            fogCtx.fillRect(0, 0, fogCanvas.width, fogCanvas.height);


            fogCtx.save();
            fogCtx.translate(tableState.camera.x, tableState.camera.y);
            fogCtx.scale(tableState.camera.zoom, tableState.camera.zoom);
            fogCtx.globalCompositeOperation = 'destination-out';
            fogCtx.fillStyle = '#000'; 


            for (let poly of tableState.fowPolygons) {
                if (poly.length < 3) continue;
                fogCtx.beginPath();
                fogCtx.moveTo(poly[0].x, poly[0].y);
                for (let i = 1; i < poly.length; i++) {
                    fogCtx.lineTo(poly[i].x, poly[i].y);
                }
                fogCtx.closePath();
                fogCtx.fill(); 
            }
            fogCtx.restore();


            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0); 
            ctx.drawImage(fogCanvas, 0, 0);
            ctx.restore();
        }


        if (tableState.isDM && isDrawingFoW && currentFoWPolygon.length > 0) {
            ctx.save();
            ctx.strokeStyle = '#ff3333';
            ctx.lineWidth = 2 / tableState.camera.zoom;


            ctx.beginPath();
            ctx.moveTo(currentFoWPolygon[0].x, currentFoWPolygon[0].y);
            for (let i = 1; i < currentFoWPolygon.length; i++) {
                ctx.lineTo(currentFoWPolygon[i].x, currentFoWPolygon[i].y);
            }
            ctx.lineTo(currentMouseWorldX, currentMouseWorldY);
            ctx.stroke();


            ctx.fillStyle = '#ff3333';
            ctx.beginPath();
            ctx.arc(currentFoWPolygon[0].x, currentFoWPolygon[0].y, 6 / tableState.camera.zoom, 0, Math.PI * 2);
            ctx.fill();


            ctx.restore();
        }


        ctx.restore(); 


        if (tableState.isDarknessActive) {
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0); 
            ctx.fillStyle = tableState.isDM ? 'rgba(0, 0, 0, 0.4)' : 'rgba(0, 0, 0, 0.95)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.restore();
        }
    }


// ============================================================
// Dice, torch, and turn tracker
// ============================================================

function rollDice(sides) {
        const finalResult = Math.floor(Math.random() * sides) + 1;
        socket.emit('executeDiceRoll', {
            sides, result: finalResult, player: tableState.playerName,
            screenX: Math.floor(15 + Math.random() * 60), screenY: Math.floor(15 + Math.random() * 60)
        });
    }


    function executeDiceOverlayAnimation(sides, result, rollerName, posX, posY) {
        const interfaceWrapper = document.getElementById('vtt-interface');
        const container = document.createElement('div'); container.className = 'dice-container-overlay';
        container.style.left = `${posX}%`; container.style.top = `${posY}%`;
        const spriteFrame = document.createElement('div'); spriteFrame.className = 'dice-sprite-frame';
        spriteFrame.style.backgroundImage = `url('assets/dice/d${sides}.png')`;
        const numberOverlay = document.createElement('div'); numberOverlay.className = 'dice-numerical-overlay';
        numberOverlay.innerText = result;
        const labelCard = document.createElement('div'); labelCard.className = 'dice-player-label';
        labelCard.innerText = rollerName;
        spriteFrame.appendChild(numberOverlay); container.appendChild(spriteFrame);
        container.appendChild(labelCard); interfaceWrapper.appendChild(container);
        let frameIdx = 0; const maxTumbleCycles = 12; let frameCounter = 0;
        const tumbleTimer = setInterval(() => {
            frameIdx = (frameIdx + 1) % 6; spriteFrame.style.backgroundPosition = `-${frameIdx * 100}px 0px`;
            frameCounter++;
            if (frameCounter >= maxTumbleCycles) {
                clearInterval(tumbleTimer); spriteFrame.style.backgroundPosition = `-600px 0px`;
                numberOverlay.style.display = 'block'; addResultToHistoryTicker(rollerName, sides, result);
                setTimeout(() => { container.style.opacity = '0'; setTimeout(() => container.remove(), 500); }, 5000);
            }
        }, 75);
    }


    function addResultToHistoryTicker(player, sides, result) {
        const ticker = document.getElementById('ticker-log');
        const emptyMsg = document.getElementById('ticker-empty-msg');
        if (emptyMsg) emptyMsg.remove();
        const logEntry = document.createElement('div'); logEntry.className = 'ticker-entry';
        logEntry.innerHTML = sides === 0 
            ? `<span>[SYS]</span> ${result}`
            : `<span>[${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}]</span> ${player} ROLLED D${sides}: ${result}`;
        ticker.appendChild(logEntry);
        ticker.scrollLeft = ticker.scrollWidth;
    }


    let torchInterval = null;
    let torchSeconds = 0;


    function toggleTorchPanel() {
        if (!tableState.isDM) return; 
        document.getElementById('torch-panel').classList.toggle('hidden');
    }


    function igniteTorch() {
        clearInterval(torchInterval);
        const randomDeduction = Math.floor(Math.random() * 301);
        torchSeconds = 3600 - randomDeduction;


        document.getElementById('torch-light-btn').classList.add('active');
        document.getElementById('torch-dark-status').classList.remove('active');
        updateTorchDisplay();


        if (tableState.isDarknessActive) {
            tableState.isDarknessActive = false;
            updateFogUI();
            broadcastFoW();
            draw();
            addResultToHistoryTicker("[SYS]", 0, "NEW TORCH IGNITED");
        }


        torchInterval = setInterval(() => {
            torchSeconds--;
            if (torchSeconds <= 0) {
                torchSeconds = 0;
                extinguishTorch();
            }
            updateTorchDisplay();
        }, 1000);
    }


    function extinguishTorch() {
        clearInterval(torchInterval);
        document.getElementById('torch-light-btn').classList.remove('active');
        document.getElementById('torch-dark-status').classList.add('active');
        updateTorchDisplay();


        if (!tableState.isDarknessActive) {
            tableState.isDarknessActive = true;
            updateFogUI();
            broadcastFoW();
            draw();
            addResultToHistoryTicker("[SYS]", 0, "TORCH EXPIRED: LIGHTS OUT");
        }
    }


    function updateTorchDisplay() {
        const m = Math.floor(torchSeconds / 60).toString().padStart(2, '0');
        const s = (torchSeconds % 60).toString().padStart(2, '0');
        document.getElementById('torch-clock').innerText = `${m}:${s}`;
    }


    function toggleTurnTracker() {
        if (!tableState.isDM) return;
        document.getElementById('turn-tracker-panel').classList.toggle('hidden');
    }


    function checkTurn(boxNum) {
        const box = document.getElementById(`turn-box-${boxNum}`);
        const msgDiv = document.getElementById('turn-message');


        if (box.classList.contains('checked')) {
            box.classList.remove('checked');
            msgDiv.innerHTML = ""; 
        } else {
            box.classList.add('checked');
            const messages = {
                1: "TURN 1 ELAPSED",
                2: "W: WANDERING MONSTER CHECK",
                3: "TURN 3 ELAPSED",
                4: "W: WANDERING MONSTER CHECK",
                5: "TURN 5 ELAPSED",
                6: "W: WANDERING MONSTER CHECK<br>R: PARTY MUST REST FOR 1 TURN<br>T: TORCH EXPIRES"
            };
            msgDiv.innerHTML = messages[boxNum];
        }
    }


    function resetTurns() {
        for(let i = 1; i <= 6; i++) {
            document.getElementById(`turn-box-${i}`).classList.remove('checked');
        }
        document.getElementById('turn-message').innerHTML = "";
    }


// ============================================================
// Media and persistence
// ============================================================

async function setupCameraAndVideo() {
    try {
        // Request video and audio
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        
        // Display local stream in the local video box
        const localVideo = document.getElementById('local-video');
        localVideo.srcObject = localStream;
        console.log("DEBUG: Camera access granted.");
    } catch (err) {
        console.error("DEBUG: Camera access failed:", err);
        alert("Camera/Mic access is required to see other players. Please allow permissions.");
        throw err; // Stop execution if camera fails
    }
}

function sortPlayersForRibbon(players) {
    return [...(players || [])].sort((a, b) => {
        if (a.isDM && !b.isDM) return -1;
        if (!a.isDM && b.isDM) return 1;
        return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
    });
}

function sortVideoRibbon() {
    const ribbon = document.querySelector('.video-ribbon');
    if (!ribbon) return;

    const boxes = Array.from(ribbon.querySelectorAll('.video-box'));

    boxes.sort((a, b) => {
        const aPeerId = a.dataset.peerId;
        const bPeerId = b.dataset.peerId;

        // Once the DM manually arranges the table, that custom seating order wins.
        // This includes the DM's own video, so the DM can sit anywhere in the clockwise order.
        if (customVideoOrder.length) {
            const aCustomIndex = customVideoOrder.indexOf(aPeerId);
            const bCustomIndex = customVideoOrder.indexOf(bPeerId);

            if (aCustomIndex !== -1 && bCustomIndex !== -1) return aCustomIndex - bCustomIndex;
            if (aCustomIndex !== -1) return -1;
            if (bCustomIndex !== -1) return 1;
        }

        // Default table layout before custom seating: DM first, then players alphabetically.
        const aIsDM = a.dataset.isDm === 'true';
        const bIsDM = b.dataset.isDm === 'true';

        if (aIsDM && !bIsDM) return -1;
        if (!aIsDM && bIsDM) return 1;

        const aName = (a.dataset.name || '').toUpperCase();
        const bName = (b.dataset.name || '').toUpperCase();
        return aName.localeCompare(bName);
    });

    boxes.forEach(box => ribbon.appendChild(box));

    if (initiativePeerId) {
        setInitiativeSpotlight(initiativePeerId);
    }
}

function setupVideoBoxInitiative(box) {
    if (!box || box.dataset.initiativeBound === "true") return;

    box.dataset.initiativeBound = "true";

    box.addEventListener('click', () => {
        if (!tableState.isDM) return;

        const peerId = box.dataset.peerId;
        if (!peerId) return;

        const nextPeerId = initiativePeerId === peerId ? null : peerId;

        setInitiativeSpotlight(nextPeerId);

        if (socket) {
            socket.emit('setInitiativeSpotlight', nextPeerId);
        }
    });

    box.draggable = tableState.isDM;

    box.addEventListener('dragstart', (e) => {
        if (!tableState.isDM) return;

        e.dataTransfer.setData('text/plain', box.dataset.peerId);
        box.classList.add('dragging');
    });

    box.addEventListener('dragend', () => {
        box.classList.remove('dragging');
    });

    box.addEventListener('dragover', (e) => {
        if (!tableState.isDM) return;
        e.preventDefault();
    });

    box.addEventListener('drop', (e) => {
        if (!tableState.isDM) return;

        e.preventDefault();

        const draggedPeerId = e.dataTransfer.getData('text/plain');
        const targetPeerId = box.dataset.peerId;

        if (!draggedPeerId || !targetPeerId || draggedPeerId === targetPeerId) return;

        reorderVideoByDrop(draggedPeerId, targetPeerId);
    });
}

function setInitiativeSpotlight(peerId) {
    initiativePeerId = peerId || null;

    document.querySelectorAll('.video-box').forEach(box => {
        const matches =
            !!initiativePeerId &&
            (
                box.dataset.peerId === initiativePeerId ||
                box.id === `video-${initiativePeerId}` ||
                (box.id === 'local-video-container' && localPeerId === initiativePeerId)
            );

        box.classList.toggle('initiative-active', matches);
    });
}

function getInitiativeOrder() {
    return Array
        .from(document.querySelectorAll('.video-box'))
        .filter(box => box.dataset.peerId)
        .map(box => box.dataset.peerId);
}

function advanceInitiativeSpotlight() {
    if (!tableState.isDM) return;

    const order = getInitiativeOrder();
    if (!order.length) return;

    let currentIndex = order.indexOf(initiativePeerId);

    if (currentIndex === -1) {
        currentIndex = 0;
    } else {
        currentIndex = (currentIndex + 1) % order.length;
    }

    const nextPeerId = order[currentIndex];

    setInitiativeSpotlight(nextPeerId);

    if (socket) {
        socket.emit('setInitiativeSpotlight', nextPeerId);
    }
}

function reorderVideoByDrop(draggedPeerId, targetPeerId) {
    const ribbon = document.querySelector('.video-ribbon');
    if (!ribbon) return;

    const draggedBox = document.querySelector(`.video-box[data-peer-id="${draggedPeerId}"]`);
    const targetBox = document.querySelector(`.video-box[data-peer-id="${targetPeerId}"]`);

    if (!draggedBox || !targetBox) return;

    ribbon.insertBefore(draggedBox, targetBox);

    // Store the complete seating order, including the DM.
    customVideoOrder = Array
        .from(ribbon.querySelectorAll('.video-box'))
        .map(box => box.dataset.peerId)
        .filter(Boolean);

    if (socket) {
        socket.emit('setVideoOrder', customVideoOrder);
    }

    if (initiativePeerId) {
        setInitiativeSpotlight(initiativePeerId);
    }
}

function applyVideoOrder(peerOrder) {
    if (!Array.isArray(peerOrder)) return;

    customVideoOrder = peerOrder;
    sortVideoRibbon();
}

function addVideoFeed(stream, peerId, characterName, isDM = false) {
    const existingBox = document.getElementById(`video-${peerId}`);
    if (existingBox) {
        existingBox.dataset.name = characterName || 'Player';
        existingBox.dataset.isDm = isDM ? 'true' : 'false';
        setupVideoBoxInitiative(existingBox);
        sortVideoRibbon();
        return;
    }

    const ribbon = document.querySelector('.video-ribbon');
    if (!ribbon) return;

    const box = document.createElement('div');
    box.className = 'video-box';
    box.id = `video-${peerId}`;
    box.dataset.peerId = peerId;
    box.dataset.name = characterName || 'Player';
    box.dataset.isDm = isDM ? 'true' : 'false';

    const videoEl = document.createElement('video');
    videoEl.srcObject = stream;
    videoEl.autoplay = true;
    videoEl.playsInline = true;
    videoEl.muted = false;

    const label = document.createElement('div');
    label.className = 'video-label';
    label.id = `label-${peerId}`;
    label.innerText = characterName || 'Player Connected';

    box.appendChild(videoEl);
    box.appendChild(label);
    ribbon.appendChild(box);

    setupVideoBoxInitiative(box);
    sortVideoRibbon();

    if (initiativePeerId) {
        setInitiativeSpotlight(initiativePeerId);
    }
}

function sanitizeFilenamePart(value) {
    return String(value || 'DUNGEONS85')
        .replace(/[^a-z0-9_-]+/gi, '')
        .substring(0, 40) || 'DUNGEONS85';
}

function getExportTimestamp() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

function exportTableState() {
    const stateString = JSON.stringify(tableState);
    const compressedData = pako.deflate(stateString);
    const blob = new Blob([compressedData], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    const roomName = sanitizeFilenamePart(activeRoomName || localStorage.getItem('d85LastRoomName') || 'DUNGEONS85');
    a.href = url;
    a.download = `${roomName}[${getExportTimestamp()}].d85`;

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function importD85Module(file) {
    if (!file) return;

    document.getElementById('loading-overlay').style.display = 'flex';

    const reader = new FileReader();

    reader.onload = async (e) => {
        try {
            const decompressed = pako.inflate(
                new Uint8Array(e.target.result),
                { to: 'string' }
            );

            tableState = JSON.parse(decompressed);

            const imagePromises = [];

            if (tableState.mapSrc) {
                imagePromises.push(loadCloudImage(tableState.mapSrc));
            }

            if (Array.isArray(tableState.tokens)) {
                tableState.tokens.forEach(token => {
                    if (token.src) {
                        imagePromises.push(loadCloudImage(token.src));
                    }
                });
            }

            await Promise.all(imagePromises);
            await new Promise(resolve => requestAnimationFrame(resolve));

            broadcastFullTableState();

            draw();

            alert(".d85 File loaded successfully!");
        } catch (err) {
            console.error("D85 Import Error:", err);
            alert("Invalid .d85 file.");
        } finally {
            document.getElementById('loading-overlay').style.display = 'none';
        }
    };

    reader.readAsArrayBuffer(file);
}

draw();
