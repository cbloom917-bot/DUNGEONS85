// Dungeons '85 Public Beta 9.6 — 03-network.js
// Refactor-only split from js/main.js. Preserve load order in index.html.

// ============================================================
// Networking: Socket.IO + PeerJS
// ============================================================

function initHybridMediaVttStack(roomName, playerName) {
    console.log("DEBUG: initHybridMediaVttStack started", roomName, playerName);
    hasReceivedInitialTokenSync = false;
    hasReceivedInitialFoWSync = false;
    hasReceivedInitialMapSync = false;
    hasReceivedInitialNotesSync = false;

    if (socket) {
        socket.disconnect();
        socket = null;
    }

    if (peer) {
        closeAllPeerConnections();
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
        console.warn("DEBUG: PeerJS disconnected; attempting reconnect");
        peer.reconnect();
    });

    peer.on('close', () => {
        console.warn("DEBUG: PeerJS closed");
    });

    peer.on('error', (err) => {
        console.error("DEBUG: PeerJS error:", err);
    });

    peer.on('open', (peerId) => {
        console.log("DEBUG: PeerJS open", peerId);
        localPeerId = peerId;

        console.count("DEBUG: Creating Socket.IO client");

        socket = io(SERVER_URL, {
            transports: ["websocket"]
        });

        // Temporary reconnect diagnostics. These logs tell us whether the
        // browser, network, Socket.IO transport, or server is closing the socket.
        socket.on('disconnect', (reason) => {
            console.warn("DEBUG: Socket disconnected:", reason);
        });

        socket.on('connect_error', (err) => {
            console.error("DEBUG: Socket connect_error:", err?.message || err, err);
        });

        socket.on('error', (err) => {
            console.error("DEBUG: Socket error:", err);
        });

        socket.io.on('reconnect_attempt', (attempt) => {
            console.warn("DEBUG: Socket reconnect attempt:", attempt);
        });

        socket.io.on('reconnect', (attempt) => {
            console.warn("DEBUG: Socket reconnected after attempts:", attempt);
        });

        socket.io.on('reconnect_error', (err) => {
            console.error("DEBUG: Socket reconnect_error:", err?.message || err, err);
        });

        socket.io.on('reconnect_failed', () => {
            console.error("DEBUG: Socket reconnect_failed");
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

            // The server now owns join/rejoin notifications.
            // Do not send a client-side "created table" message here, because
            // Socket.IO fires this connect handler again after normal reconnects.
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
                    closePeerConnectionsForPeer(oldPlayer.peerId, { removeVideoBox: true });
                }
            });

            playersArray.forEach(p => {
                if (p.peerId === peerId) return;
                ensurePlayerVideoSeat(p);
            });

            playersArray.forEach(p => {
                const wasKnown = previousPlayers.some(existing => existing.peerId === p.peerId);

                // Receive-only join support: when a new peer appears, any browser
                // that already has live local media should offer it to the newcomer.
                // Browsers with mic/camera still off keep their silent placeholder
                // stream and do not create unnecessary calls.
                if (p.peerId !== peerId && !wasKnown && hasLocalMediaTracks()) {
                    callPeerWithLocalStream(p, "new-peer-media-offer");
                }
            });

            currentActiveRoomArray = sortPlayersForRibbon(playersArray);
            sortVideoRibbon();
        });

        peer.on('call', (call) => {
            console.log("DEBUG: Incoming PeerJS call from", call.peer);

            const caller = currentActiveRoomArray.find(p => p.peerId === call.peer);
            ensurePlayerVideoSeat({
                peerId: call.peer,
                name: caller ? caller.name : 'Player',
                isDM: caller ? caller.isDM : false
            });

            if (!localStream) {
                console.warn("DEBUG: No local stream available to answer call");
                try {
                    if (call && typeof call.close === 'function') call.close();
                } catch (err) {
                    console.warn("DEBUG: Failed to close unanswered PeerJS call:", err);
                }
                return;
            }

            const callerPeerId = String(call.peer || '');

            // Keep a single live PeerJS media call per remote peer. If a reconnect
            // or camera refresh creates a new incoming call, close the old call
            // before accepting the new one instead of using a second timestamp
            // dedupe state machine.
            closePeerConnectionsForPeer(callerPeerId, { removeVideoBox: false });
            registerPeerCall(callerPeerId, call);
            call.answer(localStream);

            call.on('stream', (remoteStream) => {
                const displayName = caller ? caller.name : "Player";
                addVideoFeed(remoteStream, callerPeerId, displayName, caller ? caller.isDM : false);
            });

            call.on('close', () => {
                const box = document.getElementById(`video-${callerPeerId}`);
                if (box && !hasActivePeerCall(callerPeerId)) refreshRemoteMediaStatus(box, null);
            });

            call.on('error', (err) => {
                console.warn("DEBUG: Incoming PeerJS call error:", err);
                closePeerConnectionsForPeer(callerPeerId, { removeVideoBox: false });
            });
        });

        socket.on('syncMap', (mapSrc) => {
            if (typeof mapSrc !== 'string') return;

            // Reconnect safety: if the GM has already received initial map state
            // and still has a local map loaded, do not let a stale server snapshot
            // roll the table back to a previous map after a brief websocket reconnect.
            // Re-publish the GM's current local map instead.
            if (tableState.isDM && hasReceivedInitialMapSync && tableState.mapSrc) {
                console.warn("DEBUG: Ignoring syncMap after GM reconnect to protect local map state.");
                socket.emit('updateMapImage', tableState.mapSrc);
                return;
            }

            hasReceivedInitialMapSync = true;
            tableState.mapSrc = mapSrc;

            // Player-facing feedback only. This does not change sync order or delay
            // map/token delivery; it simply uses the existing loading overlay while
            // the incoming map image is decoded by the browser.
            if (!tableState.isDM) showDungeonLoading();

            loadCloudImage(mapSrc)
                .then(() => {
                    draw();
                })
                .catch((err) => {
                    console.error(err);
                })
                .finally(() => {
                    if (!tableState.isDM) hideLoading();
                });
        });

        socket.on('syncTokens', (incomingTokens) => {
            const serverTokens = Array.isArray(incomingTokens)
                ? incomingTokens
                : (incomingTokens && Array.isArray(incomingTokens.tokens) ? incomingTokens.tokens : []);

            // Reconnect safety: if the GM still has an active local table, do not let
            // a stale server snapshot replace newer local token work after reconnect.
            // Instead, immediately re-publish the GM's local token matrix to the server.
            if (tableState.isDM && hasReceivedInitialTokenSync && tableState.tokens.length > 0) {
                console.warn("DEBUG: Ignoring syncTokens after GM reconnect to protect local token state.");
                broadcastTokensMatrixChange();
                return;
            }

            hasReceivedInitialTokenSync = true;
            tableState.tokens = serverTokens;
            serverTokens.forEach(t => loadCloudImage(t.src).then(() => draw()));
            draw();
        });

        socket.on('tokenMoved', (data) => {
            const match = tableState.tokens.find(t => String(t.id) === String(data.id));
            if (match) {
                const incomingRev = Number(data.rev) || 0;
                if (incomingRev && Number(match.rev || 0) > incomingRev) return;

                const nextX = Number(data.x);
                const nextY = Number(data.y);
                if (Number.isFinite(nextX)) match.x = nextX;
                if (Number.isFinite(nextY)) match.y = nextY;
                match.rev = incomingRev || match.rev || 0;
                if (tableState.isDM) markTableDirty();
                draw();
            }
        });

        socket.on('tokenResized', (data) => {
            const match = tableState.tokens.find(t => String(t.id) === String(data.id));
            if (!match) return;

            const incomingRev = Number(data.rev) || 0;
            if (incomingRev && Number(match.rev || 0) > incomingRev) return;

            const nextSize = Number(data.size);
            if (Number.isFinite(nextSize) && nextSize > 0) match.size = nextSize;
            match.rev = incomingRev || match.rev || 0;
            if (tableState.isDM) markTableDirty();
            draw();
        });

        socket.on('tokenVisibilityChanged', (data) => {
            const match = tableState.tokens.find(t => String(t.id) === String(data.id));
            if (!match) return;

            const incomingRev = Number(data.rev) || 0;
            if (incomingRev && Number(match.rev || 0) > incomingRev) return;

            match.hidden = Boolean(data.hidden);
            match.rev = incomingRev || match.rev || 0;
            if (tableState.isDM) markTableDirty();
            draw();
        });

        socket.on('tokenAdded', (token) => {
            if (!token || typeof token !== 'object') return;
            if (tableState.tokens.some(t => String(t.id) === String(token.id))) return;

            tableState.tokens.push(token);
            if (token.src) loadCloudImage(token.src).then(() => draw());
            if (tableState.isDM) markTableDirty();
            draw();
        });

        socket.on('tokenDeleted', (data) => {
            if (!data || typeof data !== 'object') return;
            const tokenId = String(data.id || '');
            if (!tokenId) return;

            tableState.tokens = tableState.tokens.filter(t => String(t.id) !== tokenId);
            if (tableState.isDM) markTableDirty();
            draw();
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
            if (!fowData || typeof fowData !== 'object') return;

            const hasLocalFoWWork =
                tableState.fowEnabled ||
                (Array.isArray(tableState.fowPolygons) && tableState.fowPolygons.length > 0) ||
                tableState.isDarknessActive;

            // Reconnect safety: if the GM has local Fog of War work, do not let
            // a stale server snapshot erase it after a brief websocket reconnect.
            // Re-publish the GM's local FoW state instead.
            if (tableState.isDM && hasReceivedInitialFoWSync && hasLocalFoWWork) {
                console.warn("DEBUG: Ignoring syncFoW after GM reconnect to protect local fog state.");
                broadcastFoW();
                return;
            }

            hasReceivedInitialFoWSync = true;
            tableState.fowEnabled = Boolean(fowData.enabled);
            tableState.fowPolygons = Array.isArray(fowData.polygons) ? fowData.polygons : [];

            if (fowData.darkness !== undefined) {
                tableState.isDarknessActive = Boolean(fowData.darkness);
            }

            if (tableState.isDM) updateFogUI();
            draw();
        });

        socket.on('syncNotes', (incomingNotes) => {
            const serverNotes = Array.isArray(incomingNotes) ? incomingNotes : [];
            const hasLocalNotes = Array.isArray(tableState.notes) && tableState.notes.length > 0;

            // Reconnect safety: if the GM has local note work, do not let a stale
            // server snapshot erase it after a brief websocket reconnect.
            // Do not re-broadcast here; server echoes and reconnect syncs can otherwise
            // produce an updateNotes/syncNotes loop.
            if (tableState.isDM && hasReceivedInitialNotesSync && hasLocalNotes) {
                console.warn("DEBUG: Ignoring syncNotes after GM reconnect to protect local notes state.");
                return;
            }

            hasReceivedInitialNotesSync = true;
            tableState.notes = serverNotes;
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

