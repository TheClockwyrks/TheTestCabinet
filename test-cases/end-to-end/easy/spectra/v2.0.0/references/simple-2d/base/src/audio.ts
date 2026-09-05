// Spectra — the nine cues (`specs/ui.md`).
//
// Every cue is DEFINED once, in `initialize`, and PLAYED by name from `update`.
// The engine owns the audio graph, the mute bit and the first-gesture unlock, so
// nothing here reaches for a Web Audio node.
//
// Each of the nine is a distinct short sound, so a player tells the events apart
// by ear: the cannon is a clipped downward blip, a flip a quick upward sweep, an
// absorb a soft rise, a kill a bright fall, the discharge a long sweep down, the
// inversion a slow sweep up, a hit a low fall, a stage clear a bright rising
// chime, and a menu move the shortest tick of the nine.

import { CUES } from "./constants";
import type { CueSpec, InitApi } from "@clockwyrks/simple-2d";

/** Every cue, under the name `CUES` gives it. */
const SPECS: Readonly<Record<string, CueSpec>> = {
  [CUES.fire]: {
    wave: "square",
    freq: 720,
    freqTo: 420,
    durationMs: 70,
    gain: 0.1,
  },
  [CUES.flip]: {
    wave: "triangle",
    freq: 380,
    freqTo: 760,
    durationMs: 90,
    gain: 0.14,
  },
  [CUES.absorb]: {
    wave: "sine",
    freq: 300,
    freqTo: 620,
    durationMs: 140,
    gain: 0.16,
  },
  [CUES.kill]: {
    wave: "square",
    freq: 900,
    freqTo: 240,
    durationMs: 120,
    gain: 0.12,
  },
  [CUES.discharge]: {
    wave: "sawtooth",
    freq: 640,
    freqTo: 90,
    durationMs: 420,
    gain: 0.18,
  },
  [CUES.inversion]: {
    wave: "sine",
    freq: 180,
    freqTo: 900,
    durationMs: 520,
    gain: 0.16,
  },
  [CUES.hit]: {
    wave: "sawtooth",
    freq: 320,
    freqTo: 70,
    durationMs: 320,
    gain: 0.2,
  },
  [CUES.stageClear]: {
    wave: "triangle",
    freq: 520,
    freqTo: 1040,
    durationMs: 380,
    gain: 0.16,
  },
  [CUES.menu]: { wave: "square", freq: 620, durationMs: 40, gain: 0.08 },
};

/** Define all nine, so playing any of them by name is a defined call. */
export function defineCues(api: Pick<InitApi, "audio">): void {
  for (const [cue, spec] of Object.entries(SPECS)) {
    api.audio.define(cue, spec);
  }
}
