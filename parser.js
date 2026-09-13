/**
 * src/parser.js
 * In-Memory Chart Parser for "Stargazer" (nmv2 format)
 * Converts raw FNF section notes into a clean, flat, time-sorted timeline.
 */

export class ChartParser {
  /**
   * Parses the raw JSON object from normal.json.
   * @param {Object} rawJson 
   * @returns {Object} Parsed song data ready for the engine.
   */
  static parse(rawJson) {
    const songData = rawJson.song || rawJson;

    const parsedData = {
      songName: songData.song || "Stargazer",
      bpm: songData.bpm || 150,
      speed: songData.speed || 2.9,
      player1: songData.player1 || "bf",
      player2: songData.player2 || "LIMEGREENWEEKINVSIMPOSTOR",
      notes: [] // Flat time-sorted array
    };

    const sections = songData.notes || [];
    let noteIdCounter = 0;

    for (let s = 0; s < sections.length; s++) {
      const section = sections[s];
      const sectionNotes = section.sectionNotes || [];

      for (let n = 0; n < sectionNotes.length; n++) {
        const rawNote = sectionNotes[n];

        // Format: [strumTimeMs, rawLane, sustainLengthMs, ...]
        const strumTimeMs = rawNote[0];
        const rawLane = Math.floor(rawNote[1]);
        const sustainLengthMs = rawNote[2] || 0;

        // Skip invalid/corrupt data
        if (rawLane < 0 || rawLane > 7) continue;

        // In nmv2:
        // Lanes 0, 1, 2, 3 -> Boyfriend (isPlayer = true)
        // Lanes 4, 5, 6, 7 -> Limes (isPlayer = false)
        const isPlayer = rawLane < 4;
        const normalizedLane = rawLane % 4; // 0: Left, 1: Down, 2: Up, 3: Right

        parsedData.notes.push({
          id: noteIdCounter++,
          time: strumTimeMs / 1000,              // Convert ms to seconds
          lane: normalizedLane,                 // 0: Left, 1: Down, 2: Up, 3: Right
          rawLane: rawLane,
          isPlayer: isPlayer,                   // true = BF (Right), false = Limes (Left)
          sustainLength: Math.max(0, sustainLengthMs / 1000), // Sustain in seconds
          hit: false,
          missed: false
        });
      }
    }

    // Sort strictly by timestamp ascending so binary searching & streaming is instant
    parsedData.notes.sort((a, b) => a.time - b.time);

    return parsedData;
  }
}
