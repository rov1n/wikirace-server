const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" } // Note: Restrict this to your Vercel URL in production
});

// Store active rooms and their target destination
const rooms = {};

io.on('connection', (socket) => {
    console.log('A player connected:', socket.id);

    // 1. Join a Lobby
    socket.on('joinRoom', (roomCode, playerName) => {
        socket.join(roomCode);
        if (!rooms[roomCode]) {
            rooms[roomCode] = { players: [], startNode: '', targetNode: '', inProgress: false };
        }
        rooms[roomCode].players.push({ id: socket.id, name: playerName, clicks: 0 });
        
        // Update everyone in the room
        io.to(roomCode).emit('roomUpdate', rooms[roomCode]);
        console.log(`${playerName} joined room ${roomCode}`);
    });

    // 2. Host Starts the Game
    socket.on('startGame', (roomCode, startNode, targetNode) => {
        if (rooms[roomCode]) {
            rooms[roomCode].startNode = startNode;
            rooms[roomCode].targetNode = targetNode;
            rooms[roomCode].inProgress = true;
            
            // Tell all clients in the room to start loading the startNode!
            io.to(roomCode).emit('gameStarted', { startNode, targetNode });
        }
    });

    // 3. A Player Reaches the Goal
    socket.on('playerWon', (roomCode, playerName, clickCount) => {
        rooms[roomCode].inProgress = false;
        io.to(roomCode).emit('gameOver', { winner: playerName, clicks: clickCount });
    });

    // 4. Handle Disconnects
    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        // Logic to remove player from rooms can go here
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Multiplayer server running on port ${PORT}`));