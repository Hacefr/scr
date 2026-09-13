/**
 * server/server.js
 * Full Relay Server with NTP Clock Sync, Handshake Gate, and Forfeit Winner Logic
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

app.get('/', (req, res) => {
  res.send('Stargazer Rhythm Relay Server is active.');
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 2e6
});

const rooms = new Map();

io.on('connection', (socket) => {
  let currentRoom = null;

  // 1. NTP Time Sync Ping-Pong
  socket.on('sync_ping', (clientSendTime) => {
    socket.emit('sync_pong', {
      clientSendTime: clientSendTime,
      serverTime: Date.now()
    });
  });

  // 2. Join Room
  socket.on('join_room', ({ roomCode, preferredRole, customSkin }) => {
    roomCode = roomCode.trim().toUpperCase();

    if (!rooms.has(roomCode)) {
      rooms.set(roomCode, {
        code: roomCode,
        players: [],
        status: 'lobby',
        disconnectTimer: null,
        settings: { ghostTapping: true, selectedSongId: 'stargazer' },
        syncReadyCount: 0
      });
    }

    const room = rooms.get(roomCode);

    if (room.players.length >= 2) {
      socket.emit('error_message', 'Room is currently full (max 2 players).');
      return;
    }

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
      finished: false,
      skin: customSkin || null
    };

    room.players.push(playerObj);
    currentRoom = roomCode;
    socket.join(roomCode);

    if (room.disconnectTimer) {
      clearTimeout(room.disconnectTimer);
      room.disconnectTimer = null;
      io.to(roomCode).emit('opponent_reconnected');
    }

    io.to(roomCode).emit('room_update', {
      players: room.players,
      status: room.status,
      settings: room.settings,
      hostId: room.players[0].id
    });

    if (otherPlayer && otherPlayer.skin) {
      socket.emit('opponent_skin', otherPlayer.skin);
    }
    if (playerObj.skin && otherPlayer) {
      socket.to(roomCode).emit('opponent_skin', playerObj.skin);
    }
  });

  socket.on('update_room_settings', (newSettings) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.players[0]?.id !== socket.id) return;

    room.settings = { ...room.settings, ...newSettings };
    io.to(currentRoom).emit('room_settings_update', room.settings);
  });

  socket.on('player_skin', (skinData) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player) player.skin = skinData;
    socket.to(currentRoom).emit('opponent_skin', skinData);
  });

  socket.on('switch_role', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.status !== 'lobby') return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    const otherPlayer = room.players.find(p => p.id !== socket.id);
    const newRole = player.role === 'bf' ? 'limes' : 'bf';

    if (!otherPlayer) {
      player.role = newRole;
    } else if (otherPlayer.role === newRole) {
      otherPlayer.role = player.role;
      player.role = newRole;
    }

    player.ready = false;
    if (otherPlayer) otherPlayer.ready = false;

    io.to(currentRoom).emit('room_update', {
      players: room.players,
      status: room.status,
      settings: room.settings,
      hostId: room.players[0].id
    });
  });

  socket.on('toggle_ready', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.status !== 'lobby') return;

    const player = room.players.find(p => p.id === socket.id);
    if (player) player.ready = !player.ready;

    io.to(currentRoom).emit('room_update', {
      players: room.players,
      status: room.status,
      settings: room.settings,
      hostId: room.players[0].id
    });

    if (room.players.length === 2 && room.players.every(p => p.ready)) {
      room.syncReadyCount = 0;
      io.to(currentRoom).emit('handshake_check');
    }
  });

  socket.on('handshake_ack', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    room.syncReadyCount = (room.syncReadyCount || 0) + 1;

    if (room.syncReadyCount >= 2) {
      room.status = 'playing';
      const startTimestamp = Date.now() + 3000;

      io.to(currentRoom).emit('match_starting', {
        startTimestamp: startTimestamp,
        serverNow: Date.now(),
        countdownMs: 3000,
        settings: room.settings
      });
    }
  });

  socket.on('player_note_hit', (data) => {
    if (!currentRoom) return;
    socket.to(currentRoom).emit('opponent_note_hit', data);
  });

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

    // If both players have finished, declare winner
    if (room.players.length === 2 && room.players.every(p => p.finished)) {
      room.status = 'finished';
      const [p1, p2] = room.players;
      let winnerId = null;

      if (p1.score > p2.score) winnerId = p1.id;
      else if (p2.score > p1.score) winnerId = p2.id;
      else winnerId = 'tie';

      io.to(currentRoom).emit('match_results', { winnerId, players: room.players });
    } else if (room.players.length === 1) {
      // Solo remaining player finishes
      room.status = 'finished';
      io.to(currentRoom).emit('match_results', { winnerId: socket.id, players: room.players });
    }
  });

  socket.on('disconnect', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    room.players = room.players.filter(p => p.id !== socket.id);

    if (room.players.length === 0) {
      if (room.disconnectTimer) clearTimeout(room.disconnectTimer);
      rooms.delete(currentRoom);
      return;
    }

    if (room.status === 'playing') {
      io.to(currentRoom).emit('opponent_disconnected', { gracePeriodSeconds: 30 });

      room.disconnectTimer = setTimeout(() => {
        const remainingPlayer = room.players[0];
        if (remainingPlayer) {
          io.to(currentRoom).emit('match_results', {
            winnerId: remainingPlayer.id,
            players: room.players,
            forfeit: true
          });
        }
        rooms.delete(currentRoom);
      }, 30000);
    } else {
      io.to(currentRoom).emit('room_update', {
        players: room.players,
        status: room.status,
        settings: room.settings,
        hostId: room.players[0].id
      });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Relay Server listening on port ${PORT}`);
});
