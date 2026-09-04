// Kessler — audio, as engine cues (specs/assets.md "The sound").
//
// There is no Web Audio graph here, no mute flag, and no autoplay unlock: the
// engine owns the context, the looping, and the first-gesture unlock. The
// game's whole part is to DECLARE the thirteen cues and the two music beds
// `src/constants.ts` names, bind each to its produced file through the cue
// bus, play the cues by name as their events happen, and keep exactly the
// screen's bed looping: the title bed on `title` and `howto`, the play bed on
// `playing`, `waveclear`, and `paused`, and none on `gameover`, so the
// `game-over` cue rings out over silence.
//
// Each name is DECLARED TWICE, and the order matters. A synthesized shape is
// defined first, which cannot fail, and the produced `.wav` is then loaded
// over the same name, which replaces what that name plays. The produced files
// are what a player hears. What the first declaration buys is the requirement
// that audio which fails to load leaves the game running: a name that was
// never declared throws when it is played, so a build that declared nothing
// until a fetch resolved would fall over on a host that could not reach its
// files instead of carrying on, quieter, exactly as specified.

import type { CueSpec, InitApi, UpdateApi } from "@test-cabinet/simple-2d";
import { BED_PATHS, CUES, CUE_PATHS, type CueName } from "./constants";
import type { ScreenName } from "./figures";

/**
 * The shape each cue falls back to when its produced file is unavailable,
 * pitched the way the produced sounds are (`specs/assets.md`, "The sound
 * bar"): cold and glassy, the break clearly apart from the hit, the narrow
 * catch sour where the catch is bright, and the game-over the heaviest sound
 * in the game.
 */
export const CUE_FALLBACKS: Readonly<Record<CueName, CueSpec>> = {
  [CUES.paddleBounce]: {
    wave: "triangle",
    freq: 520,
    freqTo: 780,
    gain: 0.18,
    durationMs: 90,
  },
  [CUES.fieldBounce]: {
    wave: "sine",
    freq: 180,
    freqTo: 120,
    gain: 0.2,
    durationMs: 200,
  },
  [CUES.targetHit]: {
    wave: "square",
    freq: 300,
    freqTo: 240,
    gain: 0.12,
    durationMs: 110,
  },
  [CUES.targetBreak]: {
    wave: "sawtooth",
    freq: 640,
    freqTo: 140,
    gain: 0.2,
    durationMs: 420,
  },
  [CUES.shieldReflect]: {
    wave: "sawtooth",
    freq: 900,
    freqTo: 260,
    gain: 0.16,
    durationMs: 260,
  },
  [CUES.podCatch]: {
    wave: "triangle",
    freq: 660,
    freqTo: 990,
    gain: 0.16,
    durationMs: 240,
  },
  [CUES.podCatchNarrow]: {
    wave: "triangle",
    freq: 440,
    freqTo: 311,
    gain: 0.16,
    durationMs: 300,
  },
  [CUES.podBurn]: {
    wave: "sine",
    freq: 520,
    freqTo: 90,
    gain: 0.12,
    durationMs: 380,
  },
  [CUES.ballLost]: {
    wave: "sine",
    freq: 340,
    freqTo: 60,
    gain: 0.2,
    durationMs: 600,
  },
  [CUES.waveClear]: {
    wave: "triangle",
    freq: 523,
    freqTo: 1046,
    gain: 0.18,
    durationMs: 700,
  },
  [CUES.gameOver]: {
    wave: "sawtooth",
    freq: 220,
    freqTo: 40,
    gain: 0.22,
    durationMs: 2400,
  },
  [CUES.menuMove]: {
    wave: "square",
    freq: 880,
    freqTo: 990,
    gain: 0.08,
    durationMs: 45,
  },
  [CUES.menuSelect]: {
    wave: "square",
    freq: 660,
    freqTo: 880,
    gain: 0.12,
    durationMs: 140,
  },
};

/** The two music beds, named for their produced files. */
export const BED_NAMES = {
  title: "music-title",
  play: "music-play",
} as const;

/** One looping bed's cue name. */
export type BedName = (typeof BED_NAMES)[keyof typeof BED_NAMES];

/**
 * The bed fallbacks: a looped synthesized cue holds its wave at `freq`, so
 * each is a quiet drone under the cues rather than a melody.
 */
const BED_FALLBACKS: Readonly<Record<BedName, CueSpec>> = {
  [BED_NAMES.title]: { wave: "sine", freq: 110, gain: 0.05, durationMs: 1000 },
  [BED_NAMES.play]: {
    wave: "triangle",
    freq: 82.4,
    gain: 0.05,
    durationMs: 1000,
  },
};

/**
 * Declare every cue and bed, once, before the first frame, and load the
 * produced file behind each over its name. A load that fails is caught: the
 * name keeps its synthesized shape, the game stays fully playable, and the
 * engine has already announced the failure as an `asset:failed` event.
 */
export async function defineCues(api: Pick<InitApi, "audio">): Promise<void> {
  for (const [cue, spec] of Object.entries(CUE_FALLBACKS)) {
    api.audio.define(cue, spec);
  }
  for (const [bed, spec] of Object.entries(BED_FALLBACKS)) {
    api.audio.define(bed, spec);
  }
  await Promise.all([
    ...(Object.keys(CUE_PATHS) as CueName[]).map((cue) =>
      api.audio.load(cue, CUE_PATHS[cue]).catch(() => undefined),
    ),
    api.audio.load(BED_NAMES.title, BED_PATHS.title).catch(() => undefined),
    api.audio.load(BED_NAMES.play, BED_PATHS.play).catch(() => undefined),
  ]);
}

/** The bed `screen` runs, or `null` for the screen that plays none. */
export function bedForScreen(screen: ScreenName): BedName | null {
  switch (screen) {
    case "title":
    case "howto":
      return BED_NAMES.title;
    case "playing":
    case "waveclear":
    case "paused":
      return BED_NAMES.play;
    case "gameover":
      return null;
  }
}

/**
 * Keep exactly the screen's bed looping. Reconciled every frame rather than
 * switched at the transitions, because a screen can also be entered through
 * the debug surface; the engine makes `loop` and `stop` idempotent, so a
 * frame that changes nothing loops and stops nothing. Confirming QUIT
 * therefore stops the play bed and the title bed resumes (`specs/assets.md`).
 */
export function syncBeds(
  api: Pick<UpdateApi, "audio">,
  screen: ScreenName,
): void {
  const want = bedForScreen(screen);
  for (const bed of Object.values(BED_NAMES)) {
    if (bed !== want && api.audio.looping(bed)) api.audio.stop(bed);
  }
  if (want !== null && !api.audio.looping(want)) api.audio.loop(want);
}
