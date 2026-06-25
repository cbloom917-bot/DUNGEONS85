let tableState = { playerName: '', isDM: false, mapSrc: null, tokens: [], camera: { x: 0, y: 0, zoom: 1 }, fowEnabled: false, fowPolygons: [], isDarknessActive: false };
    let tokenImageCache = {}, socket = null, peer = null, localStream = null, currentActiveRoomArray = [];
    let isDrawingFoW = false, currentFoWPolygon = [], currentMouseWorldX = 0, currentMouseWorldY = 0;
    
    // ADDED: Declare contextSelectedToken globally
    let contextSelectedToken = null; 
    
    const canvas = document.getElementById('vtt-canvas'), ctx = canvas.getContext('2d'), ctxMenu = document.getElementById('ctx-menu');
    const fogCanvas = document.createElement('canvas'), fogCtx = fogCanvas.getContext('2d');

    // --- V8: LOADING OVERLAY ---
    function showLoading(msg = "RECONSTRUCTING DUNGEON...") {
        document.getElementById('loading-msg').innerText = msg;
        document.getElementById('loading-overlay').style.display = 'flex';
    }
    function hideLoading() { document.getElementById('loading-overlay').style.display = 'none'; }

    // --- V8: LOCAL-FIRST ASSET LOADER ---
    function selectLocalFile(mode) {
        if (!tableState.isDM) return;
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'image/*';
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
                    tableState.tokens.push({ id: "token-" + Date.now(), src: dataUrl, x: (canvas.width / 2 - tableState.camera.x) / tableState.camera.zoom, y: (canvas.height / 2 - tableState.camera.y) / tableState.camera.zoom, size: 70, hidden: true });
                    broadcastTokensMatrixChange();
                }
                loadCloudImage(dataUrl).then(() => { hideLoading(); draw(); });
            };
            reader.readAsDataURL(file);
        };
        input.click();
    }

    async function loadCloudImage(src) {
        if (!src) return Promise.resolve(null);
        if (tokenImageCache[src]) return Promise.resolve(tokenImageCache[src]);
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => { tokenImageCache[src] = img; resolve(img); };
            img.src = src;
        });
    }

    const adjectives = ["Dark", "Iron", "Black", "Silent", "Bitter", "Deep", "Lost", "Fallen", "Death", "Broken"];
    const nouns = ["Crypt", "Spawn", "Vault", "Temple", "Bloom", "Pit", "Crawl", "Keep", "Void", "Abyss"];

    function generateRandomRoomName() {
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const num = Math.floor(100 + Math.random() * 900);
    document.getElementById('room-id-input').value = `${adj}${noun}${num}`;
}

    window.addEventListener('DOMContentLoaded', () => {
    window.addEventListener('click', () => {
        ctxMenu.style.display = 'none';
    });

    window.addEventListener('beforeunload', () => {
        if (socket) {
        }

        if (peer) {
            peer.destroy();
        }
    });
});
			
    function resizeCanvas() {
        canvas.width = canvas.clientWidth; 
        canvas.height = canvas.clientHeight; 

        fogCanvas.width = canvas.width;
        fogCanvas.height = canvas.height;

        draw();
    }
    window.addEventListener('resize', resizeCanvas);


    document.getElementById('join-btn').addEventListener('click', async () => {
    const nameInput = document.getElementById('char-name-input').value.trim();
    const roomInput = document.getElementById('room-id-input').value.trim().toUpperCase();
    
    if (!nameInput || !roomInput) {
        alert("Please enter both a Character Name and a Room Name.");
        return;
    }
    
    tableState.playerName = nameInput;
    
    try {
        // Must await camera access before proceeding
        await setupCameraAndVideo();
        
        // Now proceed to init the PeerJS stack
        initHybridMediaVttStack(roomInput, nameInput);
    } catch (e) {
        console.error("Failed to join: Camera setup failed.");
    }
});


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

function initHybridMediaVttStack(roomName, playerName) {

    if (socket) socket.disconnect();

    const webrtcIceConfig = {
        config: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' }
            ]
        }
    };

    peer = new Peer(undefined, webrtcIceConfig);

    peer.on('disconnected', () => {
        peer.reconnect();
    });

    peer.on('open', (peerId) => {

        socket = io("https://newvtt.onrender.com", {
            transports: ["websocket"]
        });

        socket.on('joinError', (message) => {
            alert(message);
            window.location.reload();
        });

        socket.on('connect', () => {

            document.getElementById('room-display').innerText =
                `Room: ${roomName}`;

            document.getElementById('top-nav')
                .classList.add('hidden');

            document.getElementById('login-screen')
                .classList.add('hidden');

            document.getElementById('vtt-interface')
                .classList.remove('hidden');

            const emptyMsg =
                document.getElementById('ticker-empty-msg');

            if (emptyMsg) emptyMsg.remove();

            setTimeout(() => {

                const entryMessage =
                    tableState.isDM
                        ? `${tableState.playerName} HAS CREATED THE TABLE`
                        : `${tableState.playerName} HAS JOINED THE TABLE`;

                socket.emit('playerNotification', entryMessage);

            }, 500);

            if (!tableState.isDM) {
                const dmToolbar =
                    document.getElementById('toolbar-right');

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
        });

        socket.on('updatePlayerList', (playersArray) => {

            const previousPlayers = [...currentActiveRoomArray];

            previousPlayers.forEach(oldPlayer => {

                const stillConnected =
                    playersArray.some(
                        p => p.peerId === oldPlayer.peerId
                    );

                if (!stillConnected) {

                    const deadBox =
                        document.getElementById(
                            `video-${oldPlayer.peerId}`
                        );

                    if (deadBox) deadBox.remove();
                }
            });

            playersArray.forEach(p => {

                const wasKnown =
                    currentActiveRoomArray.some(
                        existing =>
                            existing.peerId === p.peerId
                    );

                if (
                    p.peerId !== peerId &&
                    !wasKnown
                ) {

                    const call =
                        peer.call(
                            p.peerId,
                            localStream
                        );

                    call.on('stream', (remoteStream) => {

                        if (!p.isDM) {

                            addVideoFeed(
                                remoteStream,
                                call.peer,
                                p.name
                            );
                        }
                    });

                    call.on('error', (err) => {
                        console.error(
                            "Peer call error:",
                            err
                        );
                    });
                }
            });

            currentActiveRoomArray = playersArray;
        });

        peer.on('call', (call) => {

            console.log(
                "Incoming call from:",
                call.peer
            );

            call.answer(localStream);

            call.on('stream', (remoteStream) => {

                const caller =
                    currentActiveRoomArray.find(
                        p => p.peerId === call.peer
                    );

                const displayName =
                    caller
                        ? caller.name
                        : "Player";

                if (!caller || !caller.isDM) {

                    addVideoFeed(
                        remoteStream,
                        call.peer,
                        displayName
                    );
                }
            });

            call.on('error', (err) => {
                console.error(
                    "Incoming call error:",
                    err
                );
            });
        });

        socket.on('syncMap', (mapSrc) => {

            tableState.mapSrc = mapSrc;

            loadCloudImage(mapSrc)
                .then(() => draw());
        });

        socket.on('syncTokens', (incomingTokens) => {

            tableState.tokens = incomingTokens;

            incomingTokens.forEach(t => {
                loadCloudImage(t.src)
                    .then(() => draw());
            });

            draw();
        });

        socket.on('tokenMoved', (data) => {

            const match =
                tableState.tokens.find(
                    t => t.id === data.id
                );

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

            addResultToHistoryTicker(
                "[SYS]",
                0,
                msg
            );
        });

        socket.on('syncCamera', (cameraData) => {

            if (tableState.isDM) return;

            tableState.camera.x =
                cameraData.x;

            tableState.camera.y =
                cameraData.y;

            tableState.camera.zoom =
                cameraData.zoom;

            draw();

            addResultToHistoryTicker(
                "[SYS]",
                0,
                "VIEW FOCUSED BY GM"
            );
        });

        socket.on('syncFoW', (fowData) => {

            tableState.fowEnabled =
                fowData.enabled;

            tableState.fowPolygons =
                fowData.polygons;

            if (
                fowData.darkness !== undefined
            ) {
                tableState.isDarknessActive =
                    fowData.darkness;
            }

            if (tableState.isDM) {
                updateFogUI();
            }

            draw();
        });

    });
}
    
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


    function exportTableState() {
        const stateExport = { 
            savedMapSrc: tableState.mapSrc, 
            tokens: tableState.tokens,
            fowEnabled: tableState.fowEnabled,
            fowPolygons: tableState.fowPolygons,
            isDarknessActive: tableState.isDarknessActive
        };
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(stateExport));
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href", dataStr); downloadAnchor.setAttribute("download", "vtt-table-state.json");
        document.body.appendChild(downloadAnchor); downloadAnchor.click(); downloadAnchor.remove();
    }


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
		if (socket) {
  	  		socket.emit('tokenMove', {
        		id: selectedToken.id,
        		x: selectedToken.x,
        		y: selectedToken.y
    		});
		}        
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


    function addVideoFeed(stream, peerId, characterName) {
        const existingBox = document.getElementById(`video-${peerId}`);
        if (existingBox) return;
        const container = document.getElementById('peer-videos-container');
        const box = document.createElement('div'); 
        box.className = "video-box"; box.id = `video-${peerId}`;
        const videoEl = document.createElement('video'); 
        videoEl.srcObject = stream; videoEl.autoplay = true; videoEl.playsInline = true; videoEl.muted = false; 
        const label = document.createElement('div'); 
        label.className = "video-label"; label.id = `label-${peerId}`; 
        label.innerText = characterName || "Player Connected"; 
        box.appendChild(videoEl); box.appendChild(label); container.appendChild(box);
    }

function exportTableState() {
    const stateString = JSON.stringify(tableState);
    const compressedData = pako.deflate(stateString);
    const blob = new Blob([compressedData], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `adventure-${Date.now()}.d85`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function importD85Module(file) {
    document.getElementById('loading-overlay').style.display = 'flex'; // Show spinner
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const decompressed = pako.inflate(new Uint8Array(e.target.result), { to: 'string' });
            tableState = JSON.parse(decompressed);
			if (tableState.mapSrc && socket) {
    		socket.emit('updateMapImage', tableState.mapSrc);
			}

			if (socket) {
   				broadcastTokensMatrixChange();
    			broadcastFoW();
			}
			
            if (typeof draw === 'function') draw();
            alert(".d85 File loaded successfully!");
        } catch (err) {
            alert("Invalid .d85 file.");
        } finally {
            document.getElementById('loading-overlay').style.display = 'none'; // Hide spinner
        }
    };
    reader.readAsArrayBuffer(file);
}
    draw();
