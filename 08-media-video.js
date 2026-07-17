// Dungeons '85 Public Beta 9.7.3.4.9.4 — 08-media-video.js
// Ordered client module. Preserve script load order in index.html.

// ============================================================
// Media, video ribbon, and initiative order
// ============================================================

function getLocalVideoContainer() {
    return document.getElementById('local-video-container');
}

function updateLocalMediaStatusBox() {
    const box = getLocalVideoContainer();
    if (!box) return;

    const messages = [];
    if (box.dataset.micStatus) messages.push(box.dataset.micStatus);
    if (box.dataset.camStatus) messages.push(box.dataset.camStatus);

    let status = document.getElementById('local-media-status');

    if (!messages.length) {
        if (status) status.remove();
        return;
    }

    if (!status) {
        status = document.createElement('div');
        status.id = 'local-media-status';
        status.style.position = 'absolute';
        status.style.left = '0';
        status.style.right = '0';
        status.style.bottom = '0';
        status.style.padding = '6px 8px';
        status.style.background = 'rgba(0, 0, 0, 0.82)';
        status.style.color = '#fff';
        status.style.fontSize = '11px';
        status.style.fontWeight = 'bold';
        status.style.textAlign = 'center';
        status.style.letterSpacing = '0.04em';
        status.style.zIndex = '5';
        status.style.pointerEvents = 'none';

        if (getComputedStyle(box).position === 'static') {
            box.style.position = 'relative';
        }

        box.appendChild(status);
    }

    status.innerText = messages.join(" | ");
}

function showLocalMediaStatus(kind, message) {
    const box = getLocalVideoContainer();
    if (!box) return;

    if (kind === "mic") box.dataset.micStatus = message;
    if (kind === "cam") box.dataset.camStatus = message;

    updateLocalMediaStatusBox();
}

function clearLocalMediaStatus(kind) {
    const box = getLocalVideoContainer();
    if (!box) return;

    if (!kind || kind === "mic") delete box.dataset.micStatus;
    if (!kind || kind === "cam") delete box.dataset.camStatus;

    updateLocalMediaStatusBox();
}

async function setupCameraAndVideo() {
    clearLocalMediaStatus();

    // Join the table without requesting browser media permissions.
    // Microphone and camera are requested later only when the user clicks
    // Unmute or Cam On.
    localStream = new MediaStream();

    const localVideo = document.getElementById('local-video');
    if (localVideo) localVideo.srcObject = localStream;

    const micBtn = document.getElementById('toggle-mic-btn');
    if (micBtn) {
        micBtn.innerText = "Unmute";
        micBtn.classList.add('muted-state');
    }

    const camBtn = document.getElementById('toggle-cam-btn');
    if (camBtn) {
        camBtn.innerText = "Cam On";
        camBtn.classList.add('muted-state');
    }

    showLocalMediaStatus("mic", "MIC OFF");
    showLocalMediaStatus("cam", "CAMERA OFF");

    debugLog("DEBUG: Joined with media off by default.");
}

function releaseVideoElement(videoEl, options = {}) {
    if (!videoEl) return;

    const stream = videoEl.srcObject;
    if (stream && typeof stream.getTracks === 'function') {
        stream.getTracks().forEach(track => {
            try {
                track.stop();
            } catch (err) {
                debugWarn("DEBUG: Failed to stop stale remote media track:", err);
            }
        });
    }

    videoEl.pause();
    videoEl.srcObject = null;
    if (options.removeAttribute) videoEl.removeAttribute('src');
}

function stopLocalMediaStream() {
    if (!localStream || typeof localStream.getTracks !== 'function') return;

    localStream.getTracks().forEach(track => {
        try {
            track.stop();
        } catch (err) {
            debugWarn("DEBUG: Failed to stop local media track:", err);
        }
    });

    localStream = null;

    const localVideo = document.getElementById('local-video');
    if (localVideo) {
        localVideo.pause();
        localVideo.srcObject = null;
    }
}

const PEER_CALL_STARTUP_TIMEOUT_MS = 3500;

function clearPeerCallStartupTimer(call) {
    if (!call || !call._d85StartupTimer) return;
    clearTimeout(call._d85StartupTimer);
    call._d85StartupTimer = null;
}

function markPeerCallEstablished(call) {
    if (!call) return;
    call._d85MediaEstablished = true;
    clearPeerCallStartupTimer(call);

    if (typeof notePeerCallEstablished === 'function') {
        notePeerCallEstablished(call.peer);
    }
}

function isPeerCallTransportConnected(call) {
    if (!call || !call.peerConnection) return false;

    const connectionState = call.peerConnection.connectionState;
    const iceConnectionState = call.peerConnection.iceConnectionState;

    return connectionState === 'connected' ||
        iceConnectionState === 'connected' ||
        iceConnectionState === 'completed';
}

function isPeerCallDisconnected(call) {
    if (!call || !call.peerConnection) return false;

    const connectionState = call.peerConnection.connectionState;
    const iceConnectionState = call.peerConnection.iceConnectionState;

    return connectionState === 'disconnected' || iceConnectionState === 'disconnected';
}

function isPeerCallClosed(call) {
    if (!call || call._d85Closed) return true;

    const peerConnection = call.peerConnection;
    if (!peerConnection) return false;

    const connectionState = peerConnection.connectionState;
    const iceConnectionState = peerConnection.iceConnectionState;

    return connectionState === 'closed' ||
        connectionState === 'failed' ||
        iceConnectionState === 'closed' ||
        iceConnectionState === 'failed';
}

function prunePeerCallSet(peerId, options = {}) {
    const key = String(peerId || '');
    if (!key) return new Set();

    const calls = activePeerCalls.get(key);
    if (!calls) return new Set();

    Array.from(calls).forEach(call => {
        const shouldPrune = isPeerCallClosed(call) ||
            (options.includeDisconnected && isPeerCallDisconnected(call));

        if (!shouldPrune) return;

        call._d85Closed = true;
        clearPeerCallStartupTimer(call);
        calls.delete(call);

        if (options.closePruned && call && typeof call.close === 'function') {
            try {
                call.close();
            } catch (err) {
                debugWarn("DEBUG: Failed to close unusable PeerJS call:", err);
            }
        }
    });

    if (!calls.size) activePeerCalls.delete(key);
    return activePeerCalls.get(key) || new Set();
}

function hasActivePeerCall(peerId, options = {}) {
    return prunePeerCallSet(peerId, options).size > 0;
}


function handlePeerCallError(peerId, call, err, context = 'PeerJS call error') {
    debugWarn(`DEBUG: ${context}:`, err);

    // registerPeerCall() removes the erroring call before this listener runs.
    // If another call for the same peer is still active, the error came from a
    // superseded call and must not close its replacement.
    if (hasActivePeerCall(peerId)) {
        debugWarn("DEBUG: Ignoring stale PeerJS call error; replacement call is active.");
        return;
    }

    try {
        if (call && typeof call.close === 'function') call.close();
    } catch (closeErr) {
        debugWarn("DEBUG: Failed to close errored PeerJS call:", closeErr);
    }

    const box = document.getElementById(`video-${String(peerId || '')}`);
    if (box) refreshRemoteMediaStatus(box, null);
}

function hasLocalMediaTracks() {
    return !!(
        localStream &&
        typeof localStream.getTracks === 'function' &&
        localStream.getTracks().some(track => track && track.readyState !== 'ended')
    );
}

function getLocalMediaState() {
    const audioTracks = localStream && typeof localStream.getAudioTracks === 'function'
        ? localStream.getAudioTracks()
        : [];
    const videoTracks = localStream && typeof localStream.getVideoTracks === 'function'
        ? localStream.getVideoTracks()
        : [];

    return {
        micEnabled: audioTracks.some(track => track && track.enabled && track.readyState !== 'ended'),
        camEnabled: videoTracks.some(track => track && track.enabled && track.readyState !== 'ended')
    };
}

function publishLocalMediaState() {
    if (!socket || typeof socket.emit !== 'function') return;
    socket.emit('updateMediaState', getLocalMediaState());
}

function applyPlayerMediaStateToVideoBox(box, player) {
    if (!box || !player) return;

    if (typeof player.micEnabled === 'boolean') {
        box.dataset.micEnabled = player.micEnabled ? 'true' : 'false';
    }

    if (typeof player.camEnabled === 'boolean') {
        box.dataset.camEnabled = player.camEnabled ? 'true' : 'false';
    }
}

function shouldInitiatePeerCall(remotePeerId, reason = "media-refresh") {
    if (!localPeerId || !remotePeerId || String(remotePeerId) === String(localPeerId)) return false;

    if (reason === 'reconnect-identity-replaced') {
        const remotePlayer = Array.isArray(currentActiveRoomArray)
            ? currentActiveRoomArray.find(player => String(player?.peerId || '') === String(remotePeerId))
            : null;
        const remoteHasMedia = remotePlayer?.micEnabled === true || remotePlayer?.camEnabled === true;

        // If only this side has a stream, it must originate the replacement call.
        // When both sides have media, use one deterministic caller to avoid two
        // simultaneous post-migration offers closing each other.
        if (!remoteHasMedia) return true;
        return String(localPeerId) < String(remotePeerId);
    }

    // Local media changes must be offered by the client whose stream changed.
    // Normal table membership calls are deterministic so two browsers do not
    // call each other at the same time and create duplicate WebRTC connections.
    if (reason !== "new-player") return true;
    return String(localPeerId) < String(remotePeerId);
}

function registerPeerCall(peerId, call) {
    if (!peerId || !call) return call;

    const key = String(peerId);
    const calls = prunePeerCallSet(key);
    calls.add(call);
    activePeerCalls.set(key, calls);

    call._d85Closed = false;
    call._d85MediaEstablished = false;

    const forgetCall = () => {
        call._d85Closed = true;
        clearPeerCallStartupTimer(call);
        const currentCalls = activePeerCalls.get(key);
        if (!currentCalls) return;
        currentCalls.delete(call);
        if (!currentCalls.size) activePeerCalls.delete(key);
    };

    call.on('close', forgetCall);
    call.on('error', forgetCall);

    return call;
}

function closePeerConnectionsForPeer(peerId, options = {}) {
    if (!peerId) return;

    const key = String(peerId);
    const calls = activePeerCalls.get(key);

    if (calls) {
        Array.from(calls).forEach(call => {
            try {
                call._d85Closed = true;
                clearPeerCallStartupTimer(call);
                if (call && typeof call.close === 'function') call.close();
            } catch (err) {
                debugWarn("DEBUG: Failed to close stale PeerJS call:", err);
            }
        });
        activePeerCalls.delete(key);
    }


    if (options.removeVideoBox && Array.isArray(customVideoOrder)) {
        customVideoOrder = customVideoOrder.filter(id => String(id) !== key);
    }

    const box = document.getElementById(`video-${key}`);
    if (!box) return;

    const videoEl = box.querySelector('video');

    // When a user grants mic/camera permission for the first time, we need to
    // rebuild outgoing media calls so other players can receive the new track.
    // Preserve the existing incoming video element locally until the replacement
    // stream arrives; otherwise the joining player's already-visible feeds blink
    // off while the PeerJS call is being refreshed.
    if (!options.preserveVideoDuringRefresh && videoEl) {
        releaseVideoElement(videoEl, { removeAttribute: !!options.removeVideoBox });
    }

    if (options.removeVideoBox) {
        box.remove();
    } else if (!options.preserveVideoDuringRefresh) {
        refreshRemoteMediaStatus(box, null);
    }
}

function closeAllPeerConnections(options = {}) {
    Array.from(activePeerCalls.keys()).forEach(peerId => {
        closePeerConnectionsForPeer(peerId, {
            removeVideoBox: false,
            preserveVideoDuringRefresh: !!options.preserveVideoDuringRefresh
        });
    });
    activePeerCalls.clear();
}

async function replaceVideoTrackOnActivePeerCalls(videoTrack) {
    const replacements = [];
    let successfulReplacements = 0;

    Array.from(activePeerCalls.keys()).forEach(peerId => {
        const calls = prunePeerCallSet(peerId);

        Array.from(calls).forEach(call => {
            if (isPeerCallClosed(call) || !call.peerConnection) return;

            const senders = typeof call.peerConnection.getSenders === 'function'
                ? call.peerConnection.getSenders()
                : [];

            senders.forEach(sender => {
                if (!sender || typeof sender.replaceTrack !== 'function') return;

                const isVideoSender = sender._d85VideoSender === true ||
                    (sender.track && sender.track.kind === 'video');
                if (!isVideoSender) return;

                sender._d85VideoSender = true;
                replacements.push(
                    Promise.resolve()
                        .then(() => sender.replaceTrack(videoTrack || null))
                        .then(() => {
                            successfulReplacements += 1;
                        })
                        .catch(err => {
                            debugWarn("DEBUG: Failed to replace outgoing camera track:", err);
                        })
                );
            });
        });
    });

    await Promise.all(replacements);
    return successfulReplacements;
}

function applyVttVideoSenderSettings(call) {
    if (!call || !call.peerConnection || typeof VIDEO_SENDER_MAX_BITRATE_BPS !== 'number') return;

    try {
        const senders = typeof call.peerConnection.getSenders === 'function'
            ? call.peerConnection.getSenders()
            : [];

        senders.forEach(sender => {
            if (!sender || !sender.track || sender.track.kind !== 'video') return;
            if (typeof sender.getParameters !== 'function' || typeof sender.setParameters !== 'function') return;

            const parameters = sender.getParameters() || {};
            if (!parameters.encodings || !parameters.encodings.length) {
                parameters.encodings = [{}];
            }

            parameters.encodings[0].maxBitrate = VIDEO_SENDER_MAX_BITRATE_BPS;

            if ('degradationPreference' in parameters) {
                parameters.degradationPreference = 'maintainResolution';
            }

            sender.setParameters(parameters).catch(err => {
                debugWarn("DEBUG: Failed to apply VTT video bitrate cap:", err);
            });
        });
    } catch (err) {
        debugWarn("DEBUG: Failed to inspect PeerJS video sender:", err);
    }
}

function armOutgoingPeerCallStartupTimeout(peerId, call, reason) {
    if (!peerId || !call) return;

    const peerConnection = call.peerConnection;
    const markConnectedTransport = () => {
        if (isPeerCallTransportConnected(call)) markPeerCallEstablished(call);
    };

    if (peerConnection && typeof peerConnection.addEventListener === 'function') {
        peerConnection.addEventListener('connectionstatechange', markConnectedTransport);
        peerConnection.addEventListener('iceconnectionstatechange', markConnectedTransport);
    }

    clearPeerCallStartupTimer(call);
    call._d85StartupTimer = setTimeout(() => {
        call._d85StartupTimer = null;

        if (call._d85Closed || call._d85MediaEstablished) return;
        if (isPeerCallTransportConnected(call)) {
            markPeerCallEstablished(call);
            return;
        }

        const key = String(peerId);
        const calls = activePeerCalls.get(key);
        if (!calls || !calls.has(call)) return;

        debugWarn(`DEBUG: PeerJS call startup timed out during ${reason}; releasing failed call to ${key}.`);
        call._d85Closed = true;
        calls.delete(call);
        if (!calls.size) activePeerCalls.delete(key);

        try {
            if (typeof call.close === 'function') call.close();
        } catch (err) {
            debugWarn("DEBUG: Failed to close timed-out PeerJS call:", err);
        }

        if (typeof notePeerCallStartupFailure === 'function') {
            notePeerCallStartupFailure(key, reason);
        }
    }, PEER_CALL_STARTUP_TIMEOUT_MS);
}

function callPeerWithLocalStream(player, reason = "media-refresh") {
    if (!peer || !peer.open || peer.disconnected || peer.destroyed) return null;
    if (!localStream || !player || !player.peerId || player.peerId === localPeerId) return null;
    if (!shouldInitiatePeerCall(player.peerId, reason)) return null;

    try {
        // One live PeerJS media call per remote peer keeps long sessions from
        // accumulating stale RTCPeerConnections. First-time media permissions
        // rebuild the call; normal mute/unmute toggles existing tracks in place.
        closePeerConnectionsForPeer(player.peerId, {
            removeVideoBox: false,
            preserveVideoDuringRefresh: reason === "camera-permission" || reason === "microphone-permission" || reason === "camera-release"
        });
        ensurePlayerVideoSeat(player);

        const rawCall = peer.call(player.peerId, localStream);
        if (!rawCall) return null;

        const call = registerPeerCall(player.peerId, rawCall);
        armOutgoingPeerCallStartupTimeout(player.peerId, call, reason);
        setTimeout(() => applyVttVideoSenderSettings(call), 0);

        call.on('stream', (remoteStream) => {
            markPeerCallEstablished(call);
            addVideoFeed(remoteStream, call.peer, player.name, player.isDM);
        });

        call.on('close', () => {
            const box = document.getElementById(`video-${player.peerId}`);
            if (box && !hasActivePeerCall(player.peerId)) refreshRemoteMediaStatus(box, null);
        });

        call.on('error', (err) => {
            handlePeerCallError(player.peerId, call, err, `PeerJS call failed during ${reason}`);
        });

        return call;
    } catch (err) {
        debugWarn(`DEBUG: Failed to open PeerJS call during ${reason}:`, err);
        closePeerConnectionsForPeer(player.peerId, { removeVideoBox: false });
        return null;
    }
}

function refreshPeerMediaConnections(reason = "media-refresh", options = {}) {
    if (!peer || !peer.open || peer.disconnected || peer.destroyed) return 0;
    if (!localStream || !Array.isArray(currentActiveRoomArray)) return 0;

    let callsStarted = 0;

    currentActiveRoomArray.forEach(p => {
        if (!p || !p.peerId || p.peerId === localPeerId) return;
        if (options.onlyMissing && hasActivePeerCall(p.peerId, {
            includeDisconnected: !!options.treatDisconnectedAsMissing,
            closePruned: !!options.treatDisconnectedAsMissing
        })) return;
        if (callPeerWithLocalStream(p, reason)) callsStarted += 1;
    });

    return callsStarted;
}

function replacePeerIdInOrderedList(list, oldPeerId, newPeerId) {
    const oldKey = String(oldPeerId || '');
    const newKey = String(newPeerId || '');
    if (!Array.isArray(list) || !oldKey || !newKey) return Array.isArray(list) ? [...list] : [];

    const seen = new Set();
    return list
        .map(peerId => String(peerId) === oldKey ? newKey : String(peerId))
        .filter(peerId => {
            if (!peerId || seen.has(peerId)) return false;
            seen.add(peerId);
            return true;
        });
}

function replacePeerIdentityLocally(oldPeerId, newPeerId) {
    const oldKey = String(oldPeerId || '');
    const newKey = String(newPeerId || '');
    if (!oldKey || !newKey || oldKey === newKey) return false;

    const isLocalIdentity = String(localPeerId || '') === oldKey;

    if (!isLocalIdentity) {
        // The old WebRTC call targets the retired broker identity. Preserve the
        // existing video frame while the replacement call to the new identity starts.
        closePeerConnectionsForPeer(oldKey, {
            removeVideoBox: false,
            preserveVideoDuringRefresh: true
        });
    }

    const remoteBox = document.getElementById(`video-${oldKey}`);
    if (remoteBox) {
        remoteBox.id = `video-${newKey}`;
        remoteBox.dataset.peerId = newKey;

        const label = document.getElementById(`label-${oldKey}`);
        if (label) label.id = `label-${newKey}`;
    }

    if (isLocalIdentity) {
        localPeerId = newKey;
        const localBox = getLocalVideoContainer();
        if (localBox) localBox.dataset.peerId = newKey;
    }

    currentActiveRoomArray = (Array.isArray(currentActiveRoomArray) ? currentActiveRoomArray : [])
        .map(player => String(player?.peerId || '') === oldKey
            ? { ...player, peerId: newKey }
            : player);

    customVideoOrder = replacePeerIdInOrderedList(customVideoOrder, oldKey, newKey);
    tableOrder = replacePeerIdInOrderedList(tableOrder, oldKey, newKey);

    if (String(initiativePeerId || '') === oldKey) {
        initiativePeerId = newKey;
    }

    if (initiativePeerId) setInitiativeSpotlight(initiativePeerId);
    return true;
}


function updateRemoteMediaStatusBox(box, messages) {
    if (!box) return;

    let status = box.querySelector('.remote-media-status');

    if (!messages.length) {
        if (status) status.remove();
        return;
    }

    if (!status) {
        status = document.createElement('div');
        status.className = 'remote-media-status';
        box.appendChild(status);
    }

    status.innerText = messages.join(" | ");
}

function refreshRemoteMediaStatus(box, stream) {
    if (!box) return;

    const messages = [];
    const hasDeclaredMicState = box.dataset.micEnabled === 'true' || box.dataset.micEnabled === 'false';
    const hasDeclaredCamState = box.dataset.camEnabled === 'true' || box.dataset.camEnabled === 'false';

    let hasLiveAudio;
    let hasLiveVideo;

    if (hasDeclaredMicState) {
        hasLiveAudio = box.dataset.micEnabled === 'true';
    } else {
        const audioTracks = stream && typeof stream.getAudioTracks === 'function' ? stream.getAudioTracks() : [];
        hasLiveAudio = audioTracks.some(track => track.enabled && track.readyState !== 'ended');
    }

    if (hasDeclaredCamState) {
        hasLiveVideo = box.dataset.camEnabled === 'true';
    } else {
        const videoTracks = stream && typeof stream.getVideoTracks === 'function' ? stream.getVideoTracks() : [];
        hasLiveVideo = videoTracks.some(track => track.enabled && track.readyState !== 'ended');
    }

    if (!hasLiveAudio) messages.push('MUTED');
    if (!hasLiveVideo) messages.push('CAM OFF');

    updateRemoteMediaStatusBox(box, messages);
}

function ensurePlayerVideoSeat(player) {
    if (!player || !player.peerId || player.peerId === localPeerId) return null;

    const peerId = player.peerId;
    const characterName = player.name || 'Player';
    const isDM = !!player.isDM;

    let box = document.getElementById(`video-${peerId}`);

    if (box) {
        box.dataset.name = characterName;
        box.dataset.isDm = isDM ? 'true' : 'false';
        applyPlayerMediaStateToVideoBox(box, player);

        const label = document.getElementById(`label-${peerId}`);
        if (label) label.innerText = characterName;

        setupVideoBoxInitiative(box);
        refreshRemoteMediaStatus(box, box.querySelector('video')?.srcObject || null);
        return box;
    }

    const ribbon = document.querySelector('.video-ribbon');
    if (!ribbon) return null;

    box = document.createElement('div');
    box.className = 'video-box';
    box.id = `video-${peerId}`;
    box.dataset.peerId = peerId;
    box.dataset.name = characterName;
    box.dataset.isDm = isDM ? 'true' : 'false';
    applyPlayerMediaStateToVideoBox(box, player);

    const videoEl = document.createElement('video');
    videoEl.autoplay = true;
    videoEl.playsInline = true;
    videoEl.muted = false;

    const label = document.createElement('div');
    label.className = 'video-label';
    label.id = `label-${peerId}`;
    label.innerText = characterName;

    box.appendChild(videoEl);
    box.appendChild(label);
    ribbon.appendChild(box);

    setupVideoBoxInitiative(box);
    refreshRemoteMediaStatus(box, null);
    sortVideoRibbon();

    if (initiativePeerId) {
        setInitiativeSpotlight(initiativePeerId);
    }

    return box;
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

    box.addEventListener('click', (e) => {
        if (!tableState.isDM) return;

        // Media controls live inside the local DM video box. Clicking Mute,
        // Unmute, Cam On, or Cam Off must not start or change initiative.
        if (e.target && e.target.closest && e.target.closest('button')) return;

        const peerId = box.dataset.peerId;
        if (!peerId) return;

        // Clicking the active combatant ends combat initiative and restores
        // the saved exploration/marching order from before initiative started.
        if (initiativePeerId === peerId) {
            clearInitiativeAndRestoreTableOrder();
            return;
        }

        // First initiative selection starts combat. Preserve the current table order
        // so the DM can freely rearrange combat order and then snap back later.
        if (!initiativePeerId) {
            captureTableOrderForCombat();
        }

        setInitiativeSpotlight(peerId);

        if (socket) {
            socket.emit('setInitiativeSpotlight', peerId);
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

function getCurrentVideoOrder() {
    return Array
        .from(document.querySelectorAll('.video-box'))
        .filter(box => box.dataset.peerId)
        .map(box => box.dataset.peerId);
}

function captureTableOrderForCombat() {
    if (!tableOrder.length) {
        tableOrder = getCurrentVideoOrder();
    }
}

function clearInitiativeAndRestoreTableOrder() {
    setInitiativeSpotlight(null);

    if (socket) {
        socket.emit('setInitiativeSpotlight', null);
    }

    if (tableOrder.length) {
        const restoredOrder = [...tableOrder];
        tableOrder = [];
        customVideoOrder = restoredOrder;
        applyVideoOrder(restoredOrder);

        if (socket) {
            socket.emit('setVideoOrder', restoredOrder);
        }
    }
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

    if (!initiativePeerId) {
        captureTableOrderForCombat();
    }

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
    const knownPlayer = Array.isArray(currentActiveRoomArray)
        ? currentActiveRoomArray.find(p => String(p.peerId) === String(peerId))
        : null;

    const box = ensurePlayerVideoSeat({
        peerId,
        name: characterName || knownPlayer?.name || 'Player',
        isDM: knownPlayer ? knownPlayer.isDM : isDM,
        micEnabled: knownPlayer ? knownPlayer.micEnabled : undefined,
        camEnabled: knownPlayer ? knownPlayer.camEnabled : undefined
    });

    if (!box) return;

    const videoEl = box.querySelector('video');
    if (videoEl && stream) {
        videoEl.srcObject = stream;
    }

    refreshRemoteMediaStatus(box, stream);
    setupVideoBoxInitiative(box);
    sortVideoRibbon();
}
