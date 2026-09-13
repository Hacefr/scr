/**
 * engine.js (Taunt System, Miss Poses, Fit-To-Frame Scaling & Mirroring)
 * Save in ROOT folder
 */

import { AudioManager } from './audio.js';
import { ChartParser } from './parser.js';
import { NotePool } from './pool.js';

const ARROW_COLORS = ['#C24B99', '#00FFFF', '#12FA05', '#F9393F'];

const KEY_MAP = {
  KeyD: 0, ArrowLeft: 0,
  KeyF: 1, ArrowDown: 1,
  KeyJ: 2, ArrowUp: 2,
  KeyK: 3, ArrowRight: 3
};

const TIMING_WINDOWS = {
  sick: 0.045,
  good: 0.090,
  bad:  0.135,
  shit: 0.166
};

export class RhythmEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    this.audio = new AudioManager();
    this.pool = new NotePool(160);
    this.chart = null;

    this.width = canvas.width;
    this.height = canvas.height;
    this.laneWidth = 60;
    this.receptorY = 80;
    this.speed = 2.9;

    this.chartNotes = [];
    this.spawnIndex = 0;

    // Current Song & Pop-Up Card
    this.currentSong = { name: "Stargazer", artist: "VS Impostor Legacy", color: "#55E840" };
    this.creditCardTimer = 0;

    this.gameMode = 'single';
    this.playerRole = 'bf';

    // Countdown State
    this.countdownTimer = 0;
    this.countdownText = "";
    this.countdownColor = "#FFFFFF";

    // Touch & Inputs
    this.isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    this.keysHeld = [false, false, false, false];
    this.activeTouches = new Map();

    // Stats
    this.score = 0;
    this.combo = 0;
    this.highestCombo = 0;
    this.hits = { sick: 0, good: 0, bad: 0, shit: 0, miss: 0 };
    this.totalNotesPlayed = 0;
    this.accuracy = 100.0;
    this.lastRating = "";

    // Pose & Animation States
    this.bfPoseTimer = 0;
    this.limesPoseTimer = 0;
    this.bfMissTimer = 0;
    this.limesMissTimer = 0;
    this.bfTauntTimer = 0;
    this.limesTauntTimer = 0;

    // Manual Mirror Toggle
    this.mirrorSprite = false;

    // Opponent Live Tracking
    this.opponentScore = 0;
    this.opponentAccuracy = 100.0;
    this.opponentKeyTimers = [0, 0, 0, 0];

    this.onNoteHitCallback = null;
    this.onTauntCallback = null;

    this.state = 'BOOT';
    this.loadingStatus = "Ready";

    this.setupInputs();
    this.setupTouch();
  }

  setRole(role) {
    this.playerRole = role;
  }

  setupInputs() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;

      // Keybind T: Taunt
      if (e.code === 'KeyT') {
        if (this.state === 'PLAYING' || this.state === 'COUNTDOWN') {
          this.triggerTaunt();
        }
        return;
      }

      const lane = KEY_MAP[e.code];
      if (lane !== undefined) {
        this.keysHeld[lane] = true;
        if (this.state === 'PLAYING') {
          this.handleKeyPress(lane);
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      const lane = KEY_MAP[e.code];
      if (lane !== undefined) {
        this.keysHeld[lane] = false;
      }
    });
  }

  setupTouch() {
    const getTouchLane = (touch) => {
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.width / rect.width;
      const x = (touch.clientX - rect.left) * scaleX;
      return Math.floor(x / (this.width / 4));
    };

    const handleTouchStart = (e) => {
      e.preventDefault();
      this.isTouchDevice = true;

      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        const lane = getTouchLane(touch);

        if (lane >= 0 && lane <= 3) {
          this.activeTouches.set(touch.identifier, lane);
          this.keysHeld[lane] = true;
          if (this.state === 'PLAYING') {
            this.handleKeyPress(lane);
          }
        }
      }
    };

    const handleTouchEnd = (e) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        const lane = this.activeTouches.get(touch.identifier);
        if (lane !== undefined) {
          this.activeTouches.delete(touch.identifier);
          let stillHeld = false;
          for (const l of this.activeTouches.values()) {
            if (l === lane) { stillHeld = true; break; }
          }
          this.keysHeld[lane] = stillHeld;
        }
      }
    };

    this.canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    this.canvas.addEventListener('touchend', handleTouchEnd, { passive: false });
    this.canvas.addEventListener('touchcancel', handleTouchEnd, { passive: false });
  }

  triggerTaunt() {
    if (this.playerRole === 'bf') {
      this.bfTauntTimer = 0.4;
    } else {
      this.limesTauntTimer = 0.4;
    }

    if (this.onTauntCallback) {
      this.onTauntCallback({ role: this.playerRole });
    }
  }

  handleOpponentTaunt(data) {
    if (data.role === 'bf') {
      this.bfTauntTimer = 0.4;
    } else {
      this.limesTauntTimer = 0.4;
    }
  }

  async loadAssets(songData = { folder: "stargazer", name: "Stargazer", artist: "VS Impostor Legacy", color: "#55E840" }) {
    this.currentSong = songData;
    this.state = 'LOADING';
    const folder = songData.folder || "stargazer";
    const chartFile = songData.chart || "normal.json";

    try {
      this.loadingStatus = `Loading ${songData.name} audio...`;
      const audioPromise = this.audio.loadSongs(`assets/songs/${folder}/Inst.ogg`, `assets/songs/${folder}/Voices.ogg`);

      this.loadingStatus = `Loading ${songData.name} chart...`;
      const chartPromise = fetch(`assets/songs/${folder}/${chartFile}`).then(res => {
        if (!res.ok) throw new Error(`Could not find assets/songs/${folder}/${chartFile}`);
        return res.json();
      });

      const [_, rawJson] = await Promise.all([audioPromise, chartPromise]);

      this.loadingStatus = "Parsing chart...";
      this.chart = ChartParser.parse(rawJson);
      this.chartNotes = this.chart.notes;
      this.speed = this.chart.speed || 2.9;

      this.pool.clear();
      this.spawnIndex = 0;
      this.score = 0;
      this.combo = 0;
      this.hits = { sick: 0, good: 0, bad: 0, shit: 0, miss: 0 };
      this.accuracy = 100.0;
      this.lastRating = "";

      this.state = 'READY';
      this.loadingStatus = "Loaded!";
    } catch (err) {
      this.state = 'ERROR';
      this.loadingStatus = `Error: ${err.message}`;
      console.error(err);
      throw err;
    }
  }

  async startWithCountdown(delaySeconds = 2.4, targetAudioTime = null) {
    await this.audio.initContext();
    this.state = 'COUNTDOWN';
    this.countdownTimer = delaySeconds;

    const scheduledTime = targetAudioTime || (this.audio.ctx.currentTime + delaySeconds);
    this.audio.playAt(scheduledTime);

    this.creditCardTimer = 4.0;
  }

  handleKeyPress(lane) {
    const songTime = this.audio.getCurrentSongTime();
    let hitNote = null;
    let minDiff = Infinity;

    const targetIsPlayer = (this.playerRole === 'bf');

    this.pool.forEachActive(note => {
      if (note.isPlayer === targetIsPlayer && note.lane === lane && !note.hit) {
        const diff = Math.abs(note.strumTime - songTime);
        if (diff <= TIMING_WINDOWS.shit && diff < minDiff) {
          minDiff = diff;
          hitNote = note;
        }
      }
    });

    if (hitNote) {
      hitNote.hit = true;
      hitNote.kill();

      let rating = "shit";
      let pts = 50;

      if (minDiff <= TIMING_WINDOWS.sick) {
        rating = "SICK!"; pts = 350; this.hits.sick++;
      } else if (minDiff <= TIMING_WINDOWS.good) {
        rating = "GOOD"; pts = 200; this.hits.good++;
      } else if (minDiff <= TIMING_WINDOWS.bad) {
        rating = "BAD"; pts = 100; this.hits.bad++;
      } else {
        this.hits.shit++;
      }

      this.score += pts;
      this.combo++;
      if (this.combo > this.highestCombo) this.highestCombo = this.combo;
      this.lastRating = rating;

      if (this.playerRole === 'bf') {
        this.bfPoseTimer = 0.3;
      } else {
        this.limesPoseTimer = 0.3;
      }

      if (this.onNoteHitCallback) {
        this.onNoteHitCallback({ lane, rating, score: this.score, accuracy: this.accuracy });
      }
    } else {
      // Miss penalty & miss animation trigger
      this.score = Math.max(0, this.score - 50);
      this.combo = 0;
      this.hits.miss++;
      this.lastRating = "MISS";

      if (this.playerRole === 'bf') {
        this.bfMissTimer = 0.3;
      } else {
        this.limesMissTimer = 0.3;
      }
    }

    this.updateAccuracy();
  }

  handleOpponentNoteHit(data) {
    const { lane, score, accuracy } = data;
    this.opponentScore = score || 0;
    this.opponentAccuracy = accuracy || 100.0;
    this.opponentKeyTimers[lane] = 0.18;

    if (this.playerRole === 'bf') {
      this.limesPoseTimer = 0.3;
    } else {
      this.bfPoseTimer = 0.3;
    }

    const targetIsPlayer = (this.playerRole !== 'bf');
    this.pool.forEachActive(note => {
      if (note.isPlayer === targetIsPlayer && note.lane === lane && !note.hit) {
        note.hit = true;
        note.kill();
      }
    });
  }

  updateAccuracy() {
    this.totalNotesPlayed = this.hits.sick + this.hits.good + this.hits.bad + this.hits.shit + this.hits.miss;
    if (this.totalNotesPlayed === 0) return;
    const weightedScore = (this.hits.sick * 1.0) + (this.hits.good * 0.75) + (this.hits.bad * 0.5) + (this.hits.shit * 0.25);
    this.accuracy = ((weightedScore / this.totalNotesPlayed) * 100).toFixed(2);
  }

  update(dt) {
    if (this.creditCardTimer > 0) this.creditCardTimer -= dt;

    if (this.state === 'COUNTDOWN') {
      this.countdownTimer -= dt;
      if (this.countdownTimer > 1.8) {
        this.countdownText = "3";
        this.countdownColor = "#F9393F";
      } else if (this.countdownTimer > 1.2) {
        this.countdownText = "2";
        this.countdownColor = "#FFAA00";
      } else if (this.countdownTimer > 0.6) {
        this.countdownText = "1";
        this.countdownColor = "#FFDD00";
      } else if (this.countdownTimer > 0.0) {
        this.countdownText = "GO!";
        this.countdownColor = "#12FA05";
      } else {
        this.state = 'PLAYING';
      }
    }

    if (this.state !== 'PLAYING' && this.state !== 'COUNTDOWN') return;

    const songTime = this.audio.getCurrentSongTime();

    if (this.spawnIndex >= this.chartNotes.length && songTime > (this.chartNotes[this.chartNotes.length - 1].time + 2.0)) {
      this.state = 'FINISHED';
      return;
    }

    const spawnWindow = 3.2 / this.speed;
    while (this.spawnIndex < this.chartNotes.length) {
      const data = this.chartNotes[this.spawnIndex];
      if (data.time - songTime <= spawnWindow) {
        const visual = this.pool.obtain();
        if (visual) {
          visual.spawn(data.id, data.time, data.lane, data.isPlayer, data.sustainLength);
        }
        this.spawnIndex++;
      } else {
        break;
      }
    }

    const humanIsPlayer = (this.playerRole === 'bf');

    this.pool.forEachActive(note => {
      const distance = (note.strumTime - songTime) * (160 * this.speed);
      note.y = this.receptorY + distance;

      const isBotNote = (note.isPlayer !== humanIsPlayer);

      if (this.gameMode === 'single' && isBotNote && !note.hit && songTime >= note.strumTime) {
        note.hit = true;
        if (note.isPlayer) {
          this.bfPoseTimer = 0.3;
          this.opponentKeyTimers[note.lane] = 0.15;
        } else {
          this.limesPoseTimer = 0.3;
          this.opponentKeyTimers[note.lane] = 0.15;
        }
        note.kill();
      }

      if (!isBotNote && !note.hit && (songTime - note.strumTime) > TIMING_WINDOWS.shit) {
        note.missed = true;
        note.kill();
        this.combo = 0;
        this.hits.miss++;
        this.score = Math.max(0, this.score - 100);
        this.lastRating = "MISS";
        if (humanIsPlayer) this.bfMissTimer = 0.3;
        else this.limesMissTimer = 0.3;
        this.updateAccuracy();
      }
    });

    // Pose and timer tickdowns
    if (this.bfPoseTimer > 0) this.bfPoseTimer -= dt;
    if (this.limesPoseTimer > 0) this.limesPoseTimer -= dt;
    if (this.bfMissTimer > 0) this.bfMissTimer -= dt;
    if (this.limesMissTimer > 0) this.limesMissTimer -= dt;
    if (this.bfTauntTimer > 0) this.bfTauntTimer -= dt;
    if (this.limesTauntTimer > 0) this.limesTauntTimer -= dt;
    for (let i = 0; i < 4; i++) {
      if (this.opponentKeyTimers[i] > 0) this.opponentKeyTimers[i] -= dt;
    }
  }

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    ctx.fillStyle = '#111318';
    ctx.fillRect(0, 0, this.width, this.height);

    if (this.state === 'LOADING' || this.state === 'ERROR') {
      this.renderLoadingScreen(ctx);
      return;
    }

    if (this.isTouchDevice) {
      this.renderTouchHitboxes(ctx);
    }

    const oppBaseX = 80;
    const playerBaseX = 460;

    // Draw Receptors
    for (let i = 0; i < 4; i++) {
      const isLimesHuman = (this.playerRole === 'limes');
      const isBfHuman = (this.playerRole === 'bf');

      const limesActive = isLimesHuman ? this.keysHeld[i] : (this.opponentKeyTimers[i] > 0);
      this.drawArrow(ctx, oppBaseX + i * this.laneWidth, this.receptorY, i, true, limesActive);

      const bfActive = isBfHuman ? this.keysHeld[i] : (this.opponentKeyTimers[i] > 0);
      this.drawArrow(ctx, playerBaseX + i * this.laneWidth, this.receptorY, i, true, bfActive);
    }

    // Draw Notes
    this.pool.forEachActive(note => {
      const baseX = note.isPlayer ? playerBaseX : oppBaseX;
      const x = baseX + (note.lane * this.laneWidth);
      this.drawArrow(ctx, x, note.y, note.lane, false, false);
    });

    this.renderCharacters(ctx);
    this.renderHUD(ctx);

    if (this.creditCardTimer > 0) {
      this.renderSongCreditsCard(ctx);
    }

    if (this.state === 'COUNTDOWN') {
      ctx.save();
      ctx.font = 'bold 82px sans-serif';
      ctx.fillStyle = this.countdownColor;
      ctx.textAlign = 'center';
      ctx.shadowColor = '#000000';
      ctx.shadowBlur = 12;
      ctx.fillText(this.countdownText, this.width / 2, this.height / 2);
      ctx.restore();
    }
  }

  renderSongCreditsCard(ctx) {
    ctx.save();
    const progress = 4.0 - this.creditCardTimer;
    let slideX = Math.min(1, progress * 2.5);
    const alpha = this.creditCardTimer < 0.8 ? (this.creditCardTimer / 0.8) : 1.0;

    const cardWidth = 260;
    const cardHeight = 62;
    const targetX = 20;
    const currentX = (targetX - (1 - slideX) * 200);
    const currentY = 20;

    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(10, 12, 16, 0.85)';
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(currentX, currentY, cardWidth, cardHeight, 6) : ctx.rect(currentX, currentY, cardWidth, cardHeight);
    ctx.fill();

    ctx.fillStyle = this.currentSong.color || '#55E840';
    ctx.fillRect(currentX, currentY, 5, cardHeight);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText(`🎵 ${this.currentSong.name}`, currentX + 16, currentY + 26);

    ctx.fillStyle = '#AAAAAA';
    ctx.font = '12px sans-serif';
    ctx.fillText(`by ${this.currentSong.artist || 'Unknown'}`, currentX + 16, currentY + 48);
    ctx.restore();
  }

  renderTouchHitboxes(ctx) {
    const boxWidth = this.width / 4;
    const boxHeight = 160;
    const boxY = this.height - boxHeight;

    for (let i = 0; i < 4; i++) {
      const isPressed = this.keysHeld[i];
      const x = i * boxWidth;

      ctx.save();
      ctx.fillStyle = ARROW_COLORS[i];
      ctx.globalAlpha = isPressed ? 0.35 : 0.08;
      ctx.fillRect(x, boxY, boxWidth, boxHeight);

      ctx.globalAlpha = isPressed ? 0.8 : 0.25;
      ctx.strokeStyle = ARROW_COLORS[i];
      ctx.lineWidth = 2;
      ctx.strokeRect(x, boxY, boxWidth, boxHeight);
      ctx.restore();
    }
  }

  drawArrow(ctx, x, y, direction, isReceptor, isPressed) {
    ctx.save();
    ctx.translate(x + 24, y + 24);
    const angles = [-Math.PI / 2, Math.PI, 0, Math.PI / 2];
    ctx.rotate(angles[direction]);

    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.lineTo(16, 10);
    ctx.lineTo(6, 10);
    ctx.lineTo(6, 18);
    ctx.lineTo(-6, 18);
    ctx.lineTo(-6, 10);
    ctx.lineTo(-16, 10);
    ctx.closePath();

    if (isReceptor) {
      ctx.strokeStyle = isPressed ? '#FFFFFF' : ARROW_COLORS[direction];
      ctx.lineWidth = 3;
      ctx.stroke();
      if (isPressed) {
        ctx.fillStyle = ARROW_COLORS[direction];
        ctx.globalAlpha = 0.6;
        ctx.fill();
      }
    } else {
      ctx.fillStyle = ARROW_COLORS[direction];
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Character Renderer (Handles Scaling, Floor Anchoring, and Mirroring)
   */
  renderCharacters(ctx) {
    const groundY = 460;
    const boxW = 100;
    const boxH = 140;

    // LEFT: Limes (Faces Right toward BF)
    ctx.save();
    ctx.translate(170, groundY); // Center of Limes box
    if (this.mirrorSprite) ctx.scale(-1, 1);

    if (this.limesTauntTimer > 0) ctx.fillStyle = '#FFDD00'; // Yellow taunt flash
    else if (this.limesMissTimer > 0) ctx.fillStyle = '#555555'; // Dark miss color
    else ctx.fillStyle = this.limesPoseTimer > 0 ? '#55E840' : '#2A7A20';

    ctx.fillRect(-boxW / 2, -boxH, boxW, boxH);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText("LIMES" + (this.playerRole === 'limes' ? " (YOU)" : ""), -boxW / 2 + 15, -60);
    ctx.restore();

    // RIGHT: Boyfriend (Faces Left toward Limes)
    ctx.save();
    ctx.translate(570, groundY); // Center of BF box
    if (!this.mirrorSprite) ctx.scale(-1, 1); // Mirrored by default so BF looks Left!

    if (this.bfTauntTimer > 0) ctx.fillStyle = '#FFDD00';
    else if (this.bfMissTimer > 0) ctx.fillStyle = '#555555';
    else ctx.fillStyle = this.bfPoseTimer > 0 ? '#38A8FF' : '#175294';

    ctx.fillRect(-boxW / 2, -boxH, boxW, boxH);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText("BF" + (this.playerRole === 'bf' ? " (YOU)" : ""), -boxW / 2 + 25, -60);
    ctx.restore();
  }

  renderHUD(ctx) {
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 15px monospace';

    if (this.gameMode === 'multiplayer') {
      const youLead = this.score >= this.opponentScore;
      ctx.fillStyle = youLead ? '#55E840' : '#FF5555';
      const hudText = `YOU: ${this.score} (${this.accuracy}%)  VS  OPPONENT: ${this.opponentScore} (${this.opponentAccuracy}%)`;
      ctx.fillText(hudText, 110, this.height - 180);
    } else {
      const statsText = `Score: ${this.score} | Combo: ${this.combo} (Max: ${this.highestCombo}) | Acc: ${this.accuracy}%`;
      ctx.fillText(statsText, 140, this.height - 180);
    }

    if (this.lastRating) {
      ctx.font = 'bold 24px sans-serif';
      ctx.fillStyle = this.lastRating === 'MISS' ? '#FF3333' : '#FFDD00';
      ctx.fillText(this.lastRating, 340, 240);
    }
  }

  renderLoadingScreen(ctx) {
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '18px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`--- ${this.currentSong ? this.currentSong.name.toUpperCase() : "RHYTHM ENGINE"} ---`, this.width / 2, this.height / 2 - 40);
    ctx.font = '14px monospace';
    ctx.fillText(this.loadingStatus, this.width / 2, this.height / 2);
    ctx.textAlign = 'left';
  }
}
