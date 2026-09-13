/**
 * engine.js
 * Core Canvas Rhythm Game Engine
 * Features procedural rendering, Web Audio sync, and zero-allocation note pooling.
 */

import { AudioManager } from './audio.js';
import { ChartParser } from './parser.js';
import { NotePool } from './pool.js';

// Directional Arrow Colors (FNF standard)
const ARROW_COLORS = [
  '#C24B99', // 0: Left (Purple)
  '#00FFFF', // 1: Down (Cyan)
  '#12FA05', // 2: Up (Green)
  '#F9393F'  // 3: Right (Red)
];

// Keybind Mappings (DFJK + Arrow Keys)
const KEY_MAP = {
  KeyD: 0, ArrowLeft: 0,
  KeyF: 1, ArrowDown: 1,
  KeyJ: 2, ArrowUp: 2,
  KeyK: 3, ArrowRight: 3
};

// Hit Windows (in seconds)
const TIMING_WINDOWS = {
  sick: 0.045, // +/- 45ms
  good: 0.090, // +/- 90ms
  bad:  0.135, // +/- 135ms
  shit: 0.166  // +/- 166ms
};

export class RhythmEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    // Core Subsystems
    this.audio = new AudioManager();
    this.pool = new NotePool(160);
    this.chart = null;

    // Dimensions & Layout
    this.width = canvas.width;
    this.height = canvas.height;
    this.laneWidth = 60;
    this.receptorY = 80; // Upscroll receptor Y position
    this.speed = 2.9;    // From normal.json

    // Note Spawning Cursor
    this.chartNotes = [];
    this.spawnIndex = 0;

    // Input States (Lanes 0-3)
    this.keysHeld = [false, false, false, false];

    // Scoring & Stats
    this.score = 0;
    this.combo = 0;
    this.highestCombo = 0;
    this.hits = { sick: 0, good: 0, bad: 0, shit: 0, miss: 0 };
    this.totalNotesPlayed = 0;
    this.accuracy = 100.0;
    this.lastRating = "";

    // Character Dance/Pose Timers (seconds)
    this.bfPoseTimer = 0;
    this.limesPoseTimer = 0;
    this.bfPoseDirection = -1;
    this.limesPoseDirection = -1;

    // Engine State
    this.state = 'LOADING'; // LOADING | READY | PLAYING | FINISHED
    this.loadingStatus = "Initializing...";

    this.setupInputs();
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

  /**
   * Preloads normal.json, Inst.ogg, and Voices.ogg in parallel.
   */
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
      this.loadingStatus = "Ready! Click or press Space to play.";
    } catch (err) {
      this.state = 'ERROR';
      this.loadingStatus = `Error: ${err.message}`;
      console.error(err);
    }
  }

  start() {
    if (this.state !== 'READY') return;
    this.audio.initContext().then(() => {
      this.state = 'PLAYING';
      this.audio.playNow();
    });
  }

  handleKeyPress(lane) {
    const songTime = this.audio.getCurrentSongTime();
    let hitNote = null;
    let minDiff = Infinity;

    // Find the closest active unhit player note in this lane
    this.pool.forEachActive(note => {
      if (note.isPlayer && note.lane === lane && !note.hit) {
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

      // Determine Judgment
      let rating = "shit";
      let pts = 50;

      if (minDiff <= TIMING_WINDOWS.sick) {
        rating = "SICK!";
        pts = 350;
        this.hits.sick++;
      } else if (minDiff <= TIMING_WINDOWS.good) {
        rating = "GOOD";
        pts = 200;
        this.hits.good++;
      } else if (minDiff <= TIMING_WINDOWS.bad) {
        rating = "BAD";
        pts = 100;
        this.hits.bad++;
      } else {
        this.hits.shit++;
      }

      this.score += pts;
      this.combo++;
      if (this.combo > this.highestCombo) this.highestCombo = this.combo;
      this.lastRating = rating;

      // BF Pose Trigger
      this.bfPoseDirection = lane;
      this.bfPoseTimer = 0.3; // Hold pose for 300ms
    } else {
      // Ghost tapping penalty (miss)
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

    // 1. Check for end of song
    if (this.spawnIndex >= this.chartNotes.length && songTime > (this.chartNotes[this.chartNotes.length - 1].time + 2.0)) {
      this.state = 'FINISHED';
      return;
    }

    // 2. Stream notes from sorted chart list into active pool
    // Visible horizon: ~1.5 seconds in advance
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

    // 3. Update & Cull Active Notes
    this.pool.forEachActive(note => {
      // Calculate Canvas Y position (Upscroll: travels upwards towards receptorY)
      // speed factor: 450 pixels/sec * speed multiplier
      const distance = (note.strumTime - songTime) * (450 * this.speed);
      note.y = this.receptorY + distance;

      // Botplay auto-trigger for Opponent (Limes)
      if (!note.isPlayer && !note.hit && songTime >= note.strumTime) {
        note.hit = true;
        this.limesPoseDirection = note.lane;
        this.limesPoseTimer = 0.3;
        note.kill();
      }

      // Check for missed player notes (passed receptor window)
      if (note.isPlayer && !note.hit && (songTime - note.strumTime) > TIMING_WINDOWS.shit) {
        note.missed = true;
        note.kill();
        this.combo = 0;
        this.hits.miss++;
        this.score = Math.max(0, this.score - 100);
        this.lastRating = "MISS";
        this.updateAccuracy();
      }
    });

    // 4. Character pose timers
    if (this.bfPoseTimer > 0) this.bfPoseTimer -= dt;
    if (this.limesPoseTimer > 0) this.limesPoseTimer -= dt;
  }

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    // Background Dim
    ctx.fillStyle = '#111318';
    ctx.fillRect(0, 0, this.width, this.height);

    if (this.state === 'LOADING' || this.state === 'READY' || this.state === 'ERROR') {
      this.renderLoadingScreen(ctx);
      return;
    }

    // Lane Base X coordinates
    // Opponent (Left side): x = 80
    // Player (Right side): x = 460
    const oppBaseX = 80;
    const playerBaseX = 460;

    // Draw Receptors (Static Target Arrows)
    for (let i = 0; i < 4; i++) {
      this.drawArrow(ctx, oppBaseX + i * this.laneWidth, this.receptorY, i, false, false);
      const isHeld = this.keysHeld[i];
      this.drawArrow(ctx, playerBaseX + i * this.laneWidth, this.receptorY, i, true, isHeld);
    }

    // Draw Falling/Rising Notes from Pool
    this.pool.forEachActive(note => {
      const baseX = note.isPlayer ? playerBaseX : oppBaseX;
      const x = baseX + (note.lane * this.laneWidth);
      this.drawArrow(ctx, x, note.y, note.lane, false, false);
    });

    // Draw Character Placeholders
    this.renderCharacters(ctx);

    // Draw HUD (Score, Combo, Accuracy, Rating)
    this.renderHUD(ctx);
  }

  /**
   * Procedural Arrow Renderer (Crisp vector shapes, 0 image asset overhead)
   */
  drawArrow(ctx, x, y, direction, isReceptor, isPressed) {
    ctx.save();
    ctx.translate(x + 24, y + 24);

    // Rotation: 0=Left (-90deg), 1=Down (180deg), 2=Up (0deg), 3=Right (90deg)
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
    // Left: Limes Box / Avatar Placeholder
    const limesPose = this.limesPoseTimer > 0;
    ctx.fillStyle = limesPose ? '#55E840' : '#2A7A20';
    ctx.fillRect(120, 360, 100, 140);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText("LIMES", 145, 435);

    // Right: Boyfriend Box / Avatar Placeholder
    const bfPose = this.bfPoseTimer > 0;
    ctx.fillStyle = bfPose ? '#38A8FF' : '#175294';
    ctx.fillRect(520, 360, 100, 140);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText("BOYFRIEND", 530, 435);
  }

  renderHUD(ctx) {
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 16px monospace';

    // Score & Accuracy Bar at Bottom
    const statsText = `Score: ${this.score} | Combo: ${this.combo} (Max: ${this.highestCombo}) | Accuracy: ${this.accuracy}%`;
    ctx.fillText(statsText, 140, this.height - 30);

    // Rating Popup
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
    ctx.fillText("--- STARGAZER (VS IMPOSTOR) ---", this.width / 2, this.height / 2 - 40);
    ctx.font = '14px monospace';
    ctx.fillText(this.loadingStatus, this.width / 2, this.height / 2);
    ctx.textAlign = 'left';
  }
}
