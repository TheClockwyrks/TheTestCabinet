// Orrery — every file this build produces, at the path and the canvas
// `specs/assets.md` fixes. CASE-PROVIDED, and the SAME FILE in all three engine
// projects.
//
// `src/constants.ts` names every path RELATIVE TO THE ASSET ROOT, because that is
// what a build hands the loader. A check about a produced file reads the file off
// the workspace instead, so what it needs is the same path with `assets/` in front
// of it — and that is the whole of the difference between this table and the
// constants it is built from. Nothing here restates a path; every entry is derived
// from `../constants`, so a figure cannot drift between what the build is told and
// what the check reads.
//
// THE TABLE IS COMPLETE ON PURPOSE. `specs/assets.md` closes with "Everything the
// game shows and plays traces to a file produced here or to the chrome drawn in
// code", and {@link PRODUCED_SPRITES} is the "produced here" half: fifty-seven
// stills and sheet frames, three particle systems, six cues, a bed and its score.

import {
  APERTURE_FRAMES,
  APERTURE_SHEETS,
  APERTURE_SPRITE_SIZE,
  CUE_PATHS,
  FILAMENT_SPRITE_H,
  FILAMENT_SPRITE_PATHS,
  FILAMENT_SPRITE_W,
  FIXTURE_MOUNT_PATH,
  GRIPPER_PATHS,
  GRIPPER_SPRITE_SIZE,
  HUB_PATHS,
  HUB_SPRITE_SIZE,
  INSTRUCTIONS,
  INSTRUCTION_GLYPH_PATHS,
  INSTRUCTION_GLYPH_SIZE,
  MOTES,
  MOTE_SPRITE_PATHS,
  MOTE_SPRITE_SIZE,
  MUSIC_SCORE_PATH,
  PARTICLE_PATHS,
  SIGIL_GLYPH_PATHS,
  SIGIL_GLYPH_SIZE,
  TRANSFORMING_SIGILS,
  WHEEL_HUB_PATH,
  WHEEL_SPRITE_SIZE,
  type CueName,
} from "../constants";

/** A produced path, as a check addresses it: relative to the repository root. */
export function assetFile(path: string): string {
  return `assets/${path}`;
}

/** One produced sprite: where it is, what it depicts, and the canvas it is on. */
export interface ProducedSprite {
  /** A short name for a failure message, so one sweep tells its cases apart. */
  label: string;
  /** The file, relative to the repository root. */
  file: string;
  /** The canvas `specs/assets.md` states for it, in pixels. */
  width: number;
  height: number;
  /** Which table of `specs/assets.md` the row comes from. */
  group:
    | "motes"
    | "filaments"
    | "sigils"
    | "instructions"
    | "hubs"
    | "grippers"
    | "wheel"
    | "apertures";
}

/** The fifteen mote sprites, in `MOTES` order, on a `44 x 44` canvas. */
export const MOTE_SPRITES: readonly ProducedSprite[] = MOTES.map((type) => ({
  label: `mote ${type}`,
  file: assetFile(MOTE_SPRITE_PATHS[type]),
  width: MOTE_SPRITE_SIZE,
  height: MOTE_SPRITE_SIZE,
  group: "motes",
}));

/** The two filament strips, on a `48 x 16` canvas. */
export const FILAMENT_SPRITES: readonly ProducedSprite[] = (
  ["plain", "triune"] as const
).map((weight) => ({
  label: `filament ${weight}`,
  file: assetFile(FILAMENT_SPRITE_PATHS[weight]),
  width: FILAMENT_SPRITE_W,
  height: FILAMENT_SPRITE_H,
  group: "filaments",
}));

/** The twelve transforming sigils' glyphs, on a `48 x 48` canvas. */
export const SIGIL_SPRITES: readonly ProducedSprite[] = TRANSFORMING_SIGILS.map(
  (kind) => ({
    label: `sigil ${kind}`,
    file: assetFile(SIGIL_GLYPH_PATHS[kind]),
    width: SIGIL_GLYPH_SIZE,
    height: SIGIL_GLYPH_SIZE,
    group: "sigils",
  }),
);

/** The ten instruction glyphs, on a `24 x 24` canvas — `TAPE_CELL_W` wide. */
export const INSTRUCTION_SPRITES: readonly ProducedSprite[] = INSTRUCTIONS.map(
  (name) => ({
    label: `instruction ${name}`,
    file: assetFile(INSTRUCTION_GLYPH_PATHS[name]),
    width: INSTRUCTION_GLYPH_SIZE,
    height: INSTRUCTION_GLYPH_SIZE,
    group: "instructions",
  }),
);

/** The two arm hubs, on a `40 x 40` canvas. */
export const HUB_SPRITES: readonly ProducedSprite[] = (
  ["arm", "piston"] as const
).map((kind) => ({
  label: `${kind} hub`,
  file: assetFile(HUB_PATHS[kind]),
  width: HUB_SPRITE_SIZE,
  height: HUB_SPRITE_SIZE,
  group: "hubs",
}));

/** The gripper in its two states, on a `32 x 32` canvas. */
export const GRIPPER_SPRITES: readonly ProducedSprite[] = (
  ["open", "closed"] as const
).map((state) => ({
  label: `gripper ${state}`,
  file: assetFile(GRIPPER_PATHS[state]),
  width: GRIPPER_SPRITE_SIZE,
  height: GRIPPER_SPRITE_SIZE,
  group: "grippers",
}));

/** The wheel hub and the fixture mount, sharing a `48 x 48` canvas. */
export const WHEEL_SPRITES: readonly ProducedSprite[] = [
  {
    label: "wheel hub",
    file: assetFile(WHEEL_HUB_PATH),
    width: WHEEL_SPRITE_SIZE,
    height: WHEEL_SPRITE_SIZE,
    group: "wheel",
  },
  {
    label: "fixture mount",
    file: assetFile(FIXTURE_MOUNT_PATH),
    width: WHEEL_SPRITE_SIZE,
    height: WHEEL_SPRITE_SIZE,
    group: "wheel",
  },
];

/** One aperture sheet's frames, numbered from `0`, on a `48 x 48` canvas. */
export function apertureFrames(
  sheet: "rise" | "set",
): readonly ProducedSprite[] {
  return Array.from({ length: APERTURE_FRAMES }, (_unused, frame) => ({
    label: `${sheet} aperture ${frame}`,
    file: assetFile(`${APERTURE_SHEETS[sheet]}/${frame}.png`),
    width: APERTURE_SPRITE_SIZE,
    height: APERTURE_SPRITE_SIZE,
    group: "apertures" as const,
  }));
}

/** The rise sheet's six frames, in frame order. */
export const RISE_SPRITES: readonly ProducedSprite[] = apertureFrames("rise");

/** The set sheet's six frames, in frame order. */
export const SET_SPRITES: readonly ProducedSprite[] = apertureFrames("set");

/**
 * Every produced sprite and sheet frame, in the order `specs/assets.md`
 * tabulates them: fifty-seven files.
 */
export const PRODUCED_SPRITES: readonly ProducedSprite[] = [
  ...MOTE_SPRITES,
  ...FILAMENT_SPRITES,
  ...SIGIL_SPRITES,
  ...INSTRUCTION_SPRITES,
  ...HUB_SPRITES,
  ...GRIPPER_SPRITES,
  ...WHEEL_SPRITES,
  ...RISE_SPRITES,
  ...SET_SPRITES,
];

/** The three produced particle systems, by the name `specs/assets.md` gives each. */
export const PARTICLE_FILES = {
  deliver: assetFile(PARTICLE_PATHS.deliver),
  fault: assetFile(PARTICLE_PATHS.fault),
  complete: assetFile(PARTICLE_PATHS.complete),
} as const;

/** The name of one produced particle system. */
export type ParticleName = keyof typeof PARTICLE_FILES;

/** The six ONE-SHOT cues, in the order `specs/assets.md` tabulates them. */
export const ONE_SHOT_CUES: readonly CueName[] = [
  "place",
  "erase",
  "start",
  "halt",
  "constellation",
  "complete",
];

/** Each one-shot cue's produced file, in cue order. */
export const CUE_FILES: readonly string[] = ONE_SHOT_CUES.map((cue) =>
  assetFile(CUE_PATHS[cue]),
);

/** The music bed's `.wav`, which is what the game plays. */
export const BED_FILE: string = assetFile(CUE_PATHS.music);

/** The music bed's portable score, committed beside the bed. */
export const SCORE_FILE: string = assetFile(MUSIC_SCORE_PATH);

/** Every produced audio file: the six cues, the bed, and the bed's score. */
export const AUDIO_FILES: readonly string[] = [
  ...CUE_FILES,
  BED_FILE,
  SCORE_FILE,
];
