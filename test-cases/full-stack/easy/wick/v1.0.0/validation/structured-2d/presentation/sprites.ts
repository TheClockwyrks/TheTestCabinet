// presentation/sprites — how one frame's bitmaps are attributed to the things
// they were drawn on, and which produced files each thing may draw from.
//
// NOT a check: a module of readings, so the suites in this directory name what
// they mean rather than spelling the same filter again. Nothing here decides
// an outcome and nothing here reads the reference.
//
// WHY A BLIT IS ATTRIBUTED BY ITS CENTRE. `specs/assets.md`: every sprite is
// "drawn centered on the thing it depicts", and `specs/world.md` puts a world
// point at stage `(wx − player.x + STAGE_CX, wy − player.y + STAGE_CY)`. So the
// bitmap drawn FOR an object is the one whose centre landed on that object's
// own stage point, and a bitmap covering the whole view — the ground tiles, a
// full-stage wash — is centred somewhere else and never attributes to an
// object.
//
// WHY THE FILE IS PART OF THE READING. This project serves the build's own
// `assets/` tree to the engine's loader, so a blit carries the produced file
// its bytes came from. `specs/assets.md` fixes one path per sprite and one
// directory per sheet, so "the moth's sheet" is a set of file names known
// before any build exists, and a reading that names the set can say a thing
// was drawn from ITS OWN file rather than from something else that happened to
// land there.

import {
  ENEMY_FRAMES,
  EFFECT_SPRITES,
  LAMPLIGHTER_IDLE_PATH,
  LAMPLIGHTER_WALK_SHEET,
  PUFF_SHEET,
  assetFile,
  enemyFrame,
  sheetFrame,
  type EnemyId,
  type WeaponId,
} from "../constants";
import {
  blitCenter,
  blitsNear,
  producedBytes,
  type Blit,
  type Harness,
} from "../harness";

/**
 * How far a sprite's centre may sit from the point of the thing it is drawn
 * on, in device pixels.
 *
 * Every suite here opens its harness at the stage's own `1280 x 720`, where
 * the engine's fit is the identity and one device pixel is one stage unit, so
 * a build that draws a sprite centred on its object lands at zero distance and
 * a build that rounds its destination rectangle to whole pixels lands within
 * half a unit. Two units takes that rounding and nothing else: every scenario
 * in this directory poses the things it reads at least twenty units apart, so
 * no sprite can be claimed by its neighbour.
 */
export const SPRITE_TOL = 2;

/**
 * How far a drawn extent may sit from the extent the specification gives it,
 * in stage units. The same rounding as above, on each of the two edges the
 * width spans, so twice the centre's slack.
 */
export const EXTENT_TOL = 4;

/**
 * How far a sprite drawn at its NATIVE size may sit from the canvas
 * `specs/assets.md` produces it on, in stage units.
 *
 * A build that lands its destination rectangle on whole device pixels moves
 * each of the two edges an extent spans by at most half a unit, so a
 * conformant draw is within one; two is that with room to spare, and it is far
 * under the smallest wrong size a build could reach — a scale of one and a
 * quarter puts the `16 x 16` large gem four units out.
 */
export const NATIVE_TOL = 2;

/** A blit's centre in logical STAGE units, past the engine's fit. */
export function stageCenterOf(
  h: Harness,
  blit: Blit,
): { x: number; y: number } {
  const view = h.viewport();
  const centre = blitCenter(blit);
  return {
    x: (centre.x - view.offsetX) / view.scale,
    y: (centre.y - view.offsetY) / view.scale,
  };
}

/** A blit's box in logical STAGE units, past the engine's fit. */
export function stageBoxOf(
  h: Harness,
  blit: Blit,
): { x: number; y: number; w: number; h: number } {
  const view = h.viewport();
  return {
    x: (blit.x - view.offsetX) / view.scale,
    y: (blit.y - view.offsetY) / view.scale,
    w: blit.w / view.scale,
    h: blit.h / view.scale,
  };
}

/** The idle sprite and the six walk frames: every file the lamplighter draws from. */
export const LAMPLIGHTER_FILES: readonly string[] = [
  assetFile(LAMPLIGHTER_IDLE_PATH),
  ...walkFiles(),
];

/** The six produced walk frames, frame `i` at index `i`. */
export function walkFiles(): string[] {
  return Array.from({ length: LAMPLIGHTER_WALK_SHEET.frames }, (_, frame) =>
    assetFile(sheetFrame(LAMPLIGHTER_WALK_SHEET.dir, frame)),
  );
}

/** Enemy `id`'s four produced sheet frames, frame `i` at index `i`. */
export function enemyFiles(id: EnemyId): string[] {
  return Array.from({ length: ENEMY_FRAMES }, (_, frame) =>
    assetFile(enemyFrame(id, frame)),
  );
}

/** The death puff's four produced frames, frame `i` at index `i`. */
export function puffFiles(): string[] {
  return Array.from({ length: PUFF_SHEET.frames }, (_, frame) =>
    assetFile(sheetFrame(PUFF_SHEET.dir, frame)),
  );
}

/**
 * Every produced file weapon `id`'s effect may draw from: its one sprite, or
 * every frame of its sheet, as `EFFECT_SPRITES` records it
 * (`specs/assets.md`, "The weapon effects").
 */
export function effectFiles(id: WeaponId): string[] {
  const sprite = EFFECT_SPRITES[id];
  return sprite.frames === 1
    ? [assetFile(sprite.path)]
    : Array.from({ length: sprite.frames }, (_, frame) =>
        assetFile(sheetFrame(sprite.path, frame)),
      );
}

/**
 * The blits drawn from one of `files` and centred on the WORLD point `(x, y)`,
 * in the order the frame issued them.
 */
export function drawnFrom(
  h: Harness,
  blits: readonly Blit[],
  files: readonly string[],
  x: number,
  y: number,
  tolerance: number = SPRITE_TOL,
): Blit[] {
  return blitsNear(h, blits, x, y, tolerance).filter((blit) =>
    files.includes(blit.id),
  );
}

/**
 * Every frame of `files` whose produced file holds the same bytes as `id`.
 *
 * WHY A SET RATHER THAN ONE NUMBER. `specs/assets.md` fixes a sheet's frame
 * count and nothing about whether two of its frames are the same picture, and
 * a walk cycle that returns to a pose is ordinary art: a six-frame cycle whose
 * second and fifth frames are one drawing ships two identical PNGs. Nothing on
 * the canvas can then tell "frame 1" from "frame 4", because they ARE the same
 * picture, and a reading that claimed to would be deciding a build's art rather
 * than its animation. So the reading answers every frame the drawn picture
 * could be, and a suite asserts that the frame the specification owes is among
 * them: a build whose frames differ is held to the exact number, and a build
 * that drew one of two identical frames is held to the picture it owed.
 */
export function framesOf(files: readonly string[], id: string): number[] {
  const drawn = producedBytes(id);
  if (drawn === null) return [];
  return files.flatMap((file, frame) => {
    const bytes = producedBytes(file);
    return bytes !== null && bytes.equals(drawn) ? [frame] : [];
  });
}

/**
 * Which frame of `files` was drawn on the world point `(x, y)`, as every frame
 * the drawn picture could be, or `null` when none of them was drawn there. The
 * LAST such blit, because that is the one a player sees.
 */
export function framesAt(
  h: Harness,
  blits: readonly Blit[],
  files: readonly string[],
  x: number,
  y: number,
  tolerance: number = SPRITE_TOL,
): number[] | null {
  const found = drawnFrom(h, blits, files, x, y, tolerance);
  if (found.length === 0) return null;
  return framesOf(files, found[found.length - 1].id);
}

/**
 * The LAST blit drawn from one of `files` and centred on the WORLD point
 * `(x, y)`, or `null` when none was: the one a player sees there.
 */
export function lastDrawnFrom(
  h: Harness,
  blits: readonly Blit[],
  files: readonly string[],
  x: number,
  y: number,
  tolerance: number = SPRITE_TOL,
): Blit | null {
  const found = drawnFrom(h, blits, files, x, y, tolerance);
  return found.length === 0 ? null : found[found.length - 1];
}
