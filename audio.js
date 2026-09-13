/**
 * src/audio.js
 * Dual-track Web Audio API Engine
 * Handles sample-accurate sync between Instrumental and Vocals.
 */

export class AudioManager {
  constructor() {
    // Create AudioContext with fallback for webkit browsers
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioCtx();

    // Gain nodes for volume control
    this.masterGain = this.ctx.createGain();
    this.instGain = this.ctx.createGain();
    this.voicesGain = this.ctx.createGain();

    // Wire routing: Track Gains -> Master Gain -> Audio Output
    this.instGain.connect(this.masterGain);
    this.voicesGain.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);

    // Audio buffer storage
    this.buffers = {
      inst: null,
      voices: null,
    };

    // Buffer source nodes (re-created per playback)
    this.sources = {
      inst: null,
      voices: null,
    };

    // Timing states
    this.startTime = 0;     // Exact audioContext.currentTime when playback starts
    this.isPlaying = false;
  }

  /**
   * Resumes AudioContext on user interaction (bypasses browser autoplay restrictions).
   */
  async initContext() {
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  /**
   * Loads and decodes an audio file from a URL.
   * @param {string} url 
   * @returns {Promise<AudioBuffer>}
   */
  async loadTrack(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load audio from ${url}: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return await this.ctx.decodeAudioData(arrayBuffer);
  }

  /**
   * Preloads both Inst and Voices files in parallel.
   * @param {string} instUrl 
   * @param {string} voicesUrl 
   */
  async loadSongs(instUrl, voicesUrl) {
    const [instBuffer, voicesBuffer] = await Promise.all([
      this.loadTrack(instUrl),
      this.loadTrack(voicesUrl)
    ]);

    this.buffers.inst = instBuffer;
    this.buffers.voices = voicesBuffer;
  }

  /**
   * Schedules playback of both tracks at a specific AudioContext time.
   * @param {number} scheduledTime - AudioContext timestamp (seconds).
   * @param {number} startOffset - Track offset to seek to (seconds), defaults to 0.
   */
  playAt(scheduledTime, startOffset = 0) {
    if (!this.buffers.inst || !this.buffers.voices) {
      throw new Error("Audio buffers are not loaded yet.");
    }

    // Stop existing sources if running
    this.stop();

    // BufferSourceNodes are one-shot and must be re-instantiated
    this.sources.inst = this.ctx.createBufferSource();
    this.sources.voices = this.ctx.createBufferSource();

    this.sources.inst.buffer = this.buffers.inst;
    this.sources.voices.buffer = this.buffers.voices;

    this.sources.inst.connect(this.instGain);
    this.sources.voices.connect(this.voicesGain);

    // Schedule sample-accurate start
    this.sources.inst.start(scheduledTime, startOffset);
    this.sources.voices.start(scheduledTime, startOffset);

    this.startTime = scheduledTime - startOffset;
    this.isPlaying = true;
  }

  /**
   * Plays immediately with a slight buffer (0.05s) to avoid audio clipping.
   */
  playNow(startOffset = 0) {
    const scheduleTime = this.ctx.currentTime + 0.05;
    this.playAt(scheduleTime, startOffset);
  }

  /**
   * Stops both tracks.
   */
  stop() {
    if (this.sources.inst) {
      try { this.sources.inst.stop(); } catch (_) {}
      this.sources.inst.disconnect();
      this.sources.inst = null;
    }
    if (this.sources.voices) {
      try { this.sources.voices.stop(); } catch (_) {}
      this.sources.voices.disconnect();
      this.sources.voices = null;
    }
    this.isPlaying = false;
  }

  /**
   * Returns current playback position in seconds based on master hardware clock.
   * Eliminates drift caused by setInterval or requestAnimationFrame lag.
   * @returns {number}
   */
  getCurrentSongTime() {
    if (!this.isPlaying) return 0;
    const time = this.ctx.currentTime - this.startTime;
    return Math.max(0, time);
  }

  /**
   * Master volume control (0.0 to 1.0).
   */
  setVolume(value) {
    this.masterGain.gain.setValueAtTime(Math.max(0, Math.min(1, value)), this.ctx.currentTime);
  }
}
