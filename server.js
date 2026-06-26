const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);


const allowedOrigins = process.env.CORS_ORIGIN 
    ? process.env.CORS_ORIGIN.split(',') 
    : ["https://dungeons85.com", "https://www.dungeons85.com"];

const io = new Server(server, { 
    cors: { 
        origin: allowedOrigins, 
        methods: ["GET", "POST"] 
    },
    maxHttpBufferSize: 1e8,
    transports: ['websocket'] 
});

app.use(express.static(__dirname));

const roomCampaignStates = {};

io.on('connection', (socket) => {
    let currentRoom = null;

    socket.on('joinRoom', (data) => {
        if (!data || typeof data !== 'object') return;
        
        let { roomName, playerName, isDM, peerId } = data;

        if (typeof roomName !== 'string' || typeof playerName !== 'string') {
            socket.emit('joinError', 'Invalid room or player name format.');
            return;
        }

        currentRoom = roomName.substring(0, 50).toUpperCase();
        playerName = playerName.substring(0, 50);
        isDM = Boolean(isDM);
        
        if (!roomCampaignStates[currentRoom]) {
            if (!isDM) {
                socket.emit('joinError', 'That room does not exist. Please check the name or wait for the DM to start the table.');
                return; 
            }
            roomCampaignStates[currentRoom] = { 
                mapSrc: null, 
                tokens: [], 
                players: [], 
                wipeTimer: null, 
                fowEnabled: false, 
                fowPolygons: [],
                isDarknessActive: false,
                initiativePeerId: null
            };
        }

        socket.join(currentRoom);
        const state = roomCampaignStates[currentRoom];

        if (isDM) {
            const existingDM = state.players.find(p => p.isDM === true);
            if (existingDM && existingDM.socketId !== socket.id) {
                socket.emit('joinError', 'This table already has a GM. Please join as a player.');
                return; 
            }
        }

        state.players = state.players.filter(p => p.socketId !== socket.id);
        state.players.push({ socketId: socket.id, peerId: String(peerId), name: playerName, isDM });

        if (state.wipeTimer) {
            clearTimeout(state.wipeTimer);
            state.wipeTimer = null;
        }

        if (state.mapSrc) socket.emit('syncMap', state.mapSrc);
        socket.emit('syncTokens', state.tokens); 
        socket.emit('syncFoW', { 
            enabled: state.fowEnabled, 
            polygons: state.fowPolygons, 
            darkness: state.isDarknessActive 
        });
        
        io.to(currentRoom).emit('updatePlayerList', state.players);

        const entryMsg = isDM 
            ? `${playerName} HAS CREATED THE TABLE` 
            : `${playerName} HAS JOINED THE TABLE`;

        io.to(currentRoom).emit('playerNotification', entryMsg);
    });

    socket.on('updateTokensMatrix', (tokens) => {
        if (!currentRoom || !roomCampaignStates[currentRoom]) return;
        
        if (!Array.isArray(tokens)) return;

        const leanTokens = tokens.map(t => ({
            id: String(t.id),
            src: String(t.src),
            x: Number(t.x) || 0,
            y: Number(t.y) || 0,
            size: Number(t.size) || 1,
            hidden: Boolean(t.hidden)
        }));

        roomCampaignStates[currentRoom].tokens = leanTokens;
        socket.broadcast.to(currentRoom).emit('syncTokens', leanTokens);
    });

    socket.on('tokenMove', (data) => {
        if (!currentRoom || !data || typeof data !== 'object') return;
        socket.to(currentRoom).emit('tokenMoved', data);
    });

    socket.on('updateMapImage', (mapSrcString) => {
        if (!currentRoom || !roomCampaignStates[currentRoom]) return;
        if (typeof mapSrcString !== 'string') return; // Type validation
        
        roomCampaignStates[currentRoom].mapSrc = mapSrcString;
        socket.to(currentRoom).emit('syncMap', mapSrcString);
    });

    socket.on('executeDiceRoll', (rollData) => {
        if (!currentRoom || !rollData || typeof rollData !== 'object') return;
        io.to(currentRoom).emit('diceRolledAnimation', rollData);
    });

    socket.on('forceCamera', (cameraData) => {
        if (!currentRoom || !cameraData || typeof cameraData !== 'object') return;
        socket.to(currentRoom).emit('syncCamera', cameraData);
    });

    // --- FOG OF WAR & DARKNESS SYNC LOGIC ---
    socket.on('updateFoW', (fowData) => {
        if (!currentRoom || !roomCampaignStates[currentRoom]) return;
        if (!fowData || typeof fowData !== 'object') return;

        // Sanitize booleans and arrays
        roomCampaignStates[currentRoom].fowEnabled = Boolean(fowData.enabled);
        
        if (Array.isArray(fowData.polygons)) {
            roomCampaignStates[currentRoom].fowPolygons = fowData.polygons;
        }
        
        if (fowData.darkness !== undefined) {
            roomCampaignStates[currentRoom].isDarknessActive = Boolean(fowData.darkness);
        }

        socket.broadcast.to(currentRoom).emit('syncFoW', {
            enabled: roomCampaignStates[currentRoom].fowEnabled,
            polygons: roomCampaignStates[currentRoom].fowPolygons,
            darkness: roomCampaignStates[currentRoom].isDarknessActive
        });
    });

    socket.on('disconnect', () => {
        if (currentRoom && roomCampaignStates[currentRoom]) {
            const state = roomCampaignStates[currentRoom];
            state.players = state.players.filter(p => p.socketId !== socket.id);
            
            if (state.players.length === 0) {
                state.wipeTimer = setTimeout(() => {
                    if (roomCampaignStates[currentRoom] && roomCampaignStates[currentRoom].players.length === 0) {
                        delete roomCampaignStates[currentRoom];
                        console.log(`[SYS] Room ${currentRoom} wiped after 20 minutes of inactivity.`);
                    }
                }, 1200000); // Changed to 20 minutes (1,200,000 milliseconds)
            } else {
                io.to(currentRoom).emit('updatePlayerList', state.players);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Dungeons '85 Server Running on port ${PORT}]`);
});
