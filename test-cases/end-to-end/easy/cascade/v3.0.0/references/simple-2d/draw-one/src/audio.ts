// Cascade — the ten cues (specs/audio.md).
//
// Each cue is a short synthesized sound the engine's audio bus owns, defined
// once in `initialize` and played by name from `update`. Muting is the engine's
// as well: the HUD's `SOUND` control flips the game's own copy of the bit and
// `update` pushes it to the bus, so what the snapshot reports and what the
// player hears cannot drift apart.

import { CUES, type CueName } from "./constants";
import type { CueSpec, InitApi, UpdateApi } from "@clockwyrks/simple-2d";

/** What each of the ten cues sounds like, so the events are told apart by ear. */
const SPECS: Readonly<Record<CueName, CueSpec>> = {
  [CUES.deal]: { wave: "triangle", freq: 220, freqTo: 320, durationMs: 140 },
  [CUES.turn]: { wave: "triangle", freq: 520, freqTo: 380, durationMs: 70 },
  [CUES.recycle]: { wave: "sine", freq: 180, freqTo: 420, durationMs: 220 },
  [CUES.lift]: { wave: "sine", freq: 640, freqTo: 720, durationMs: 50 },
  [CUES.drop]: { wave: "sine", freq: 300, freqTo: 220, durationMs: 90 },
  [CUES.reject]: { wave: "square", freq: 180, freqTo: 120, durationMs: 130 },
  [CUES.flip]: { wave: "triangle", freq: 440, freqTo: 660, durationMs: 60 },
  [CUES.home]: { wave: "sine", freq: 720, freqTo: 980, durationMs: 130 },
  [CUES.launch]: { wave: "sawtooth", freq: 300, freqTo: 900, durationMs: 90 },
  [CUES.win]: { wave: "square", freq: 520, freqTo: 1040, durationMs: 420 },
};

/** Define every cue, once, before any frame runs. */
export function defineCues(api: Pick<InitApi, "audio">): void {
  for (const cue of Object.keys(SPECS) as CueName[]) {
    api.audio.define(cue, SPECS[cue]);
  }
}

/**
 * Play each cue the frame raised, once, however many times the frame raised it.
 */
export function playCues(
  api: Pick<UpdateApi, "audio">,
  cues: readonly CueName[],
): void {
  const played = new Set<CueName>();
  for (const cue of cues) {
    if (played.has(cue)) continue;
    played.add(cue);
    api.audio.play(cue);
  }
}
