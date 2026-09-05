// Meltdown — the ten cues, defined once and played from the frame loop.
//
// specs/audio.md fixes the ten names and the event each answers, and the rule
// that decides where they are played from: a cue is raised by the frame that
// RESOLVES its event, so a cue always names one real frame. That is why every
// cue in this build is played here, from `update`, off the flags a frame's own
// resolution raised — and why no operation of the debug surface plays one: a
// pose is `(state, ...) => state` and holds no `UpdateApi` at all.
//
// Every cue is synthesized from a `CueSpec`; the build ships no audio file.

import { CUES } from "./constants";
import type { FrameEvents } from "./sim";
import type { CueSpec, InitApi, UpdateApi } from "@clockwyrks/simple-2d";
import type { MeltdownState } from "./game";

const SPECS: Readonly<Record<string, CueSpec>> = {
  [CUES.fire]: {
    wave: "square",
    freq: 880,
    freqTo: 620,
    durationMs: 45,
    gain: 0.06,
  },
  [CUES.trip]: {
    wave: "sawtooth",
    freq: 180,
    freqTo: 60,
    durationMs: 420,
    gain: 0.2,
  },
  [CUES.death]: {
    wave: "triangle",
    freq: 320,
    freqTo: 120,
    durationMs: 110,
    gain: 0.12,
  },
  [CUES.leak]: {
    wave: "sawtooth",
    freq: 140,
    freqTo: 220,
    durationMs: 260,
    gain: 0.18,
  },
  [CUES.place]: {
    wave: "square",
    freq: 420,
    freqTo: 660,
    durationMs: 90,
    gain: 0.12,
  },
  [CUES.sell]: {
    wave: "square",
    freq: 660,
    freqTo: 300,
    durationMs: 110,
    gain: 0.12,
  },
  [CUES.waveClear]: {
    wave: "triangle",
    freq: 520,
    freqTo: 900,
    durationMs: 300,
    gain: 0.16,
  },
  [CUES.victory]: {
    wave: "sine",
    freq: 660,
    freqTo: 1320,
    durationMs: 700,
    gain: 0.2,
  },
  [CUES.gameOver]: {
    wave: "sine",
    freq: 300,
    freqTo: 90,
    durationMs: 800,
    gain: 0.2,
  },
  [CUES.menu]: { wave: "square", freq: 1040, durationMs: 35, gain: 0.07 },
};

/** Define all ten cues, once, when the game is initialized. */
export function defineCues(api: InitApi<MeltdownState>): void {
  for (const [cue, spec] of Object.entries(SPECS)) api.audio.define(cue, spec);
}

/** Play the cue for each event this frame resolved, one play per cue. */
export function playFrameEvents(api: UpdateApi, events: FrameEvents): void {
  if (events.fire) api.audio.play(CUES.fire);
  if (events.trip) api.audio.play(CUES.trip);
  if (events.death) api.audio.play(CUES.death);
  if (events.leak) api.audio.play(CUES.leak);
  if (events.place) api.audio.play(CUES.place);
  if (events.sell) api.audio.play(CUES.sell);
  if (events.waveClear) api.audio.play(CUES.waveClear);
  if (events.victory) api.audio.play(CUES.victory);
  if (events.gameOver) api.audio.play(CUES.gameOver);
  if (events.menu) api.audio.play(CUES.menu);
}
