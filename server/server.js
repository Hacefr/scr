/**
 * server/server.js
 * Node.js + Socket.io Relay for 1v1 Synchronized Gameplay
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

// Health check endpoint for Render keep-alive
app.get('/', (req, res) => {
  res.send('Stargazer Rhythm Relay Server is active.');
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // Allows GitHub Pages or local testing to connect
    methods: ['GET', 'POST']
  }
});

// Rooms State Store
// roomCode => { players: [{ id, role, ready, score, accuracy }], status: 'lobby'|'playing', disconnectTimer: null }
const rooms = new Map();

io.on('connection', (socket) => {
  let currentRoom = null;

  // 1. Join or Create Room
  socket.on('join_room', ({ roomCode, preferredRole }) => {
    roomCode = roomCode.trim().toUpperCase();

    if (!rooms.has(roomCode)) {
      rooms.set(roomCode, {
        code: roomCode,
        players: [],
        status: 'lobby',
        disconnectTimer: null
      });
    }

    const room = rooms.get(roomCode);

    if (room.players.length >= 2) {
      socket.emit('error_message', 'Room is currently full (max 2 players).');
      return;
    }

    // Role assignment logic (ensure no duplicate roles)
    let assignedRole = preferredRole || 'bf';
    const otherPlayer = room.players[0];
    if (otherPlayer && otherPlayer.role === assignedRole) {
      assignedRole = assignedRole === 'bf' ? 'limes' : 'bf';
    }

    const playerObj = {
      id: socket.id,
      role: assignedRole,
      ready: false,
      score: 0,
      accuracy: 100.0,
      finished: false
    };

    room.players.push(playerObj);
    currentRoom = roomCode;
    socket.join(roomCode);

    // If opponent had disconnected and reconnected within grace period
    if (room.disconnectTimer) {
      clearTimeout(room.disconnectTimer);
      room.disconnectTimer = null;
      io.to(roomCode).emit('opponent_reconnected');
    }

    // Notify room of current player list & roles
    io.to(roomCode).emit('room_update', {
      players: room.players,
      status: room.status
    });
  });

  // 2. Role Swap Request
  socket.on('switch_role', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.status !== 'lobby') return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    const otherPlayer = room.players.find(p => p.id !== socket.id);
    const newRole = player.role === 'bf' ? 'limes' : 'bf';

    // If role is available or players swap
    if (!otherPlayer) {
      player.role = newRole;
    } else if (otherPlayer.role === newRole) {
      // Swap roles between both players
      otherPlayer.role = player.role;
      player.role = newRole;
    }

    player.ready = false;
    if (otherPlayer) otherPlayer.ready = false;

    io.to(currentRoom).emit('room_update', {
      players: room.players,
      status: room.status
    });
  });

  // 3. Ready Toggle & Synchronized Start
  socket.on('toggle_ready', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.status !== 'lobby') return;

    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      player.ready = !player.ready;
    }

    io.to(currentRoom).emit('room_update', {
      players: room.players,
      status: room.status
    });

    // If 2 players are in room and both are ready, schedule start
    if (room.players.length === 2 && room.players.every(p => p.ready)) {
      room.status = 'playing';

      // 2500ms countdown gives both clients time to sync clocks and buffer audio
      const startTimestamp = Date.now() + 2500;

      io.to(currentRoom).emit('match_starting', {
        startTimestamp: startTimestamp,
        countdownMs: 2500
      });
    }
  });

  // 4. Live Note Hit & Score Relay
  socket.on('player_note_hit', (data) => {
    if (!currentRoom) return;
    // Broadcast hit to opponent only
    socket.to(currentRoom).emit('opponent_note_hit', data);
  });

  // 5. Match Finished (Comparison & Winner)
  socket.on('player_finished', ({ finalScore, finalAccuracy }) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      player.score = finalScore;
      player.accuracy = finalAccuracy;
      player.finished = true;
    }

    // When both finish, declare winner
    if (room.players.every(p => p.finished)) {
      room.status = 'finished';
      const [p1, p2] = room.players;
      let winnerId = null;

      if (p1.score > p2.score) winnerId = p1.id;
      else if (p2.score > p1.score) winnerId = p2.id;
      else winnerId = 'tie';

      io.to(currentRoom).emit('match_results', {
        winnerId,
        players: room.players
      });
    }
  });

  // 6. Disconnect Handling (30s Grace Period)
  socket.on('disconnect', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    // Remove player
    room.players = room.players.filter(p => p.id !== socket.id);

    if (room.players.length === 0) {
      // Room empty, delete to free memory
      if (room.disconnectTimer) clearTimeout(room.disconnectTimer);
      rooms.delete(currentRoom);
      return;
    }

    // If game was playing and opponent left, trigger 30s grace period
    if (room.status === 'playing') {
      io.to(currentRoom).emit('opponent_disconnected', { gracePeriodSeconds: 30 });

      room.disconnectTimer = setTimeout(() => {
        // 30 seconds expired: Remaining player wins by forfeit
        io.to(currentRoom).emit('opponent_forfeited', {
          message: 'Opponent did not reconnect within 30 seconds. You win by forfeit!'
        });
        rooms.delete(currentRoom);
      }, 30000);
    } else {
      // In lobby, just update player list
      io.to(currentRoom).emit('room_update', {
        players: room.players,
        status: room.status
      });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Rhythm Game Relay Server listening on port ${PORT}`);
});
