const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const CONFIG = {
    KICK_COOLDOWN_MS: 5 * 60 * 1000 
};

const rooms = {};
const kickedLog = {}; 

const checkRoundEnd = (roomCode) => {
    const room = rooms[roomCode];
    if (!room || !room.inProgress) return;

    const stillPlaying = room.players.some(p => p.status === 'PLAYING');
    
    if (!stillPlaying) {
        room.inProgress = false;
        io.to(roomCode).emit('roundOver', room.players);
        
        room.players.forEach(p => p.status = 'LOBBY');
        io.to(roomCode).emit('roomUpdate', room);
    }
};

io.on('connection', (socket) => {
    
    socket.on('joinRoom', (roomCode, playerName, callback) => {
        const normalizedRoom = roomCode.toUpperCase();
        const normalizedName = playerName.toLowerCase();

        if (rooms[normalizedRoom] && rooms[normalizedRoom].inProgress) {
            if (typeof callback === 'function') {
                return callback({ success: false, message: 'Match is currently in progress. You cannot join right now.' });
            }
        }

        if (kickedLog[normalizedRoom] && kickedLog[normalizedRoom][normalizedName]) {
            const kickTime = kickedLog[normalizedRoom][normalizedName];
            const timeElapsed = Date.now() - kickTime;
            
            if (timeElapsed < CONFIG.KICK_COOLDOWN_MS) {
                const remainingSecs = Math.ceil((CONFIG.KICK_COOLDOWN_MS - timeElapsed) / 1000);
                const remainingMins = Math.ceil(remainingSecs / 60);
                if (typeof callback === 'function') {
                    return callback({ success: false, message: `You were kicked. Cooldown remaining: ${remainingMins} minute(s).` });
                }
            } else {
                delete kickedLog[normalizedRoom][normalizedName];
            }
        }

        if (!rooms[normalizedRoom]) {
            rooms[normalizedRoom] = { host: socket.id, players: [], startNode: 'Discord_(software)', targetNode: 'Germany', inProgress: false };
        }

        const nameExists = rooms[normalizedRoom].players.some(p => p.name.toLowerCase() === normalizedName);
        if (nameExists) {
            if (typeof callback === 'function') return callback({ success: false, message: 'Username already taken in this room.' });
            return; 
        }

        socket.join(normalizedRoom);
        rooms[normalizedRoom].players.push({ id: socket.id, name: playerName, score: 0, status: 'LOBBY' });
        io.to(normalizedRoom).emit('roomUpdate', rooms[normalizedRoom]);
        
        if (typeof callback === 'function') callback({ success: true, isHost: rooms[normalizedRoom].host === socket.id });
    });

    socket.on('updateRoute', (roomCode, startNode, targetNode) => {
        if (rooms[roomCode] && rooms[roomCode].host === socket.id) {
            rooms[roomCode].startNode = startNode;
            rooms[roomCode].targetNode = targetNode;
            socket.to(roomCode).emit('routeUpdated', { startNode, targetNode });
        }
    });

    socket.on('startGame', (roomCode) => {
        if (rooms[roomCode] && rooms[roomCode].host === socket.id) {
            rooms[roomCode].inProgress = true;
            rooms[roomCode].players.forEach(p => p.status = 'PLAYING'); 
            io.to(roomCode).emit('gameStarted', { startNode: rooms[roomCode].startNode, targetNode: rooms[roomCode].targetNode });
            io.to(roomCode).emit('roomUpdate', rooms[roomCode]);
        }
    });

    socket.on('endMatch', (roomCode) => {
        if (rooms[roomCode] && rooms[roomCode].host === socket.id) {
            rooms[roomCode].inProgress = false;
            rooms[roomCode].players.forEach(p => p.status = 'LOBBY');
            io.to(roomCode).emit('matchEnded'); 
            io.to(roomCode).emit('roomUpdate', rooms[roomCode]);
        }
    });

    socket.on('playerGaveUp', (roomCode, playerName) => {
        const room = rooms[roomCode];
        if (room) {
            const player = room.players.find(p => p.name === playerName);
            if (player) {
                player.status = 'GAVE_UP';
                player.lastPoints = 0;
            }
            io.to(roomCode).emit('receiveChat', { sender: 'System 🤖', message: `${playerName} gave up! 🏳️` });
            io.to(roomCode).emit('roomUpdate', room);
            checkRoundEnd(roomCode); 
        }
    });

    socket.on('sendChat', (roomCode, playerName, message) => {
        io.to(roomCode).emit('receiveChat', { sender: playerName, message });
    });

    socket.on('kickPlayer', (roomCode, targetId) => {
        if (rooms[roomCode] && rooms[roomCode].host === socket.id) {
            const targetPlayer = rooms[roomCode].players.find(p => p.id === targetId);
            if (targetPlayer) {
                if (!kickedLog[roomCode]) kickedLog[roomCode] = {};
                kickedLog[roomCode][targetPlayer.name.toLowerCase()] = Date.now();
                rooms[roomCode].players = rooms[roomCode].players.filter(p => p.id !== targetId);
                io.to(targetId).emit('kicked'); 
                io.to(roomCode).emit('roomUpdate', rooms[roomCode]); 
            }
        }
    });

    socket.on('playerWon', (roomCode, playerName, clickCount, timeTaken) => {
        const room = rooms[roomCode];
        if (room) {
            const player = room.players.find(p => p.name === playerName);
            if (player) {
                player.status = 'FINISHED';
                const points = Math.max(10, 1000 - (timeTaken * 2) - (clickCount * 10));
                
                player.score += points;
                player.lastTime = timeTaken;
                player.lastClicks = clickCount;
                player.lastPoints = points;
                
                io.to(roomCode).emit('receiveChat', { sender: 'System 🤖', message: `🏁 ${playerName} finished! (${clickCount} clicks, ${timeTaken}s)` });
            }
            io.to(roomCode).emit('roomUpdate', room); 
            checkRoundEnd(roomCode); 
        }
    });

    socket.on('disconnect', () => {
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            if (playerIndex !== -1) {
                room.players.splice(playerIndex, 1);
                
                if (room.host === socket.id && room.players.length > 0) {
                    room.host = room.players[0].id;
                }
                
                if (room.players.length === 0) {
                    delete rooms[roomCode];
                } else {
                    io.to(roomCode).emit('roomUpdate', room);
                    checkRoundEnd(roomCode); 
                }
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));