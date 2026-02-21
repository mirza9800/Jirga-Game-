const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// 🌟 THE SERVER'S MASTER AVATAR DECK
const premiumAvatars = [
    { img: 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@14.0.0/img/apple/64/1f984.png', color: '#bd93f9' }, 
    { img: 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@14.0.0/img/apple/64/1f981.png', color: '#ffb86c' }, 
    { img: 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@14.0.0/img/apple/64/1f42f.png', color: '#ff5555' }, 
    { img: 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@14.0.0/img/apple/64/1f43c.png', color: '#f8f8f2' }, 
    { img: 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@14.0.0/img/apple/64/1f98a.png', color: '#ffb86c' }, 
    { img: 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@14.0.0/img/apple/64/1f43a.png', color: '#8be9fd' }, 
    { img: 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@14.0.0/img/apple/64/1f438.png', color: '#50fa7b' }, 
    { img: 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@14.0.0/img/apple/64/1f47d.png', color: '#50fa7b' }, 
    { img: 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@14.0.0/img/apple/64/1f996.png', color: '#50fa7b' }, 
    { img: 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@14.0.0/img/apple/64/1f419.png', color: '#bd93f9' }, 
    { img: 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@14.0.0/img/apple/64/1f989.png', color: '#6272a4' }, 
    { img: 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@14.0.0/img/apple/64/1f436.png', color: '#ffb86c' }  
];

let rooms = {};

function startJudging(roomID) {
    const room = rooms[roomID];
    const participants = room.players.filter(p => !p.isSpectator);
    if (participants.length === 0) return;
    
    const judgedPlayer = participants[room.judgingIndex];
    let judge = participants.find(p => p.isHost);
    
    if (judgedPlayer && judge && judgedPlayer.socketId === judge.socketId && participants.length > 1) {
        judge = participants.find(p => !p.isHost);
    }

    io.to(roomID).emit('startVoting', {
        judgedPlayer: judgedPlayer,
        judgeId: judge ? judge.socketId : participants[0].socketId,
        categories: room.categories
    });
}

io.on('connection', (socket) => {
    socket.on('joinRoom', (data) => {
        const { roomID, name, isHost, categories, totalRounds } = data;
        socket.join(roomID);

        if (!rooms[roomID]) {
            rooms[roomID] = {
                players: [],
                status: 'waiting',
                categories: categories || ["Naam", "Jagah", "Janwar", "Cheez"],
                currentRound: 1,
                totalRounds: totalRounds || 1,
                judgingIndex: 0,
                availableAvatars: [...premiumAvatars] 
            };
        }

        const room = rooms[roomID];
        
        let assignedAvatar;
        if (room.availableAvatars.length > 0) {
            const randIndex = Math.floor(Math.random() * room.availableAvatars.length);
            assignedAvatar = room.availableAvatars.splice(randIndex, 1)[0]; 
        } else {
            assignedAvatar = premiumAvatars[Math.floor(Math.random() * premiumAvatars.length)]; 
        }

        const player = {
            socketId: socket.id,
            name, 
            avatar: assignedAvatar.img, 
            color: assignedAvatar.color, 
            isHost,
            score: 0, isReady: false, answers: {},
            // FIX: Only make them a spectator if the game is ACTUALLY running
            isSpectator: room.status === 'playing'
        };

        room.players.push(player);
        io.to(roomID).emit('updatePlayerList', room.players);
        socket.to(roomID).emit('playerJoinedChat', player);
    });

    // ✅ PLAY AGAIN IN SAME ROOM LOGIC
    socket.on('requestReplay', (roomID) => {
        const room = rooms[roomID];
        if(!room) return;
        
        room.status = 'setup';
        room.currentRound = 1;
        room.judgingIndex = 0;
        
        room.players.forEach(p => {
            p.score = 0; 
            p.isReady = false;
            p.answers = {};
            p.hasSubmitted = false;
            p.isSpectator = false; // FIX: Revive ALL spectators so they can play the new game!
        });

        io.to(roomID).emit('resetToSetup');
        io.to(roomID).emit('updatePlayerList', room.players);
    });

    socket.on('updateSettings', (data) => {
        const room = rooms[data.roomID];
        if(!room) return;
        room.categories = data.categories;
        room.totalRounds = data.totalRounds;
        room.status = 'waiting';
        io.to(data.roomID).emit('settingsUpdated', room.categories);
        io.to(data.roomID).emit('updatePlayerList', room.players); // Re-render the UI for players
    });

    socket.on('toggleReady', (roomID) => {
        const room = rooms[roomID];
        if (!room) return;
        const player = room.players.find(p => p.socketId === socket.id);
        if (player) {
            player.isReady = !player.isReady;
            io.to(roomID).emit('updatePlayerList', room.players);
        }
    });

    socket.on('hostStartedGame', (data) => {
        const room = rooms[data.roomID];
        if (!room) return;
        room.status = 'playing';
        room.currentLetter = data.letter;
        room.judgingIndex = 0;
        room.players.forEach(p => { p.answers = {}; p.hasSubmitted = false; p.isReady = false; });
        io.to(data.roomID).emit('gameStarted', { letter: data.letter, categories: room.categories, timer: data.timer });
    });

    socket.on('triggerPanic', (roomID) => {
        socket.to(roomID).emit('panicStarted');
    });

    socket.on('submitAnswers', (data) => {
        const { roomID, answers } = data;
        const room = rooms[roomID];
        if (!room) return;
        const player = room.players.find(p => p.socketId === socket.id);
        if (player) {
            player.answers = answers;
            player.hasSubmitted = true;
        }

        const activePlayers = room.players.filter(p => !p.isSpectator);
        const allSubmitted = activePlayers.every(p => p.hasSubmitted);
        if (allSubmitted) {
            room.judgingIndex = 0;
            startJudging(roomID);
        }
    });

    socket.on('suggestVote', (data) => {
        data.senderId = socket.id;
        io.to(data.roomID).emit('showSuggestion', data);
    });

    socket.on('lockScore', (data) => {
        const { roomID, judgedId, points } = data;
        const room = rooms[roomID];
        if(!room) return;
        const player = room.players.find(p => p.socketId === judgedId);
        if (player) player.score += points;
        
        io.to(roomID).emit('scoreLocked', data);
        io.to(roomID).emit('updatePlayerList', room.players);
    });

    socket.on('nextJudgedPlayer', (roomID) => {
        const room = rooms[roomID];
        if (!room) return;
        const participants = room.players.filter(p => !p.isSpectator);
        room.judgingIndex++;

        if (room.judgingIndex < participants.length) {
            startJudging(roomID);
        } else {
            if (room.currentRound < room.totalRounds) {
                room.currentRound++;
                room.status = 'waiting';
                room.players.forEach(p => { p.answers = {}; p.isReady = false; p.hasSubmitted = false; });
                io.to(roomID).emit('roundOver', { current: room.currentRound, total: room.totalRounds });
                io.to(roomID).emit('updatePlayerList', room.players);
            } else {
                const winners = [...room.players].sort((a, b) => b.score - a.score);
                io.to(roomID).emit('showWinnerScreen', winners);
                room.status = 'waiting';
            }
        }
    });

    socket.on('sendEmoji', (data) => socket.to(data.roomID).emit('receiveEmoji', data));
    socket.on('sendMessage', (data) => socket.to(data.roomID).emit('receiveMessage', data));

    socket.on('disconnect', () => {
        for (const roomID in rooms) {
            const room = rooms[roomID];
            const playerIndex = room.players.findIndex(p => p.socketId === socket.id);
            if (playerIndex !== -1) {
                const droppedPlayer = room.players.splice(playerIndex, 1)[0];
                
                if(room.availableAvatars) {
                    room.availableAvatars.push({ img: droppedPlayer.avatar, color: droppedPlayer.color });
                }

                io.to(roomID).emit('updatePlayerList', room.players);
                socket.to(roomID).emit('playerLeftChat', droppedPlayer);
                
                const activePlayers = room.players.filter(p => !p.isSpectator);
                if(activePlayers.length > 0 && room.status === 'playing' && activePlayers.every(p => p.hasSubmitted)) {
                    if (room.judgingIndex >= activePlayers.length) room.judgingIndex = 0;
                    startJudging(roomID);
                }
                if (room.players.length === 0) delete rooms[roomID];
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 JIRGA SERVER IS LIVE ON PORT ${PORT}`));