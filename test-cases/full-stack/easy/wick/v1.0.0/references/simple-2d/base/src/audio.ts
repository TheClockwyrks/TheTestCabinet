// Wick — audio, as engine cues (specs/ui.md "Audio", specs/assets.md "The
// sound").
//
// There is no audio graph here, no mute flag, and no unlock: the engine
// owns the context, the looping, the mute bit, and the first-gesture
// unlock. The game's part is to declare the fifteen cues `src/constants.ts`
// names, bind each to its produced file through the cue bus, play the
// one-shot cues by name as their events happen, and keep exactly the loops
// the state calls for running: the music on the run's screens and the hum
// while Halo or Corona is held on `playing`.
//
// Each name is declared twice, and the order matters. A synthesized shape is
// defined first, which cannot fail, and the produced `.wav` is then loaded
// over the same name, which replaces what the name plays. What the first
// declaration buys is that a file which fails to load leaves the game
// running: a name never declared throws when it is played.

import type { CueSpec, InitApi, UpdateApi } from "@test-cabinet/simple-2d";
import type { DeepReadonly } from "ts-essentials";
import { CUES, CUE_PATHS, LOOPING_CUES, type CueName } from "./constants";
import type { WickState } from "./game";
import { MUSIC_SCREENS } from "./flow";

/**
 * The shape each cue falls back to when its produced file is unavailable,
 * pitched the way the produced sounds are: warm and candlelit, `hit` and
 * `gem` short and light, `hurt` the one buzz, the endings the heaviest.
 */
export const CUE_FALLBACKS: Readonly<Record<CueName, CueSpec>> = {
  [CUES.hit]: { wave: "triangle", freq: 660, freqTo: 495, durationMs: 60 },
  [CUES.kill]: {
    wave: "sine",
    freq: 330,
    freqTo: 110,
    gain: 0.22,
    durationMs: 200,
  },
  [CUES.gem]: { wave: "sine", freq: 1320, freqTo: 1760, durationMs: 80 },
  [CUES.hurt]: {
    wave: "square",
    freq: 440,
    freqTo: 220,
    gain: 0.18,
    durationMs: 300,
  },
  [CUES.levelUp]: {
    wave: "triangle",
    freq: 587,
    freqTo: 1175,
    gain: 0.2,
    durationMs: 900,
  },
  [CUES.choose]: { wave: "triangle", freq: 784, freqTo: 1175, durationMs: 300 },
  [CUES.chest]: {
    wave: "sine",
    freq: 262,
    freqTo: 523,
    gain: 0.2,
    durationMs: 900,
  },
  [CUES.evolve]: {
    wave: "triangle",
    freq: 440,
    freqTo: 1760,
    gain: 0.2,
    durationMs: 1800,
  },
  [CUES.pickup]: { wave: "sine", freq: 523, freqTo: 659, durationMs: 150 },
  [CUES.fallen]: {
    wave: "sawtooth",
    freq: 220,
    freqTo: 55,
    gain: 0.22,
    durationMs: 3000,
  },
  [CUES.dawn]: {
    wave: "triangle",
    freq: 349,
    freqTo: 698,
    gain: 0.22,
    durationMs: 3000,
  },
  [CUES.menuMove]: { wave: "square", freq: 880, gain: 0.06, durationMs: 40 },
  [CUES.menuConfirm]: {
    wave: "square",
    freq: 659,
    freqTo: 988,
    gain: 0.1,
    durationMs: 200,
  },
  // A looped synthesized cue holds its wave at `freq`, so the loops fall
  // back to quiet drones under the cues rather than melodies.
  [CUES.music]: { wave: "sine", freq: 73.4, gain: 0.05, durationMs: 1000 },
  [CUES.hum]: { wave: "triangle", freq: 110, gain: 0.05, durationMs: 1000 },
};

/**
 * Declare every cue, once, before the first frame, and load the produced
 * file behind each over its name. A load that fails is caught: the name
 * keeps its synthesized shape, and the engine has already announced the
 * failure as an `asset:failed` event.
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

/** The looping cues `state` calls for on this frame. */
export function wantedLoops(state: DeepReadonly<WickState>): CueName[] {
  const wanted: CueName[] = [];
  if (MUSIC_SCREENS.includes(state.screen)) wanted.push(CUES.music);
  if (
    state.screen === "playing" &&
    state.run.weapons.some(
      (weapon) => weapon.id === "halo" || weapon.id === "corona",
    )
  ) {
    wanted.push(CUES.hum);
  }
  return wanted;
}

/**
 * Keep exactly the loops the state calls for running. Reconciled every
 * frame rather than switched at the transitions, because a screen can also
 * be entered through the debug surface; the engine makes `loop` and `stop`
 * idempotent, so a frame that changes nothing loops and stops nothing.
 */
export function syncLoops(
  api: Pick<UpdateApi, "audio">,
  state: DeepReadonly<WickState>,
): void {
  const wanted = wantedLoops(state);
  for (const cue of LOOPING_CUES) {
    const looping = api.audio.looping(cue);
    if (wanted.includes(cue) && !looping) api.audio.loop(cue);
    else if (!wanted.includes(cue) && looping) api.audio.stop(cue);
  }
}
