// Wick — audio, as engine cues (specs/ui.md "Audio", specs/assets.md "The
// sound").
//
// There is no Web Audio graph here, no mute flag, and no autoplay unlock: the
// engine owns the context, the looping, the mute bit, and the first-gesture
// unlock. The game's whole part is to declare the fifteen cues over the
// produced files, once, from the instance's `initialize`, play each by name
// on the world's cue bus from the tick its event resolves, and keep the two
// loops running exactly while the state calls for them.
//
// Each name is declared twice, and the order matters. A synthesized shape is
// defined first, which cannot fail, and the produced `.wav` `specs/assets.md`
// fixes is then loaded over the same name, which replaces what that name
// plays. The produced files are what a player hears. What the first
// declaration buys is the requirement that a sound which fails to load leaves
// the game running: the engine throws on a cue name that was never declared,
// so a build that declared nothing until a fetch resolved would fall over on
// a host that could not reach its files instead of carrying on, quieter,
// exactly as specified.

import type { CueSpec, InitApi, WorldAudio } from "@clockwyrks/structured-2d";
import { CUES, CUE_PATHS, LOOPING_CUES, type CueName } from "./constants";
import { wantedLoops } from "./flow";
import type { WickState } from "./state";

/**
 * The shape each cue falls back to when its produced file is unavailable,
 * pitched the way the produced palette is: warm and candlelit, `hit` and
 * `gem` short and light, `kill` above `hit`, `hurt` the one buzz, `fallen`
 * dark and `dawn` bright, and the two loops quiet held tones.
 */
export const CUE_FALLBACKS: Readonly<Record<CueName, CueSpec>> = {
  [CUES.hit]: {
    wave: "triangle",
    freq: 660,
    freqTo: 495,
    gain: 0.1,
    durationMs: 60,
  },
  [CUES.kill]: {
    wave: "sine",
    freq: 220,
    freqTo: 90,
    gain: 0.18,
    durationMs: 200,
  },
  [CUES.gem]: {
    wave: "sine",
    freq: 1320,
    freqTo: 1760,
    gain: 0.08,
    durationMs: 80,
  },
  [CUES.hurt]: {
    wave: "square",
    freq: 330,
    freqTo: 165,
    gain: 0.16,
    durationMs: 300,
  },
  [CUES.levelUp]: {
    wave: "triangle",
    freq: 587,
    freqTo: 1175,
    gain: 0.16,
    durationMs: 900,
  },
  [CUES.choose]: {
    wave: "triangle",
    freq: 784,
    freqTo: 1175,
    gain: 0.14,
    durationMs: 300,
  },
  [CUES.chest]: {
    wave: "sine",
    freq: 392,
    freqTo: 784,
    gain: 0.16,
    durationMs: 900,
  },
  [CUES.evolve]: {
    wave: "triangle",
    freq: 440,
    freqTo: 1760,
    gain: 0.18,
    durationMs: 1800,
  },
  [CUES.pickup]: {
    wave: "sine",
    freq: 523,
    freqTo: 659,
    gain: 0.12,
    durationMs: 150,
  },
  [CUES.fallen]: {
    wave: "sawtooth",
    freq: 220,
    freqTo: 55,
    gain: 0.2,
    durationMs: 2600,
  },
  [CUES.dawn]: {
    wave: "triangle",
    freq: 349,
    freqTo: 698,
    gain: 0.2,
    durationMs: 3000,
  },
  [CUES.menuMove]: { wave: "square", freq: 880, gain: 0.06, durationMs: 40 },
  [CUES.menuConfirm]: {
    wave: "triangle",
    freq: 659,
    freqTo: 988,
    gain: 0.12,
    durationMs: 220,
  },
  [CUES.music]: { wave: "sine", freq: 73, gain: 0.05, durationMs: 1000 },
  [CUES.hum]: { wave: "triangle", freq: 110, gain: 0.04, durationMs: 1000 },
};

/**
 * Declare every cue, once, before the start level opens, and load the
 * produced file behind each over it. A load that fails is caught rather than
 * thrown: the name keeps the shape its fallback gave it, the game stays fully
 * playable, and the engine has already announced the failure as an
 * `asset:failed` event for anyone watching.
 */
export async function defineCues(api: Pick<InitApi, "audio">): Promise<void> {
  for (const cue of Object.values(CUES)) {
    api.audio.define(cue, CUE_FALLBACKS[cue]);
  }
  await Promise.all(
    Object.values(CUES).map((cue) =>
      api.audio.load(cue, CUE_PATHS[cue]).catch(() => undefined),
    ),
  );
}

/**
 * Keep exactly the loops the state calls for looping: the music on a run
 * screen, the hum while Halo or Corona is held on `playing`. Reconciled from
 * the state on every frame of the game mode's tick, so a state the debug
 * surface posed sounds, one frame later, exactly as the same state reached
 * by play; `loop` and `stop` are idempotent on the engine's bus.
 */
export function syncLoops(state: WickState, audio: WorldAudio): void {
  const wanted = wantedLoops(state);
  for (const cue of LOOPING_CUES) {
    if (wanted.includes(cue)) audio.loop(cue);
    else if (audio.looping(cue)) audio.stop(cue);
  }
}
