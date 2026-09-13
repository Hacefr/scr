/**
 * network.js
 * Full Network Manager with NTP Clock Calibration and Handshake Support
 */

export class NetworkManager {
  constructor() {
    this.socket = null;
    this.connected = false;
    this.roomCode = null;
    this.localId = null;
    this.serverTimeOffset = 0;

    this.onRoomUpdate = null;
    this.onRoomSettingsUpdate = null;
    this.onOpponentSkin = null;
    this.onHandshakeCheck = null;
    this.onMatchStarting = null;
    this.onOpponentHit = null;
    this.onOpponentDisconnected = null;
    this.onOpponentReconnected = null;
    this.onMatchResults = null;
    this.onError = null;
  }

  connect(serverUrl) {
    if (this.socket) this.socket.disconnect();

    this.socket = window.io(serverUrl, {
      transports: ['websocket', 'polling']
    });

    this.socket.on('connect', () => {
      this.connected = true;
      this.localId = this.socket.id;
      this.syncClockWithServer();
    });

    this.socket.on('sync_pong', ({ clientSendTime, serverTime }) => {
      const now = Date.now();
      const roundTrip = now - clientSendTime;
      const oneWayLatency = roundTrip / 2;
      this.serverTimeOffset = (serverTime + oneWayLatency) - now;
    });

    this.socket.on('handshake_check', () => {
      if (this.onHandshakeCheck) this.onHandshakeCheck();
    });

    this.socket.on('error_message', (msg) => {
      if (this.onError) this.onError(msg);
    });

    this.socket.on('room_update', (data) => {
      if (this.onRoomUpdate) this.onRoomUpdate(data);
    });

    this.socket.on('room_settings_update', (settings) => {
      if (this.onRoomSettingsUpdate) this.onRoomSettingsUpdate(settings);
    });

    this.socket.on('opponent_skin', (skinData) => {
      if (this.onOpponentSkin) this.onOpponentSkin(skinData);
    });

    this.socket.on('match_starting', (data) => {
      if (this.onMatchStarting) this.onMatchStarting(data);
    });

    this.socket.on('opponent_note_hit', (data) => {
      if (this.onOpponentHit) this.onOpponentHit(data);
    });

    this.socket.on('opponent_disconnected', (data) => {
      if (this.onOpponentDisconnected) this.onOpponentDisconnected(data);
    });

    this.socket.on('opponent_reconnected', () => {
      if (this.onOpponentReconnected) this.onOpponentReconnected();
    });

    this.socket.on('match_results', (data) => {
      if (this.onMatchResults) this.onMatchResults(data);
    });
  }

  syncClockWithServer() {
    if (!this.socket || !this.connected) return;
    this.socket.emit('sync_ping', Date.now());
  }

  getSyncedServerTime() {
    return Date.now() + this.serverTimeOffset;
  }

  sendHandshakeAck() {
    if (!this.socket) return;
    this.socket.emit('handshake_ack');
  }

  joinRoom(roomCode, preferredRole = 'bf', customSkin = null) {
    if (!this.socket) return;
    this.roomCode = roomCode.toUpperCase();
    this.socket.emit('join_room', { roomCode: this.roomCode, preferredRole, customSkin });
  }

  updateRoomSettings(settings) {
    if (!this.socket) return;
    this.socket.emit('update_room_settings', settings);
  }

  sendSkin(skinData) {
    if (!this.socket) return;
    this.socket.emit('player_skin', skinData);
  }

  switchRole() {
    if (!this.socket) return;
    this.socket.emit('switch_role');
  }

  toggleReady() {
    if (!this.socket) return;
    this.socket.emit('toggle_ready');
  }

  sendNoteHit(noteData) {
    if (!this.socket || !this.connected) return;
    this.socket.emit('player_note_hit', noteData);
  }

  sendFinished(finalScore, finalAccuracy) {
    if (!this.socket || !this.connected) return;
    this.socket.emit('player_finished', { finalScore, finalAccuracy });
  }
}
