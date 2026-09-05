// Volute — binding the fifteen cues (specs/ui.md "Audio", specs/assets.md).
//
// Every sound the game makes is a produced `.wav` under `public/assets/audio/`,
// bound to its cue name with the engine's `api.audio.load`. The engine owns the
// bus from there: `play` sounds a one-shot, `loop` and `stop` run the two beds,
// and muting and the first-gesture unlock are its as well.
//
// EACH NAME IS DECLARED BEFORE IT IS LOADED. `api.audio.load` binds a name only
// once the decode succeeds, and playing a name that was never declared throws —
// so a host with no audio decoding at all (a headless process, say) would
// otherwise take the whole update down the first time a shot was fired. Declaring
// a plain synthesized shape first means every cue is always playable: on a real
// page the produced file replaces it before the first frame, and where nothing
// can decode, the game runs and reports its cues exactly as it otherwise would.

import type { CueSpec, InitApi } from "@clockwyrks/simple-2d";
import { CUES } from "./constants";
import type { CueName } from "./constants";
import type { VoluteState } from "./game";

/**
 * The shape each cue falls back to where its produced file cannot be decoded.
 *
 * Each is a rough sketch of the file it stands in for — the five extraction steps
 * rise, the beds are low and level, the refusal does not move — so a host without
 * audio decoding still tells the events apart by ear.
 */
export const CUE_FALLBACKS: Readonly<Record<CueName, CueSpec>> = {
  [CUES.fire]: { wave: "square", freq: 1900, freqTo: 700, durationMs: 95 },
  [CUES.seat]: { wave: "triangle", freq: 300, freqTo: 210, durationMs: 150 },
  [CUES.swap]: { wave: "triangle", freq: 880, freqTo: 1330, durationMs: 75 },
  [CUES.denied]: { wave: "square", freq: 108, durationMs: 165, gain: 0.15 },
  [CUES.machinery]: { freq: 784, freqTo: 1568, durationMs: 380 },
  [CUES.extract1]: { freq: 440, durationMs: 300 },
  [CUES.extract2]: { freq: 523.25, durationMs: 300 },
  [CUES.extract3]: { freq: 587.33, durationMs: 300 },
  [CUES.extract4]: { freq: 698.46, durationMs: 300 },
  [CUES.extract5]: { freq: 880, durationMs: 300 },
  [CUES.intake]: { wave: "sawtooth", freq: 46, freqTo: 30, durationMs: 1250 },
  [CUES.levelClear]: { freq: 392, freqTo: 784, durationMs: 1210 },
  [CUES.cellLost]: { wave: "sawtooth", freq: 92, freqTo: 40, durationMs: 1010 },
  [CUES.hallLoop]: {
    wave: "triangle",
    freq: 73.42,
    durationMs: 13333,
    gain: 0.1,
  },
  [CUES.dangerLoop]: {
    wave: "sawtooth",
    freq: 77.78,
    durationMs: 8889,
    gain: 0.1,
  },
};

/** The produced file each cue plays, under the engine's asset root. */
export function cuePath(cue: CueName): string {
  return `audio/${cue}.wav`;
}

/**
 * Declare all fifteen cues and back each with its produced file, awaited.
 *
 * A load that fails leaves the name bound to its declared fallback, so every cue
 * the game plays is always a declared cue.
 */
export async function bindCues(
  api: Pick<InitApi<VoluteState>, "audio">,
): Promise<void> {
  const names = Object.values(CUES);
  for (const cue of names) api.audio.define(cue, CUE_FALLBACKS[cue]);
  await Promise.all(
    names.map((cue) =>
      api.audio.load(cue, cuePath(cue)).catch(() => undefined),
    ),
  );
}
