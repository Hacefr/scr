/**
 * network.js
 * 5-Burst Lowest-RTT NTP Clock Synchronizer & Ping Monitor
 * Save in ROOT folder
 */

export class NetworkManager {
  constructor() {
    this.socket = null;
    this.connected = false;
    this.roomCode = null;
    this.localId = null;

    // Filtered Millisecond Offset & Ping Metrics
    this.serverTimeOffset = 0;
    this.localPing = 0;
    this.opponentPing = 0;
    this.pingInterval = null;

    this.onRoomUpdate = null;
    this.onRoomSettingsUpdate = null;
    this.onOpponentSkin = null;
    this.onHandshakeCheck = null;
    this.onMatchStarting = null;
    this.onOpponentHit = null;
    this.onOpponentPing = null;
    this.onHostClosedLobby = null;
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
      // Run high-accuracy 5-burst calibration on connect
      this.runBurstNTPCalibration();
      // Start background heartbeat ping monitor
      this.startPingHeartbeat();
    });

    this.socket.on('sync_pong', ({ clientSendTime, serverTime }) => {
      const now = Date.now();
      const rtt = now - clientSendTime;
      const oneWayLatency = rtt / 2;
      this.localPing = Math.round(oneWayLatency);

      // Report ping to opponent
      this.socket.emit('player_ping', this.localPing);
    });

    this.socket.on('opponent_ping', (pingVal) => {
      this.opponentPing = pingVal;
      if (this.onOpponentPing) this.onOpponentPing(pingVal);
    });

    this.socket.on('host_closed_lobby', (data) => {
      if (this.onHostClosedLobby) this.onHostClosedLobby(data);
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

  /**
   * Aggressive NTP Calibration: Pings 5 times, discards jitter/lag spikes,
   * and locks to the single lowest Round-Trip-Time packet.
   */
  async runBurstNTPCalibration() {
    if (!this.socket || !this.connected) return;

    const samples = [];
    for (let i = 0; i < 5; i++) {
      const sendTime = Date.now();
      await new Promise((resolve) => {
        const handler = ({ clientSendTime, serverTime }) => {
          if (clientSendTime === sendTime) {
            const now = Date.now();
            const rtt = now - sendTime;
            const oneWay = rtt / 2;
            const offset = (serverTime + oneWay) - now;
            samples.push({ rtt, offset, oneWay });
            this.socket.off('sync_pong', handler);
            resolve();
          }
        };
        this.socket.on('sync_pong', handler);
        this.socket.emit('sync_ping', sendTime);
      });
      // 100ms spacing between calibration bursts
      await new Promise(r => setTimeout(r, 100));
    }

    // Sort by lowest RTT (cleanest transmission without packet buffer delay)
    samples.sort((a, b) => a.rtt - b.rtt);
    const bestSample = samples[0];
    this.serverTimeOffset = bestSample.offset;
    this.localPing = Math.round(bestSample.oneWay);
    console.log(`[High-Precision NTP Calibrated] Best RTT: ${bestSample.rtt}ms | Offset: ${Math.round(this.serverTimeOffset)}ms`);
  }

  startPingHeartbeat() {
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.pingInterval = setInterval(() => {
      if (this.socket && this.connected) {
        this.socket.emit('sync_ping', Date.now());
      }
    }, 2500);
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
