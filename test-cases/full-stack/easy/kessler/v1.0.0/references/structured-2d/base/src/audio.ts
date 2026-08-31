// Kessler — audio, as engine cues (specs/assets.md "The sound").
//
// There is no Web Audio graph here, no mute flag, and no autoplay unlock: the
// engine owns the context, the looping, and the first-gesture unlock. The
// game's whole part is to DECLARE the thirteen cues and the two music beds
// over the produced files, once, from the instance's `initialize`, and then
// play each cue BY NAME on the world's cue bus on the tick its event
// resolves, and keep the right bed looping for the screen the game is on.
//
// Each name is DECLARED TWICE, and the order matters. A synthesized shape is
// defined first, which cannot fail, and the produced `.wav` `specs/assets.md`
// fixes is then loaded over the same name, which replaces what that name
// plays. The produced files are what a player hears. What the first
// declaration buys is the requirement that audio which fails to load leaves
// the game running: the engine throws on a cue name that was never declared,
// so a build that declared nothing until a fetch resolved would fall over on
// a host that could not reach its files instead of carrying on, quieter,
// exactly as specified.

import {
  BED_PATHS,
  CUES,
  CUE_PATHS,
  type CueName,
  type Screen,
} from "./constants";
import type { CueSpec, InitApi, WorldAudio } from "@test-cabinet/structured-2d";

/** The two music beds, by the cue name each loops under. */
export const BED_CUES = {
  title: "music-title",
  play: "music-play",
} as const;

type BedCue = (typeof BED_CUES)[keyof typeof BED_CUES];

/**
 * The shape each cue falls back to when its produced file is unavailable,
 * pitched the way the produced palette is (`specs/assets.md`, "The sound
 * bar"): cold and glassy, the break clearly heavier than the hit, the narrow
 * catch souring downward where the ordinary catch rises, and the game-over
 * the longest and lowest sound of the set.
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
    freq: 150,
    freqTo: 95,
    gain: 0.2,
    durationMs: 220,
  },
  [CUES.targetHit]: {
    wave: "square",
    freq: 320,
    freqTo: 250,
    gain: 0.14,
    durationMs: 110,
  },
  [CUES.targetBreak]: {
    wave: "sawtooth",
    freq: 620,
    freqTo: 140,
    gain: 0.2,
    durationMs: 420,
  },
  [CUES.shieldReflect]: {
    wave: "sawtooth",
    freq: 900,
    freqTo: 260,
    gain: 0.18,
    durationMs: 260,
  },
  [CUES.podCatch]: {
    wave: "triangle",
    freq: 660,
    freqTo: 880,
    gain: 0.18,
    durationMs: 220,
  },
  [CUES.podCatchNarrow]: {
    wave: "triangle",
    freq: 440,
    freqTo: 311,
    gain: 0.18,
    durationMs: 300,
  },
  [CUES.podBurn]: {
    wave: "sine",
    freq: 420,
    freqTo: 120,
    gain: 0.14,
    durationMs: 320,
  },
  [CUES.ballLost]: {
    wave: "sine",
    freq: 300,
    freqTo: 70,
    gain: 0.22,
    durationMs: 550,
  },
  [CUES.waveClear]: {
    wave: "triangle",
    freq: 520,
    freqTo: 1180,
    gain: 0.2,
    durationMs: 700,
  },
  [CUES.gameOver]: {
    wave: "sawtooth",
    freq: 220,
    freqTo: 45,
    gain: 0.24,
    durationMs: 2400,
  },
  [CUES.menuMove]: {
    wave: "square",
    freq: 880,
    gain: 0.08,
    durationMs: 40,
  },
  [CUES.menuSelect]: {
    wave: "triangle",
    freq: 660,
    freqTo: 990,
    gain: 0.12,
    durationMs: 140,
  },
};

/** The quiet held pad each bed falls back to, well under the cues. */
const BED_FALLBACKS: Readonly<Record<BedCue, CueSpec>> = {
  [BED_CUES.title]: { wave: "sine", freq: 110, gain: 0.05, durationMs: 1000 },
  [BED_CUES.play]: { wave: "triangle", freq: 82, gain: 0.05, durationMs: 1000 },
};

/**
 * Declare every cue and both beds, once, before the start level opens, and
 * load the produced file behind each over it.
 *
 * A load that fails is caught rather than thrown: the name keeps the shape
 * its fallback gave it, the game stays fully playable, and the engine has
 * already announced the failure as an `asset:failed` event for anyone
 * watching.
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
    api.audio.load(BED_CUES.title, BED_PATHS.title).catch(() => undefined),
    api.audio.load(BED_CUES.play, BED_PATHS.play).catch(() => undefined),
  ]);
}

/** The bed `screen` runs, or `null` for the screen that plays none. */
export function bedForScreen(screen: Screen): BedCue | null {
  switch (screen) {
    case "title":
    case "howto":
      return BED_CUES.title;
    case "playing":
    case "waveclear":
    case "paused":
      return BED_CUES.play;
    case "gameover":
      return null;
  }
}

/**
 * Keep exactly the screen's bed looping — the title bed on `title` and
 * `howto`, the play bed on `playing`, `waveclear`, and `paused`, and none on
 * `gameover`, so the `game-over` cue rings out over silence
 * (`specs/assets.md`). Reconciled every frame from the game mode's tick:
 * `loop` and `stop` are idempotent on the engine's bus, so confirming QUIT
 * stops the play bed and resumes the title bed on the frame the screen
 * changes, however the screen changed.
 */
export function syncBeds(screen: Screen, audio: WorldAudio): void {
  const wanted = bedForScreen(screen);
  for (const bed of Object.values(BED_CUES)) {
    if (bed === wanted) audio.loop(bed);
    else if (audio.looping(bed)) audio.stop(bed);
  }
}
