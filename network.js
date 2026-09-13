/**
 * network.js (Client-Side Multiplayer Relay Adapter)
 * Save in ROOT folder
 */

export class NetworkManager {
  constructor() {
    this.socket = null;
    this.connected = false;
    this.roomCode = null;
    this.localId = null;

    // Callbacks for UI/Engine hooks
    this.onRoomUpdate = null;
    this.onMatchStarting = null;
    this.onOpponentHit = null;
    this.onOpponentDisconnected = null;
    this.onOpponentReconnected = null;
    this.onOpponentForfeit = null;
    this.onMatchResults = null;
    this.onError = null;
  }

  /**
   * Connects to the Socket.io relay server.
   * @param {string} serverUrl - e.g. "http://localhost:3000" or your Render URL
   */
  connect(serverUrl) {
    if (this.socket) this.socket.disconnect();

    // io is loaded globally from the Socket.io CDN script in index.html
    this.socket = window.io(serverUrl, {
      transports: ['websocket', 'polling']
    });

    this.socket.on('connect', () => {
      this.connected = true;
      this.localId = this.socket.id;
      console.log("Connected to relay server with ID:", this.localId);
    });

    this.socket.on('error_message', (msg) => {
      if (this.onError) this.onError(msg);
    });

    this.socket.on('room_update', (data) => {
      if (this.onRoomUpdate) this.onRoomUpdate(data);
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

    this.socket.on('opponent_forfeited', (data) => {
      if (this.onOpponentForfeit) this.onOpponentForfeit(data);
    });

    this.socket.on('match_results', (data) => {
      if (this.onMatchResults) this.onMatchResults(data);
    });

    this.socket.on('disconnect', () => {
      this.connected = false;
      console.warn("Disconnected from server");
    });
  }

  joinRoom(roomCode, preferredRole = 'bf') {
    if (!this.socket) return;
    this.roomCode = roomCode.toUpperCase();
    this.socket.emit('join_room', { roomCode: this.roomCode, preferredRole });
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
