/**
 * engine.js (Updated for Singleplayer + Multiplayer Roles)
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

    // Game Mode & Role: 'bf' (Player 1) or 'limes' (Player 2)
    this.gameMode = 'single'; // 'single' | 'multiplayer'
    this.playerRole = 'bf';   // 'bf' controls right side, 'limes' controls left side
    this.isBotplayOpponent = true;

    // Keys & Stats
    this.keysHeld = [false, false, false, false];
    this.score = 0;
    this.combo = 0;
    this.highestCombo = 0;
    this.hits = { sick: 0, good: 0, bad: 0, shit: 0, miss: 0 };
    this.totalNotesPlayed = 0;
    this.accuracy = 100.0;
    this.lastRating = "";

    // Pose Timers
    this.bfPoseTimer = 0;
    this.limesPoseTimer = 0;

    // Multiplayer Hook
    this.onNoteHitCallback = null;

    this.state = 'LOADING';
    this.loadingStatus = "Initializing...";

    this.setupInputs();
  }

  setRole(role) {
    this.playerRole = role; // 'bf' or 'limes'
  }

  setupInputs() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
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

  async loadAssets() {
    try {
      this.loadingStatus = "Loading audio tracks...";
      const audioPromise = this.audio.loadSongs('assets/Inst.ogg', 'assets/Voices.ogg');

      this.loadingStatus = "Loading chart data...";
      const chartPromise = fetch('assets/normal.json').then(res => {
        if (!res.ok) throw new Error("Could not find assets/normal.json");
        return res.json();
      });

      const [_, rawJson] = await Promise.all([audioPromise, chartPromise]);

      this.loadingStatus = "Parsing chart...";
      this.chart = ChartParser.parse(rawJson);
      this.chartNotes = this.chart.notes;
      this.speed = this.chart.speed || 2.9;

      this.state = 'READY';
      this.loadingStatus = "Loaded!";
    } catch (err) {
      this.state = 'ERROR';
      this.loadingStatus = `Error: ${err.message}`;
      console.error(err);
    }
  }

  start(startTimeInSeconds = null) {
    this.audio.initContext().then(() => {
      this.state = 'PLAYING';
      if (startTimeInSeconds) {
        // Scheduled timestamp from server
        this.audio.playAt(startTimeInSeconds);
      } else {
        // Immediate local playback (Singleplayer)
        this.audio.playNow();
      }
    });
  }

  handleKeyPress(lane) {
    const songTime = this.audio.getCurrentSongTime();
    let hitNote = null;
    let minDiff = Infinity;

    // Human hits notes for their selected character
    // 'bf' hits isPlayer === true | 'limes' hits isPlayer === false
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

      // Broadcast hit to opponent if in multiplayer
      if (this.onNoteHitCallback) {
        this.onNoteHitCallback({ lane, rating, score: this.score, accuracy: this.accuracy });
      }
    } else {
      this.score = Math.max(0, this.score - 50);
      this.combo = 0;
      this.hits.miss++;
      this.lastRating = "MISS";
    }

    this.updateAccuracy();
  }

  updateAccuracy() {
    this.totalNotesPlayed = this.hits.sick + this.hits.good + this.hits.bad + this.hits.shit + this.hits.miss;
    if (this.totalNotesPlayed === 0) return;
    const weightedScore = (this.hits.sick * 1.0) + (this.hits.good * 0.75) + (this.hits.bad * 0.5) + (this.hits.shit * 0.25);
    this.accuracy = ((weightedScore / this.totalNotesPlayed) * 100).toFixed(2);
  }

  update(dt) {
    if (this.state !== 'PLAYING') return;

    const songTime = this.audio.getCurrentSongTime();

    if (this.spawnIndex >= this.chartNotes.length && songTime > (this.chartNotes[this.chartNotes.length - 1].time + 2.0)) {
      this.state = 'FINISHED';
      return;
    }

    const spawnWindow = 1.5 / this.speed;
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
      const distance = (note.strumTime - songTime) * (450 * this.speed);
      note.y = this.receptorY + distance;

      const isBotNote = (note.isPlayer !== humanIsPlayer);

      // In Singleplayer, Bot auto-hits the opponent character
      if (this.gameMode === 'single' && isBotNote && !note.hit && songTime >= note.strumTime) {
        note.hit = true;
        if (note.isPlayer) {
          this.bfPoseTimer = 0.3; // Bot is playing BF
        } else {
          this.limesPoseTimer = 0.3; // Bot is playing Limes
        }
        note.kill();
      }

      // Check for human misses
      if (!isBotNote && !note.hit && (songTime - note.strumTime) > TIMING_WINDOWS.shit) {
        note.missed = true;
        note.kill();
        this.combo = 0;
        this.hits.miss++;
        this.score = Math.max(0, this.score - 100);
        this.lastRating = "MISS";
        this.updateAccuracy();
      }
    });

    if (this.bfPoseTimer > 0) this.bfPoseTimer -= dt;
    if (this.limesPoseTimer > 0) this.limesPoseTimer -= dt;
  }

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    ctx.fillStyle = '#111318';
    ctx.fillRect(0, 0, this.width, this.height);

    if (this.state === 'LOADING' || this.state === 'READY' || this.state === 'ERROR') {
      this.renderLoadingScreen(ctx);
      return;
    }

    const oppBaseX = 80;
    const playerBaseX = 460;

    // Draw Receptors
    for (let i = 0; i < 4; i++) {
      const isLimesHuman = (this.playerRole === 'limes');
      const isBfHuman = (this.playerRole === 'bf');

      this.drawArrow(ctx, oppBaseX + i * this.laneWidth, this.receptorY, i, true, isLimesHuman && this.keysHeld[i]);
      this.drawArrow(ctx, playerBaseX + i * this.laneWidth, this.receptorY, i, true, isBfHuman && this.keysHeld[i]);
    }

    // Draw Active Notes
    this.pool.forEachActive(note => {
      const baseX = note.isPlayer ? playerBaseX : oppBaseX;
      const x = baseX + (note.lane * this.laneWidth);
      this.drawArrow(ctx, x, note.y, note.lane, false, false);
    });

    this.renderCharacters(ctx);
    this.renderHUD(ctx);
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
        ctx.globalAlpha = 0.5;
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

  renderCharacters(ctx) {
    const limesPose = this.limesPoseTimer > 0;
    ctx.fillStyle = limesPose ? '#55E840' : '#2A7A20';
    ctx.fillRect(120, 360, 100, 140);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText("LIMES" + (this.playerRole === 'limes' ? " (YOU)" : " (BOT)"), 130, 435);

    const bfPose = this.bfPoseTimer > 0;
    ctx.fillStyle = bfPose ? '#38A8FF' : '#175294';
    ctx.fillRect(520, 360, 100, 140);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText("BF" + (this.playerRole === 'bf' ? " (YOU)" : " (BOT)"), 545, 435);
  }

  renderHUD(ctx) {
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 16px monospace';
    const statsText = `Score: ${this.score} | Combo: ${this.combo} (Max: ${this.highestCombo}) | Acc: ${this.accuracy}%`;
    ctx.fillText(statsText, 140, this.height - 30);

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
    ctx.fillText("--- STARGAZER ---", this.width / 2, this.height / 2 - 40);
    ctx.font = '14px monospace';
    ctx.fillText(this.loadingStatus, this.width / 2, this.height / 2);
    ctx.textAlign = 'left';
  }
}
