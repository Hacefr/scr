/**
 * engine.js
 * Core Canvas Rhythm Game Engine
 * Features:
 * - Top Song Progress & Time Bar
 * - Bottom VS Tug-of-War Health Bar with Animated Bouncing Icons
 * - Corrected Camera Pan (faces active singer) & Rhythmic Beat Bop
 * - Hold / Sustain Notes with Trails & Continuous Scoring
 * - Live Ping Display (Local & Opponent) on HUD
 * - Clean Menu Rendering (No ghost gameplay in menus)
 * - Taunt Mechanic (Key T / Mobile Yellow Button) & Miss Poses
 * - Fit-To-Frame Scaling & Ground Floor Anchoring
 * - Dynamic Multi-Song loader with custom bg.png
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
    this.receptorY = 70;
    this.speed = 2.9;
    this.bpm = 150;

    this.chartNotes = [];
    this.spawnIndex = 0;
    this.totalSongDuration = 120;

    // Camera Beat Bop & Pan States
    this.camZoom = 1.0;
    this.camX = 0;
    this.targetCamX = 0;
    this.lastBeat = -1;

    // Tug-of-War Health (0.05 to 1.95)
    this.health = 1.0;

    // Stage Background
    this.stageBg = new Image();
    this.hasBg = false;

    // Custom Skins Store
    this.customSkins = {
      local: { idle: null, left: null, down: null, up: null, right: null, miss: null, taunt: null, icon: null },
      opponent: { idle: null, left: null, down: null, up: null, right: null, miss: null, taunt: null, icon: null }
    };

    this.currentSong = { name: "Stargazer", artist: "VS Impostor Legacy", color: "#55E840" };
    this.creditCardTimer = 0;

    this.gameMode = 'single';
    this.playerRole = 'bf';
    this.ghostTapping = true;
    this.mobileControlsMode = 'auto';

    // Countdown State
    this.countdownTimer = 0;
    this.countdownText = "";
    this.countdownColor = "#FFFFFF";
    this.targetStartAudioTime = 0;

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

    // Live Ping Metrics
    this.localPing = 0;
    this.opponentPing = 0;

    // Pose Timers
    this.bfPoseTimer = 0;
    this.limesPoseTimer = 0;
    this.bfPoseDir = -1;
    this.limesPoseDir = -1;

    this.bfMissTimer = 0;
    this.limesMissTimer = 0;
    this.bfTauntTimer = 0;
    this.limesTauntTimer = 0;

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

  shouldShowMobileUI() {
    if (this.mobileControlsMode === 'on') return true;
    if (this.mobileControlsMode === 'off') return false;
    return this.isTouchDevice;
  }

  setSkin(target, skinData) {
    if (!skinData) return;
    const poses = ['idle', 'left', 'down', 'up', 'right', 'miss', 'taunt', 'icon'];
    poses.forEach(pose => {
      if (skinData[pose]) {
        const img = new Image();
        img.src = skinData[pose];
        this.customSkins[target][pose] = img;
      }
    });
  }

  setupInputs() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;

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
      if (!this.shouldShowMobileUI()) return;
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
      if (!this.shouldShowMobileUI()) return;
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
    if (this.playerRole === 'bf') this.bfTauntTimer = 0.4;
    else this.limesTauntTimer = 0.4;

    if (this.onTauntCallback) {
      this.onTauntCallback({ role: this.playerRole });
    }
  }

  handleOpponentTaunt(data) {
    if (data.role === 'bf') this.bfTauntTimer = 0.4;
    else this.limesTauntTimer = 0.4;
  }

  async loadAssets(songData = { folder: "stargazer", name: "Stargazer", artist: "VS Impostor Legacy", color: "#55E840" }) {
    this.currentSong = songData;
    this.state = 'LOADING';
    const folder = songData.folder || "stargazer";
    const chartFile = songData.chart || "normal.json";

    this.hasBg = false;
    this.stageBg = new Image();
    this.stageBg.onload = () => { this.hasBg = true; };
    this.stageBg.onerror = () => { this.hasBg = false; };
    this.stageBg.src = `assets/songs/${folder}/bg.png`;

    try {
      this.loadingStatus = `Buffering ${songData.name}...`;
      const audioPromise = this.audio.loadSongs(`assets/songs/${folder}/Inst.ogg`, `assets/songs/${folder}/Voices.ogg`);

      const chartPromise = fetch(`assets/songs/${folder}/${chartFile}`).then(res => {
        if (!res.ok) throw new Error(`Could not find assets/songs/${folder}/${chartFile}`);
        return res.json();
      });

      const [_, rawJson] = await Promise.all([audioPromise, chartPromise]);

      this.chart = ChartParser.parse(rawJson);
      this.chartNotes = this.chart.notes;
      this.speed = this.chart.speed || 2.9;
      this.bpm = this.chart.bpm || 150;

      if (this.chartNotes.length > 0) {
        const last = this.chartNotes[this.chartNotes.length - 1];
        this.totalSongDuration = last.time + (last.sustainLength || 0) + 1.5;
      }

      this.pool.clear();
      this.spawnIndex = 0;
      this.score = 0;
      this.combo = 0;
      this.hits = { sick: 0, good: 0, bad: 0, shit: 0, miss: 0 };
      this.accuracy = 100.0;
      this.health = 1.0;
      this.lastRating = "";
      this.lastBeat = -1;
      this.camX = 0;
      this.targetCamX = 0;

      this.state = 'READY';
      this.loadingStatus = "Ready!";
      return true;
    } catch (err) {
      this.state = 'ERROR';
      this.loadingStatus = `Error: ${err.message}`;
      console.error(err);
      throw err;
    }
  }

  async startWithCountdown(targetStartAudioTime, countdownDurationSeconds = 3.0) {
    await this.audio.initContext();
    this.state = 'COUNTDOWN';
    this.targetStartAudioTime = targetStartAudioTime;
    this.countdownTimer = countdownDurationSeconds;

    this.audio.playAt(targetStartAudioTime);
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

      if (hitNote.sustainLength > 0) {
        hitNote.isHolding = true;
      } else {
        hitNote.kill();
      }

      let rating = "shit";
      let pts = 50;

      if (minDiff <= TIMING_WINDOWS.sick) {
        rating = "SICK!"; pts = 350; this.hits.sick++;
        this.health = Math.min(1.95, this.health + 0.04);
      } else if (minDiff <= TIMING_WINDOWS.good) {
        rating = "GOOD"; pts = 200; this.hits.good++;
        this.health = Math.min(1.95, this.health + 0.025);
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
        this.bfPoseDir = lane;
        this.targetCamX = 25; // Focus BF (Right side)
      } else {
        this.limesPoseTimer = 0.3;
        this.limesPoseDir = lane;
        this.targetCamX = -25; // Focus Limes (Left side)
      }

      if (this.onNoteHitCallback) {
        this.onNoteHitCallback({ lane, rating, score: this.score, accuracy: this.accuracy });
      }
    } else {
      if (!this.ghostTapping) {
        this.score = Math.max(0, this.score - 50);
        this.combo = 0;
        this.hits.miss++;
        this.health = Math.max(0.05, this.health - 0.08);
        this.lastRating = "MISS";

        if (this.playerRole === 'bf') this.bfMissTimer = 0.3;
        else this.limesMissTimer = 0.3;
        this.updateAccuracy();
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
      this.limesPoseDir = lane;
      this.targetCamX = -25;
    } else {
      this.bfPoseTimer = 0.3;
      this.bfPoseDir = lane;
      this.targetCamX = 25;
    }

    const targetIsPlayer = (this.playerRole !== 'bf');
    this.pool.forEachActive(note => {
      if (note.isPlayer === targetIsPlayer && note.lane === lane && !note.hit) {
        note.hit = true;
        if (note.sustainLength > 0) {
          note.isHolding = true;
        } else {
          note.kill();
        }
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
      const remainingSeconds = this.targetStartAudioTime - this.audio.ctx.currentTime;
      this.countdownTimer = Math.max(0, remainingSeconds);

      if (this.countdownTimer > 2.0) {
        this.countdownText = "3";
        this.countdownColor = "#F9393F";
      } else if (this.countdownTimer > 1.0) {
        this.countdownText = "2";
        this.countdownColor = "#FFAA00";
      } else if (this.countdownTimer > 0.1) {
        this.countdownText = "1";
        this.countdownColor = "#FFDD00";
      } else {
        this.countdownText = "GO!";
        this.countdownColor = "#12FA05";
        if (remainingSeconds <= 0) {
          this.state = 'PLAYING';
        }
      }
    }

    if (this.state !== 'PLAYING' && this.state !== 'COUNTDOWN') return;

    const songTime = this.audio.getCurrentSongTime();

    // Camera Beat Bop (Rhythmic 3% punch on every beat)
    if (this.bpm > 0) {
      const currentBeat = Math.floor(songTime * (this.bpm / 60));
      if (currentBeat !== this.lastBeat && currentBeat >= 0) {
        this.lastBeat = currentBeat;
        this.camZoom = 1.03;
      }
    }
    this.camZoom += (1.0 - this.camZoom) * 10 * dt;
    this.camX += (this.targetCamX - this.camX) * 4 * dt;

    // Song completion check
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
          visual.isHolding = false;
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
      const noteEndTime = note.strumTime + (note.sustainLength || 0);

      // Sustain Hold Logic
      if (note.isHolding) {
        if (!isBotNote) {
          if (this.keysHeld[note.lane]) {
            this.score += Math.round(180 * dt);
            if (humanIsPlayer) this.bfPoseTimer = 0.2;
            else this.limesPoseTimer = 0.2;

            if (songTime >= noteEndTime) {
              note.isHolding = false;
              note.kill();
            }
          } else {
            note.isHolding = false;
            note.kill();
          }
        } else {
          if (songTime < noteEndTime) {
            if (humanIsPlayer) this.limesPoseTimer = 0.2;
            else this.bfPoseTimer = 0.2;
            this.opponentKeyTimers[note.lane] = 0.15;
          } else {
            note.isHolding = false;
            note.kill();
          }
        }
      }

      // Bot Auto-Hit
      if (this.gameMode === 'single' && isBotNote && !note.hit && songTime >= note.strumTime) {
        note.hit = true;
        if (note.sustainLength > 0) {
          note.isHolding = true;
        } else {
          if (note.isPlayer) { this.bfPoseTimer = 0.3; this.bfPoseDir = note.lane; this.targetCamX = 25; }
          else { this.limesPoseTimer = 0.3; this.limesPoseDir = note.lane; this.targetCamX = -25; }
          this.opponentKeyTimers[note.lane] = 0.15;
          note.kill();
        }
      }

      // Human Miss
      if (!isBotNote && !note.hit && (songTime - note.strumTime) > TIMING_WINDOWS.shit) {
        note.missed = true;
        note.kill();
        this.combo = 0;
        this.hits.miss++;
        this.health = Math.max(0.05, this.health - 0.08);
        this.score = Math.max(0, this.score - 100);
        this.lastRating = "MISS";
        if (humanIsPlayer) this.bfMissTimer = 0.3;
        else this.limesMissTimer = 0.3;
        this.updateAccuracy();
      }
    });

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

    // If on Menu or Boot: ONLY render clean background
    if (this.state !== 'PLAYING' && this.state !== 'COUNTDOWN') {
      if (this.hasBg) {
        ctx.drawImage(this.stageBg, 0, 0, this.width, this.height);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(0, 0, this.width, this.height);
      } else {
        ctx.fillStyle = '#111318';
        ctx.fillRect(0, 0, this.width, this.height);
      }
      return;
    }

    // ==========================================
    // LAYER 1: STAGE (Correct negative translation camera)
    // ==========================================
    ctx.save();
    ctx.translate(this.width / 2 - this.camX, this.height / 2);
    ctx.scale(this.camZoom, this.camZoom);
    ctx.translate(-this.width / 2, -this.height / 2);

    if (this.hasBg) {
      ctx.drawImage(this.stageBg, 0, 0, this.width, this.height);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fillRect(0, 0, this.width, this.height);
    } else {
      ctx.fillStyle = '#111318';
      ctx.fillRect(0, 0, this.width, this.height);
    }

    this.renderCharacters(ctx);
    ctx.restore();

    // ==========================================
    // LAYER 2: MOBILE TOUCH HITBOXES
    // ==========================================
    if (this.shouldShowMobileUI()) {
      this.renderTouchHitboxes(ctx);
    }

    // ==========================================
    // LAYER 3: RECEPTORS & NOTES
    // ==========================================
    const oppBaseX = 80;
    const playerBaseX = 460;

    for (let i = 0; i < 4; i++) {
      const isLimesHuman = (this.playerRole === 'limes');
      const isBfHuman = (this.playerRole === 'bf');

      const limesActive = isLimesHuman ? this.keysHeld[i] : (this.opponentKeyTimers[i] > 0);
      this.drawArrow(ctx, oppBaseX + i * this.laneWidth, this.receptorY, i, true, limesActive);

      const bfActive = isBfHuman ? this.keysHeld[i] : (this.opponentKeyTimers[i] > 0);
      this.drawArrow(ctx, playerBaseX + i * this.laneWidth, this.receptorY, i, true, bfActive);
    }

    this.pool.forEachActive(note => {
      const baseX = note.isPlayer ? playerBaseX : oppBaseX;
      const x = baseX + (note.lane * this.laneWidth);

      if (note.sustainLength > 0) {
        const fullTrailHeight = note.sustainLength * (160 * this.speed);
        let startY = note.y + 24;
        let trailH = fullTrailHeight;

        if (note.isHolding) {
          startY = this.receptorY + 24;
          const remainingTime = (note.strumTime + note.sustainLength) - this.audio.getCurrentSongTime();
          trailH = Math.max(0, remainingTime * (160 * this.speed));
        }

        if (trailH > 0 && !note.missed) {
          ctx.save();
          ctx.fillStyle = ARROW_COLORS[note.lane];
          ctx.globalAlpha = 0.65;
          ctx.fillRect(x + 18, startY, 12, trailH);
          ctx.beginPath();
          ctx.arc(x + 24, startY + trailH, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      if (!note.isHolding) {
        this.drawArrow(ctx, x, note.y, note.lane, false, false);
      }
    });

    // ==========================================
    // LAYER 4: TOP TIME BAR, BOTTOM TUG-OF-WAR & HUD
    // ==========================================
    this.renderTopTimeBar(ctx);
    this.renderBottomHealthBar(ctx);
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

  renderTopTimeBar(ctx) {
    const songTime = this.audio.getCurrentSongTime();
    const pct = Math.min(1, Math.max(0, songTime / (this.totalSongDuration || 1)));

    const barW = 380;
    const barH = 11;
    const barX = (this.width - barW) / 2;
    const barY = 18;

    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(barX, barY, barW, barH);

    ctx.fillStyle = this.currentSong.color || '#55E840';
    ctx.fillRect(barX + 2, barY + 2, (barW - 4) * pct, barH - 4);

    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(barX, barY, barW, barH);

    const formatTime = (secs) => {
      const m = Math.floor(secs / 60);
      const s = Math.floor(secs % 60);
      return `${m}:${s < 10 ? '0' : ''}${s}`;
    };

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${this.currentSong.name} (${formatTime(songTime)} / ${formatTime(this.totalSongDuration)})`, this.width / 2, barY + 23);
    ctx.restore();
  }

  renderBottomHealthBar(ctx) {
    const barW = 380;
    const barH = 12;
    const barX = (this.width - barW) / 2;
    const barY = this.height - 48;

    const playerPct = Math.min(1, Math.max(0, this.health / 2.0));
    const splitX = barX + (barW * (1 - playerPct));

    ctx.save();
    ctx.fillStyle = '#55E840';
    ctx.fillRect(barX, barY, barW, barH);

    ctx.fillStyle = '#38A8FF';
    ctx.fillRect(splitX, barY, (barX + barW) - splitX, barH);

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(barX, barY, barW, barH);

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(splitX - 2, barY - 2, 4, barH + 4);

    const iconY = barY + barH / 2;
    const iconScale = this.camZoom;

    this.drawHealthIcon(ctx, splitX - 18, iconY, 'opponent', { bg: '#2A7A20', text: 'L' }, iconScale);
    this.drawHealthIcon(ctx, splitX + 18, iconY, 'local', { bg: '#175294', text: 'BF' }, iconScale);
    ctx.restore();
  }

  drawHealthIcon(ctx, x, y, skinTarget, fallback, scale) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);

    const skin = (this.playerRole === 'limes')
      ? (skinTarget === 'opponent' ? this.customSkins.local : this.customSkins.opponent)
      : (skinTarget === 'opponent' ? this.customSkins.opponent : this.customSkins.local);

    if (skin && skin.icon && skin.icon.complete && skin.icon.naturalWidth > 0) {
      ctx.drawImage(skin.icon, -16, -16, 32, 32);
    } else {
      ctx.fillStyle = fallback.bg;
      ctx.beginPath();
      ctx.arc(0, 0, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(fallback.text, 0, 1);
    }
    ctx.restore();
  }

  renderHUD(ctx) {
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';

    const hudY = this.height - 18;

    if (this.gameMode === 'multiplayer') {
      const youLead = this.score >= this.opponentScore;
      ctx.fillStyle = youLead ? '#55E840' : '#FF3855';
      const hudText = `YOU: ${this.score} (${this.accuracy}%)  vs  OPPONENT: ${this.opponentScore} (${this.opponentAccuracy}%)`;
      ctx.fillText(hudText, this.width / 2, hudY);

      // Render Live Pings in Bottom Corners
      ctx.save();
      ctx.font = '11px monospace';
      ctx.fillStyle = '#888888';
      ctx.textAlign = 'left';
      ctx.fillText(`PING: ${this.localPing || 0}ms`, 14, this.height - 18);
      ctx.textAlign = 'right';
      ctx.fillText(`OPP PING: ${this.opponentPing || 0}ms`, this.width - 14, this.height - 18);
      ctx.restore();
    } else {
      const statsText = `Score: ${this.score} | Combo: ${this.combo} (Max: ${this.highestCombo}) | Acc: ${this.accuracy}%`;
      ctx.fillText(statsText, this.width / 2, hudY);
    }

    if (this.lastRating) {
      ctx.font = 'bold 24px sans-serif';
      ctx.fillStyle = this.lastRating === 'MISS' ? '#FF3855' : '#FDE871';
      ctx.fillText(this.lastRating, this.width / 2, 230);
    }
    ctx.textAlign = 'left';
  }

  drawCharacter(ctx, x, groundY, skin, poseDir, poseTimer, missTimer, tauntTimer, fallbackColor, label, shouldMirror) {
    ctx.save();
    ctx.translate(x, groundY);

    if (shouldMirror) {
      ctx.scale(-1, 1);
    }

    let activeImg = null;
    const dirs = ['left', 'down', 'up', 'right'];

    if (tauntTimer > 0 && skin.taunt) activeImg = skin.taunt;
    else if (missTimer > 0 && skin.miss) activeImg = skin.miss;
    else if (poseTimer > 0 && poseDir >= 0 && skin[dirs[poseDir]]) activeImg = skin[dirs[poseDir]];
    else if (skin.idle) activeImg = skin.idle;

    if (activeImg && activeImg.complete && activeImg.naturalWidth > 0) {
      const maxW = 160;
      const maxH = 200;
      const scale = Math.min(maxW / activeImg.naturalWidth, maxH / activeImg.naturalHeight);
      const w = activeImg.naturalWidth * scale;
      const h = activeImg.naturalHeight * scale;

      ctx.drawImage(activeImg, -w / 2, -h, w, h);
    } else {
      const boxW = 100;
      const boxH = 140;
      ctx.globalAlpha = 0.85;

      if (tauntTimer > 0) ctx.fillStyle = '#FFDD00';
      else if (missTimer > 0) ctx.fillStyle = '#555555';
      else ctx.fillStyle = poseTimer > 0 ? fallbackColor.active : fallbackColor.idle;

      ctx.fillRect(-boxW / 2, -boxH, boxW, boxH);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 14px sans-serif';
      ctx.fillText(label, -boxW / 2 + 15, -60);
    }

    ctx.restore();
  }

  renderCharacters(ctx) {
    const groundY = 510;
    const isLimesLocal = (this.playerRole === 'limes');

    const limesSkin = isLimesLocal ? this.customSkins.local : this.customSkins.opponent;
    const bfSkin = isLimesLocal ? this.customSkins.opponent : this.customSkins.local;

    this.drawCharacter(
      ctx, 200, groundY, limesSkin,
      this.limesPoseDir, this.limesPoseTimer, this.limesMissTimer, this.limesTauntTimer,
      { active: '#55E840', idle: '#2A7A20' },
      "LIMES" + (isLimesLocal ? " (YOU)" : ""),
      this.mirrorSprite
    );

    this.drawCharacter(
      ctx, 580, groundY, bfSkin,
      this.bfPoseDir, this.bfPoseTimer, this.bfMissTimer, this.bfTauntTimer,
      { active: '#38A8FF', idle: '#175294' },
      "BF" + (!isLimesLocal ? " (YOU)" : ""),
      !this.mirrorSprite
    );
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
    ctx.fillStyle = 'rgba(10, 12, 16, 0.88)';
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
