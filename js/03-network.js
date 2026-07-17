// Dungeons '85 Public Beta 9.7.3.4.10.2 — 03-network.js
// Ordered client module. Preserve script load order in index.html.

// ============================================================
// Networking: Socket.IO + PeerJS
// ============================================================

let networkRecoveryHooksInstalled = false;
let peerMediaRecoveryTimers = [];
let peerHardRecoveryTimer = null;
let peerHardRecoveryEligible = false;
let peerHardRecoveryAttempted = false;
let peerIdentityMigrationInProgress = false;
let peerCallStartupFailures = new Map();
let beginFreshPeerIdentityMigration = null;
let socketSeatConfirmed = false;
let pendingPeerHardRecoveryReason = null;
let pendingIdentityReplacementVideoOrder = null;

const PEER_MEDIA_RECOVERY_DELAYS_MS = [250, 2000, 5000, 9000];
const PEER_HARD_RECOVERY_DELAY_MS = 14000;
const PEER_HARD_RECOVERY_FAILURE_THRESHOLD = 2;

function clearPeerMediaRecoveryTimers() {
    peerMediaRecoveryTimers.forEach(timer => clearTimeout(timer));
    peerMediaRecoveryTimers = [];
}

function clearPeerHardRecoveryTimer() {
    if (!peerHardRecoveryTimer) return;
    clearTimeout(peerHardRecoveryTimer);
    peerHardRecoveryTimer = null;
}

function getExpectedPeerMediaPlayers() {
    if (!Array.isArray(currentActiveRoomArray)) return [];

    const localHasMedia = hasLocalMediaTracks();
    return currentActiveRoomArray.filter(player => {
        if (!player || !player.peerId || String(player.peerId) === String(localPeerId)) return false;
        return localHasMedia || player.micEnabled === true || player.camEnabled === true;
    });
}

function getMissingExpectedPeerMediaPlayers() {
    return getExpectedPeerMediaPlayers().filter(player =>
        !hasActivePeerCall(player.peerId, {
            includeDisconnected: true,
            closePruned: true
        })
    );
}

function resetPeerHardRecoveryCycle() {
    clearPeerHardRecoveryTimer();
    peerCallStartupFailures.clear();
    peerHardRecoveryEligible = false;
    peerHardRecoveryAttempted = false;
    pendingPeerHardRecoveryReason = null;
}

function armPeerHardRecoveryCycle(source) {
    peerHardRecoveryEligible = true;
    peerHardRecoveryAttempted = false;
    peerCallStartupFailures.clear();
    pendingPeerHardRecoveryReason = null;
    debugWarn(`DEBUG: PeerJS hard recovery armed after ${source}.`);
}

function triggerPeerHardRecovery(reason) {
    if (!peerHardRecoveryEligible || peerHardRecoveryAttempted || peerIdentityMigrationInProgress) return;
    if (!socket || !socket.connected || !peer || peer.destroyed) return;
    if (typeof beginFreshPeerIdentityMigration !== 'function') return;

    const expectedPlayers = getExpectedPeerMediaPlayers();
    if (!expectedPlayers.length) {
        // The browser may have slept while both sides had media off. Keep this
        // reconnect cycle eligible so later first-mic/first-camera call timeouts
        // can still trigger fresh-ID migration.
        peerCallStartupFailures.clear();
        return;
    }

    const missingPlayers = expectedPlayers.filter(player =>
        !hasActivePeerCall(player.peerId, {
            includeDisconnected: true,
            closePruned: true
        })
    );
    if (!missingPlayers.length) {
        resetPeerHardRecoveryCycle();
        return;
    }

    if (!socketSeatConfirmed) {
        pendingPeerHardRecoveryReason = reason;
        debugWarn(`DEBUG: PeerJS identity recovery deferred until the Socket.IO table seat is confirmed after ${reason}.`);
        return;
    }

    pendingPeerHardRecoveryReason = null;
    peerHardRecoveryAttempted = true;
    debugWarn(
        `DEBUG: PeerJS reports locally healthy but ${missingPlayers.length} media peer(s) remain unreachable after ${reason}; migrating to a fresh PeerJS identity.`
    );
    beginFreshPeerIdentityMigration(`unreachable-after-${reason}`);
}

function schedulePeerHardRecoveryCheck(source, delayMs = PEER_HARD_RECOVERY_DELAY_MS) {
    if (!peerHardRecoveryEligible || peerHardRecoveryAttempted || peerIdentityMigrationInProgress) return;

    clearPeerHardRecoveryTimer();
    peerHardRecoveryTimer = setTimeout(() => {
        peerHardRecoveryTimer = null;
        triggerPeerHardRecovery(source);
    }, delayMs);
}

function notePeerCallStartupFailure(peerId, reason) {
    if (!peerHardRecoveryEligible || peerHardRecoveryAttempted || peerIdentityMigrationInProgress) return;

    const key = String(peerId || '');
    if (!key) return;

    const nextCount = (peerCallStartupFailures.get(key) || 0) + 1;
    peerCallStartupFailures.set(key, nextCount);

    if (nextCount >= PEER_HARD_RECOVERY_FAILURE_THRESHOLD) {
        schedulePeerHardRecoveryCheck(`startup-timeout-${reason}`, 250);
    }
}

function notePeerCallEstablished(peerId) {
    const key = String(peerId || '');
    if (key) peerCallStartupFailures.delete(key);
    if (!peerHardRecoveryEligible) return;

    setTimeout(() => {
        if (!getMissingExpectedPeerMediaPlayers().length) {
            resetPeerHardRecoveryCycle();
        }
    }, 0);
}

function recoverMissingPeerMediaCalls(source) {
    if (peerIdentityMigrationInProgress) return;
    if (!peer || !peer.open || peer.disconnected || peer.destroyed || !hasLocalMediaTracks()) return;

    const callsStarted = refreshPeerMediaConnections(`reconnect-${source}`, {
        onlyMissing: true,
        treatDisconnectedAsMissing: true
    });
    if (callsStarted) {
        debugWarn(`DEBUG: Recovering ${callsStarted} PeerJS media call(s) after ${source}.`);
    }
}

function schedulePeerMediaRecovery(source) {
    clearPeerMediaRecoveryTimers();

    if (source === 'peer-reopen' || source === 'socket-reconnect') {
        schedulePeerHardRecoveryCheck(source);
    }

    PEER_MEDIA_RECOVERY_DELAYS_MS.forEach(delayMs => {
        const timer = setTimeout(() => {
            peerMediaRecoveryTimers = peerMediaRecoveryTimers.filter(activeTimer => activeTimer !== timer);
            recoverMissingPeerMediaCalls(source);
        }, delayMs);

        peerMediaRecoveryTimers.push(timer);
    });
}

function requestNetworkRecovery(source) {
    debugWarn(`DEBUG: Network recovery requested by ${source}`);

    if (socket && !socket.connected) {
        debugWarn("DEBUG: Requesting Socket.IO reconnect");
        socket.connect();
    }

    if (!peerIdentityMigrationInProgress && peer && peer.disconnected && !peer.destroyed) {
        debugWarn("DEBUG: Requesting PeerJS reconnect");
        peer.reconnect();
    }
}

function installNetworkRecoveryHooksOnce() {
    if (networkRecoveryHooksInstalled) return;

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            requestNetworkRecovery('visibilitychange');
        }
    });

    window.addEventListener('online', () => {
        requestNetworkRecovery('online');
    });

    networkRecoveryHooksInstalled = true;
}

function installIncomingPeerCallHandler(peerClient) {
    if (!peerClient || typeof peerClient.on !== 'function') return;

    peerClient.on('call', (call) => {
        if (peer !== peerClient) {
            try {
                if (call && typeof call.close === 'function') call.close();
            } catch (err) {
                debugWarn("DEBUG: Failed to close call delivered to superseded PeerJS client:", err);
            }
            return;
        }

        debugLog("DEBUG: Incoming PeerJS call from", call.peer);

        const caller = currentActiveRoomArray.find(p => String(p.peerId) === String(call.peer));
        ensurePlayerVideoSeat({
            peerId: call.peer,
            name: caller ? caller.name : 'Player',
            isDM: caller ? caller.isDM : false
        });

        if (!localStream) {
            debugWarn("DEBUG: No local stream available to answer call");
            try {
                if (call && typeof call.close === 'function') call.close();
            } catch (err) {
                debugWarn("DEBUG: Failed to close unanswered PeerJS call:", err);
            }
            return;
        }

        const callerPeerId = String(call.peer || '');
        closePeerConnectionsForPeer(callerPeerId, { removeVideoBox: false });
        registerPeerCall(callerPeerId, call);
        call.answer(localStream);
        setTimeout(() => applyVttVideoSenderSettings(call), 0);

        call.on('stream', (remoteStream) => {
            markPeerCallEstablished(call);
            const displayName = caller ? caller.name : "Player";
            addVideoFeed(remoteStream, callerPeerId, displayName, caller ? caller.isDM : false);
        });

        call.on('close', () => {
            const box = document.getElementById(`video-${callerPeerId}`);
            if (box && !hasActivePeerCall(callerPeerId)) refreshRemoteMediaStatus(box, null);
        });

        call.on('error', (err) => {
            handlePeerCallError(callerPeerId, call, err, 'Incoming PeerJS call error');
        });
    });
}

function queueIdentityReplacementVideoOrder(peerOrder) {
    pendingIdentityReplacementVideoOrder = Array.isArray(peerOrder)
        ? peerOrder.map(peerId => String(peerId || '')).filter(Boolean)
        : null;
}

function applyPendingIdentityReplacementVideoOrder() {
    if (!Array.isArray(pendingIdentityReplacementVideoOrder)) return false;

    const peerOrder = pendingIdentityReplacementVideoOrder;
    pendingIdentityReplacementVideoOrder = null;
    applySyncedVideoOrder(peerOrder);
    debugWarn('DEBUG: Applied authoritative ribbon order after PeerJS identity replacement.');
    return true;
}

function initHybridMediaVttStack(roomName, playerName) {
    debugLog("DEBUG: initHybridMediaVttStack started", roomName, playerName);
    hasReceivedInitialTokenSync = false;
    hasReceivedInitialFoWSync = false;
    hasReceivedInitialMapSync = false;
    hasReceivedInitialNotesSync = false;
    hasReceivedInitialSketchSync = false;

    let peerOpenHandled = false;
    let hasSocketConnectedOnce = false;
    let dmSeatConflictRetryTimer = null;
    let dmSeatConflictRetryCount = 0;
    let pendingPeerIdentityMigration = null;
    let joinAckPending = false;
    let joinAckTimer = null;
    let deferredJoinError = null;
    let joinAttemptCounter = 0;
    let latestPlayerListHasLocalSeat = false;
    let reconnectRecoveryPending = false;
    let currentSocketConnectIsReconnect = false;
    let tableInterfaceAdmissionConfirmed = false;

    clearPeerMediaRecoveryTimers();
    clearPeerHardRecoveryTimer();
    peerHardRecoveryEligible = false;
    peerHardRecoveryAttempted = false;
    peerIdentityMigrationInProgress = false;
    peerCallStartupFailures.clear();
    beginFreshPeerIdentityMigration = null;
    socketSeatConfirmed = false;
    pendingPeerHardRecoveryReason = null;
    pendingIdentityReplacementVideoOrder = null;
    installNetworkRecoveryHooksOnce();

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

    const showPeerIdentityMigrationFailure = (message) => {
        const userMessage = message || 'Media reconnect failed. Refresh the page to rejoin the table.';
        debugError(`DEBUG: ${userMessage}`);
        if (typeof addResultToHistoryTicker === 'function') {
            addResultToHistoryTicker('[SYS]', 0, userMessage.toUpperCase());
        }
    };

    const completePeerIdentityMigration = (oldPeerId, newPeerId) => {
        const pending = pendingPeerIdentityMigration;
        if (!pending) return;
        if (String(pending.oldPeerId) !== String(oldPeerId) || String(pending.newPeerId) !== String(newPeerId)) return;

        clearTimeout(pending.openTimeout);
        replacePeerIdentityLocally(oldPeerId, newPeerId);

        try {
            if (pending.stalePeer && !pending.stalePeer.destroyed) pending.stalePeer.destroy();
        } catch (err) {
            debugWarn('DEBUG: Failed to destroy superseded PeerJS client after identity migration:', err);
        }

        pendingPeerIdentityMigration = null;
        peerIdentityMigrationInProgress = false;
        peerHardRecoveryEligible = false;
        peerCallStartupFailures.clear();
        clearPeerHardRecoveryTimer();

        debugWarn(`DEBUG: PeerJS identity migration complete ${oldPeerId} -> ${newPeerId}.`);
        schedulePeerMediaRecovery('identity-replaced');
    };

    const failPeerIdentityMigration = (message) => {
        const pending = pendingPeerIdentityMigration;
        if (!pending) return;

        clearTimeout(pending.openTimeout);
        try {
            if (pending.replacementPeer && !pending.replacementPeer.destroyed) pending.replacementPeer.destroy();
        } catch (err) {
            debugWarn('DEBUG: Failed to destroy unsuccessful replacement PeerJS client:', err);
        }

        if (peer === pending.replacementPeer) peer = pending.stalePeer;
        pendingPeerIdentityMigration = null;
        peerIdentityMigrationInProgress = false;
        showPeerIdentityMigrationFailure(message);
    };

    const installPeerLifecycleHandlers = (peerClient, label) => {
        installIncomingPeerCallHandler(peerClient);

        peerClient.on('disconnected', () => {
            if (peer !== peerClient || peerIdentityMigrationInProgress) return;
            armPeerHardRecoveryCycle(`${label}-disconnected`);
            debugWarn(`DEBUG: ${label} disconnected; attempting reconnect`);
            if (peerClient.disconnected && !peerClient.destroyed) peerClient.reconnect();
        });

        peerClient.on('close', () => {
            if (peer === peerClient) debugWarn(`DEBUG: ${label} closed`);
        });

        peerClient.on('error', (err) => {
            if (peer === peerClient) debugError(`DEBUG: ${label} error:`, err);
        });
    };

    beginFreshPeerIdentityMigration = (reason) => {
        if (peerIdentityMigrationInProgress || pendingPeerIdentityMigration) return;
        if (!socket || !socket.connected) return;
        if (!socketSeatConfirmed) {
            pendingPeerHardRecoveryReason = reason;
            debugWarn(`DEBUG: Fresh PeerJS identity migration deferred until the Socket.IO table seat is confirmed after ${reason}.`);
            return;
        }

        const oldPeerId = String(localPeerId || peer?.id || '');
        if (!oldPeerId) {
            showPeerIdentityMigrationFailure('Media reconnect failed because the current peer identity is unavailable.');
            return;
        }

        peerIdentityMigrationInProgress = true;
        clearPeerMediaRecoveryTimers();
        clearPeerHardRecoveryTimer();

        // A suspended browser can report its old tracks as live even though they
        // no longer send usable media. Preserve the table seat and authority, but
        // deliberately return media to the same OFF state used for a normal join.
        // This publishes mic/camera false on the existing socket before the server
        // atomically migrates the seat to the fresh PeerJS identity.
        resetLocalMediaAfterIdentityRecovery();

        const stalePeer = peer;
        const replacementPeer = new Peer(undefined, webrtcIceConfig);
        peer = replacementPeer;
        installPeerLifecycleHandlers(replacementPeer, 'Replacement PeerJS');

        const openTimeout = setTimeout(() => {
            failPeerIdentityMigration('Media reconnect failed while requesting a fresh PeerJS identity. Refresh to rejoin.');
        }, 10000);

        pendingPeerIdentityMigration = {
            oldPeerId,
            newPeerId: null,
            stalePeer,
            replacementPeer,
            openTimeout,
            reason
        };

        debugWarn(`DEBUG: Creating fresh PeerJS identity after ${reason}; preserving the existing Socket.IO seat.`);

        replacementPeer.on('open', (newPeerId) => {
            const pending = pendingPeerIdentityMigration;
            if (!pending || peer !== replacementPeer || pending.replacementPeer !== replacementPeer) return;

            pending.newPeerId = String(newPeerId || '');
            if (!pending.newPeerId) {
                failPeerIdentityMigration('Media reconnect failed because PeerJS returned an empty identity. Refresh to rejoin.');
                return;
            }

            debugLog('DEBUG: Fresh PeerJS identity open', pending.newPeerId);
            socket.emit('replacePeerIdentity', {
                oldPeerId: pending.oldPeerId,
                newPeerId: pending.newPeerId
            }, (result) => {
                if (!result || result.ok !== true) {
                    const message = result?.message || 'Media identity migration was rejected by the table server. Refresh to rejoin.';
                    failPeerIdentityMigration(message);
                    return;
                }

                completePeerIdentityMigration(pending.oldPeerId, pending.newPeerId);
            });
        });
    };

    peer = new Peer(undefined, webrtcIceConfig);
    const initialPeer = peer;
    installPeerLifecycleHandlers(initialPeer, 'PeerJS');

    initialPeer.on('open', (peerId) => {
        if (peer !== initialPeer) return;
        debugLog("DEBUG: PeerJS open", peerId);
        localPeerId = peerId;

        if (peerOpenHandled) {
            debugWarn("DEBUG: PeerJS re-open after reconnect; preserving existing Socket.IO client.");
            schedulePeerMediaRecovery('peer-reopen');
            return;
        }

        peerOpenHandled = true;
        debugCount("DEBUG: Creating Socket.IO client");

        socket = io(SERVER_URL, {
            transports: ["websocket"]
        });

        const clearDmSeatConflictRetry = () => {
            if (dmSeatConflictRetryTimer) clearTimeout(dmSeatConflictRetryTimer);
            dmSeatConflictRetryTimer = null;
        };

        const clearJoinAckTimer = () => {
            if (joinAckTimer) clearTimeout(joinAckTimer);
            joinAckTimer = null;
        };

        const setAdmissionUiState = (state, message = '') => {
            const joinButton = document.getElementById('join-btn');
            const roomNote = document.getElementById('gm-room-note');

            if (joinButton) {
                if (state === 'pending') {
                    joinButton.disabled = true;
                    joinButton.innerText = tableState.isDM ? 'CHECKING TABLE...' : 'JOINING TABLE...';
                } else {
                    joinButton.disabled = false;
                    joinButton.innerText = 'CREATE/JOIN TABLE';
                }
            }

            if (!tableState.isDM || !roomNote) return;

            if (message) {
                roomNote.innerText = message;
                roomNote.classList.remove('hidden');
            }
        };

        const updateConnectedInterfaceSafely = () => {
            try {
                const localVideoBox = document.getElementById('local-video-container');
                if (localVideoBox) {
                    localVideoBox.dataset.peerId = localPeerId || "local";
                    localVideoBox.dataset.name = tableState.playerName || "You";
                    localVideoBox.dataset.isDm = tableState.isDM ? "true" : "false";
                    setupVideoBoxInitiative(localVideoBox);
                }

                const roomDisplay = document.getElementById('room-display');
                if (roomDisplay) roomDisplay.innerText = roomName;
                document.getElementById('top-nav')?.classList.add('hidden');
                document.getElementById('login-screen')?.classList.add('hidden');
                document.getElementById('vtt-interface')?.classList.remove('hidden');
                sortVideoRibbon();

                document.getElementById('ticker-empty-msg')?.remove();

                if (!tableState.isDM) {
                    document.getElementById('toolbar-right')?.remove();
                }

                setTimeout(() => {
                    try {
                        resizeCanvas();
                        makeElementsDraggable();
                    } catch (err) {
                        debugWarn("DEBUG: Deferred reconnect UI update failed:", err);
                    }
                }, 50);
            } catch (err) {
                // Presentation failures must never interrupt authoritative room admission.
                debugWarn("DEBUG: Reconnect UI update failed; table seat recovery continues:", err);
            }
        };

        const resumeReconnectRecoveryAfterSeatConfirmation = () => {
            if (!socketSeatConfirmed || !latestPlayerListHasLocalSeat || !reconnectRecoveryPending) return;

            reconnectRecoveryPending = false;
            schedulePeerMediaRecovery('socket-reconnect');

            if (pendingPeerHardRecoveryReason) {
                const deferredReason = pendingPeerHardRecoveryReason;
                pendingPeerHardRecoveryReason = null;
                setTimeout(() => triggerPeerHardRecovery(deferredReason), 0);
            }
        };

        let emitJoinRoom = null;

        const handleJoinFailure = (error, isReconnect) => {
            socketSeatConfirmed = false;
            const errorCode = error && typeof error === 'object' ? error.code : null;
            const message = error && typeof error === 'object' ? error.message : error;

            if (errorCode === 'DM_SEAT_CONFLICT' && tableState.isDM && dmSeatConflictRetryCount < 2) {
                const retryDelays = [5000, 15000];
                const retryDelay = retryDelays[dmSeatConflictRetryCount];
                dmSeatConflictRetryCount += 1;
                clearDmSeatConflictRetry();
                setAdmissionUiState('pending', 'Checking whether this table still has an active Dungeon Master...');
                debugWarn(`DEBUG: DM seat conflict; retrying join in ${retryDelay} ms.`);
                dmSeatConflictRetryTimer = setTimeout(() => {
                    dmSeatConflictRetryTimer = null;
                    emitJoinRoom({ isReconnect: true });
                }, retryDelay);
                return;
            }

            const userMessage = typeof message === 'string' ? message : 'Unable to join this table.';
            setAdmissionUiState('failed', userMessage);
            alert(userMessage);

            if (errorCode === 'DM_SEAT_CONFLICT') return;
            window.location.reload();
        };

        const handleJoinSuccess = (result, isReconnect) => {
            socketSeatConfirmed = true;
            dmSeatConflictRetryCount = 0;
            clearDmSeatConflictRetry();

            debugWarn(
                `DEBUG: Socket.IO table seat confirmed for ${result?.peerId || localPeerId} on socket ${result?.socketId || socket.id}${result?.reclaimed ? ' (reclaimed)' : ''}.`
            );

            if (!tableInterfaceAdmissionConfirmed) {
                tableInterfaceAdmissionConfirmed = true;
                setAdmissionUiState('confirmed');
                updateConnectedInterfaceSafely();
            }

            if (isReconnect) {
                reconnectRecoveryPending = true;
                resumeReconnectRecoveryAfterSeatConfirmation();
            }
        };

        emitJoinRoom = ({ isReconnect = currentSocketConnectIsReconnect } = {}) => {
            if (!socket || !socket.connected) return;

            const attemptId = ++joinAttemptCounter;
            joinAckPending = true;
            deferredJoinError = null;
            clearJoinAckTimer();

            if (!tableInterfaceAdmissionConfirmed) {
                setAdmissionUiState(
                    'pending',
                    tableState.isDM
                        ? 'Checking whether this table is available...'
                        : 'Joining table...'
                );
            }

            socket.emit('joinRoom', {
                roomName,
                playerName,
                isDM: tableState.isDM,
                peerId: localPeerId
            }, (result) => {
                if (attemptId !== joinAttemptCounter) return;

                joinAckPending = false;
                clearJoinAckTimer();

                if (result && result.ok === true) {
                    handleJoinSuccess(result, isReconnect);
                    return;
                }

                handleJoinFailure(result || deferredJoinError || {
                    code: 'JOIN_NOT_CONFIRMED',
                    message: 'The table server did not confirm your seat.'
                }, isReconnect);
            });

            joinAckTimer = setTimeout(() => {
                if (attemptId !== joinAttemptCounter || !joinAckPending) return;

                joinAckPending = false;
                joinAckTimer = null;
                const pendingError = deferredJoinError;
                deferredJoinError = null;

                if (pendingError) {
                    handleJoinFailure(pendingError, isReconnect);
                    return;
                }

                socketSeatConfirmed = false;
                debugError("DEBUG: Socket.IO table seat confirmation timed out; media recovery remains paused.");
            }, 6000);
        };

        // Debug-only reconnect diagnostics. These stay gated by D85_DEBUG_LOGS.
        socket.on('disconnect', (reason) => {
            socketSeatConfirmed = false;
            latestPlayerListHasLocalSeat = false;
            reconnectRecoveryPending = false;
            joinAckPending = false;
            clearJoinAckTimer();
            if (hasSocketConnectedOnce) armPeerHardRecoveryCycle('socket-disconnect');
            debugWarn("DEBUG: Socket disconnected:", reason);
        });

        socket.on('connect_error', (err) => {
            debugError("DEBUG: Socket connect_error:", err?.message || err, err);
        });

        socket.on('error', (err) => {
            debugError("DEBUG: Socket error:", err);
        });

        socket.io.on('reconnect_attempt', (attempt) => {
            debugWarn("DEBUG: Socket reconnect attempt:", attempt);
        });

        socket.io.on('reconnect', (attempt) => {
            debugWarn("DEBUG: Socket reconnected after attempts:", attempt);
        });

        socket.io.on('reconnect_error', (err) => {
            debugError("DEBUG: Socket reconnect_error:", err?.message || err, err);
        });

        socket.io.on('reconnect_failed', () => {
            debugError("DEBUG: Socket reconnect_failed");
        });

        socket.on('connect', () => {
            const isSocketReconnect = hasSocketConnectedOnce;
            hasSocketConnectedOnce = true;
            currentSocketConnectIsReconnect = isSocketReconnect;
            socketSeatConfirmed = false;
            latestPlayerListHasLocalSeat = false;
            reconnectRecoveryPending = isSocketReconnect;

            debugLog("DEBUG: Socket connected", socket.id);
            activeRoomName = roomName;

            // Do not expose the table interface until the server confirms that
            // this socket owns an authoritative participant seat.
            emitJoinRoom({ isReconnect: isSocketReconnect });

            // The server now owns join/rejoin notifications.
            // Do not send a client-side "created table" message here, because
            // Socket.IO fires this connect handler again after normal reconnects.
        });

        socket.on('joinError', (error) => {
            if (joinAckPending) {
                deferredJoinError = error;
                return;
            }

            handleJoinFailure(error, currentSocketConnectIsReconnect);
        });

        socket.on('seatProbe', (acknowledge) => {
            if (typeof acknowledge === 'function') acknowledge();
        });

        socket.on('peerIdentityReplaced', (identity) => {
            if (!identity || typeof identity !== 'object') return;

            const oldPeerId = String(identity.oldPeerId || '');
            const newPeerId = String(identity.newPeerId || '');
            if (!oldPeerId || !newPeerId || oldPeerId === newPeerId) return;

            queueIdentityReplacementVideoOrder(identity.videoOrder);

            const changed = replacePeerIdentityLocally(oldPeerId, newPeerId);
            if (changed) {
                debugWarn(`DEBUG: Applied PeerJS identity replacement ${oldPeerId} -> ${newPeerId}.`);
            }

            completePeerIdentityMigration(oldPeerId, newPeerId);
            schedulePeerMediaRecovery('identity-replaced');
        });

        socket.on('updatePlayerList', (playersArray) => {
            debugLog("DEBUG: updatePlayerList", playersArray);

            const previousPlayers = currentActiveRoomArray || [];

            latestPlayerListHasLocalSeat = playersArray.some(
                player => String(player.peerId) === String(localPeerId)
            );

            if (latestPlayerListHasLocalSeat) {
                dmSeatConflictRetryCount = 0;
                clearDmSeatConflictRetry();
            }

            previousPlayers.forEach(oldPlayer => {
                const stillConnected = playersArray.some(p => p.peerId === oldPlayer.peerId);
                if (!stillConnected) {
                    closePeerConnectionsForPeer(oldPlayer.peerId, { removeVideoBox: true });
                }
            });

            playersArray.forEach(p => {
                if (p.peerId === localPeerId) return;
                ensurePlayerVideoSeat(p);
            });

            let shouldScheduleNewPeerRecovery = false;

            playersArray.forEach(p => {
                const wasKnown = previousPlayers.some(existing => existing.peerId === p.peerId);

                // Receive-only join support: when a new peer appears, any browser
                // that already has live local media should offer it to the newcomer.
                // Browsers with mic/camera still off keep their silent placeholder
                // stream and do not create unnecessary calls.
                if (p.peerId !== localPeerId && !wasKnown && hasLocalMediaTracks()) {
                    callPeerWithLocalStream(p, "new-peer-media-offer");
                    shouldScheduleNewPeerRecovery = true;
                }
            });

            currentActiveRoomArray = sortPlayersForRibbon(playersArray);
            const appliedIdentityReplacementOrder = applyPendingIdentityReplacementVideoOrder();
            resumeReconnectRecoveryAfterSeatConfirmation();

            // A returning participant can rejoin Socket.IO before its PeerJS
            // identity is reachable through the signaling broker. The immediate
            // media offer may therefore receive peer-unavailable. Keep
            // the retry bounded and let failed startup calls expire before the next
            // attempt instead of requiring a manual mic/camera toggle.
            if (shouldScheduleNewPeerRecovery) {
                schedulePeerMediaRecovery('player-list-return');
            }

            if (!appliedIdentityReplacementOrder) sortVideoRibbon();
        });


        socket.on('syncMap', (mapSrc) => {
            if (typeof mapSrc !== 'string') return;

            if (!mapSrc) {
                hasReceivedInitialMapSync = true;
                tableState.mapSrc = null;
                draw();
                return;
            }

            // Reconnect safety: if the GM has already received initial map state
            // and still has a local map loaded, do not let a stale server snapshot
            // roll the table back to a previous map after a brief websocket reconnect.
            // Re-publish the GM's current local map instead.
            if (tableState.isDM && hasReceivedInitialMapSync && tableState.mapSrc) {
                debugWarn("DEBUG: Ignoring syncMap after GM reconnect to protect local map state.");
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
                    centerMapInView();
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
                debugWarn("DEBUG: Ignoring syncTokens after GM reconnect to protect local token state.");
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
            if (tableState.isDM || !cameraData || typeof cameraData !== 'object') return;

            if (cameraData.centerOnly) {
                centerCameraOnWorldPoint(cameraData.centerX, cameraData.centerY, tableState.camera.zoom);
            } else {
                tableState.camera.x = cameraData.x;
                tableState.camera.y = cameraData.y;
                tableState.camera.zoom = cameraData.zoom;
            }

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
                debugWarn("DEBUG: Ignoring syncFoW after GM reconnect to protect local fog state.");
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
                debugWarn("DEBUG: Ignoring syncNotes after GM reconnect to protect local notes state.");
                return;
            }

            hasReceivedInitialNotesSync = true;
            tableState.notes = serverNotes;
            draw();
        });


        socket.on('syncSketches', (incomingSketches) => {
            const serverSketches = Array.isArray(incomingSketches) ? incomingSketches : [];
            const hasLocalSketches = Array.isArray(tableState.sketches) && tableState.sketches.length > 0;

            if (tableState.isDM && hasReceivedInitialSketchSync && hasLocalSketches) {
                debugWarn("DEBUG: Ignoring syncSketches after GM reconnect to protect local sketches state.");
                return;
            }

            hasReceivedInitialSketchSync = true;
            tableState.sketches = serverSketches;
            draw();
        });

        socket.on('syncInitiativeSpotlight', (peerId) => {
            debugLog("DEBUG: syncInitiativeSpotlight received", peerId);
            setInitiativeSpotlight(peerId);
        });

        socket.on('syncVideoOrder', (peerOrder) => {
            if (Array.isArray(pendingIdentityReplacementVideoOrder)) {
                queueIdentityReplacementVideoOrder(peerOrder);
                return;
            }
            applySyncedVideoOrder(peerOrder);
        });
    });
}

