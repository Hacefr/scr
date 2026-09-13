/**
 * src/pool.js
 * High-Performance Object Pool for Active Notes.
 * Completely eliminates Garbage Collection (GC) stutters on low-end devices.
 */

export class NoteVisual {
  constructor() {
    this.active = false;
    this.id = -1;
    this.strumTime = 0;    // Target hit time in seconds
    this.lane = 0;         // 0: Left, 1: Down, 2: Up, 3: Right
    this.isPlayer = false; // true = BF (Right), false = Opponent (Left)
    this.sustainLength = 0;// Length in seconds (0 = normal note)
    this.hit = false;      // True once struck
    this.missed = false;   // True if window expired
    this.y = -9999;        // Rendered canvas Y position
  }

  /**
   * Reinitializes a pooled note for reuse.
   */
  spawn(id, strumTime, lane, isPlayer, sustainLength) {
    this.active = true;
    this.id = id;
    this.strumTime = strumTime;
    this.lane = lane;
    this.isPlayer = isPlayer;
    this.sustainLength = sustainLength;
    this.hit = false;
    this.missed = false;
    this.y = -9999;
  }

  /**
   * Resets note back into dormant pool state.
   */
  kill() {
    this.active = false;
  }
}

export class NotePool {
  /**
   * @param {number} size - Maximum notes visible on-screen at any given millisecond (~128 is plenty)
   */
  constructor(size = 128) {
    this.size = size;
    this.pool = new Array(size);

    // Pre-allocate all memory once during loading
    for (let i = 0; i < size; i++) {
      this.pool[i] = new NoteVisual();
    }
  }

  /**
   * Grabs the first available inactive note from the pool.
   * @returns {NoteVisual|null}
   */
  obtain() {
    for (let i = 0; i < this.size; i++) {
      if (!this.pool[i].active) {
        return this.pool[i];
      }
    }
    // Emergency resize if chart is an extreme chord-spam stream
    console.warn("Note pool exhausted! Expanding by 32 slots.");
    const newNote = new NoteVisual();
    this.pool.push(newNote);
    this.size++;
    return newNote;
  }

  /**
   * Deactivates all active notes (used for song restarts or room changes).
   */
  clear() {
    for (let i = 0; i < this.size; i++) {
      this.pool[i].kill();
    }
  }

  /**
   * Runs a callback on every currently active note without creating new arrays.
   * @param {Function} callback 
   */
  forEachActive(callback) {
    for (let i = 0; i < this.size; i++) {
      if (this.pool[i].active) {
        callback(this.pool[i]);
      }
    }
  }
}
