// presentation/readouts — the readings this category's checks share.
//
// Every point here is decided from what one frame DREW, so the readings are all
// of the same shape: take the frame's image draws, keep the ones whose source is
// a produced file `specs/assets.md` names for the thing in question, and ask
// where that draw landed and how big it was drawn.
//
// WHY A DRAW'S SIZE IS READ AS A DIAGONAL. `specs/assets.md` leaves a
// projectile's orientation open — "A projectile's sprite is drawn centered on
// its circle, upright or turned to its velocity as you choose" — and a sprite
// turned through the transform reports a destination rectangle whose sides are
// the ROTATED ones, so `dw` alone is not the width a square sprite was drawn at.
// The diagonal of that rectangle is, because a rotation and a mirror both
// preserve a length: for a square drawn at `s` units it is `s * sqrt(2)` at every
// angle. So {@link squareSide} is what a check about a circular shape reads, and
// `dw` and `dh` are read directly only for the slash, whose rectangle
// `specs/weapons.md` fixes axis-aligned.
//
// The centre is read straight off the draw either way: a rotation about the
// sprite's own centre and a mirror across its vertical axis both leave the
// destination rectangle's centre where it was.

import {
  BLIT_TOL,
  EFFECT_SPRITES,
  ENEMIES,
  ENEMY_WALK_FRAMES,
  enemyFrame,
  type EnemyId,
  type WeaponId,
} from "../constants";
import { fail } from "../assert";
import {
  imageDraws,
  stagePoint,
  type DrawCall,
  type Harness,
  type ImageDraw,
  type WickSnapshot,
  type XY,
} from "../harness";
import { sourceIndex } from "./sources";

/** One image draw, with the index of the produced file it drew. */
export interface SourcedDraw {
  draw: ImageDraw;
  /** The index into the file list the draw was matched against. */
  index: number;
}

/**
 * The side a square sprite was drawn at, whatever rotation or mirror the build
 * put it under: the destination rectangle's diagonal over `sqrt(2)`.
 */
export function squareSide(draw: ImageDraw): number {
  return Math.hypot(draw.dw, draw.dh) / Math.SQRT2;
}

/** The distance from a draw's centre to a point. */
export function drawGap(draw: ImageDraw, at: XY): number {
  return Math.hypot(draw.cx - at.x, draw.cy - at.y);
}

/**
 * Which produced file each source is, remembered per page.
 *
 * A source's identity is fixed for the life of a page — "the same `<img>` drawn
 * on a hundred frames carries one id" — so a check that reads a hundred and
 * eighty consecutive frames asks the question once per sprite rather than once
 * per frame.
 */
const identified = new WeakMap<Harness, Map<string, number>>();

/**
 * Every draw of the frame whose source is one of `paths`, in draw order, with
 * the index of the file each drew.
 *
 * A source is matched as the file was produced first and REFLECTED second, in
 * that order, because `specs/assets.md` lets a build mirror a sprite either by
 * reflecting it as it blits or by producing a reflected copy of its own — "The
 * sprite faces the way `facing` says: produce one facing and mirror it in code,
 * or produce both", and an enemy's sprite "may be mirrored across its vertical
 * axis to face the sign of its heading's `x`". The upright pass runs first, so a
 * sheet whose frames happen to be reflections of one another is still indexed by
 * the file it actually drew.
 */
export async function drawsOf(
  h: Harness,
  calls: readonly DrawCall[],
  paths: readonly string[],
): Promise<SourcedDraw[]> {
  return drawsAmong(h, imageDraws(calls), paths);
}

/** {@link drawsOf} over draws already narrowed by something other than the source. */
export async function drawsAmong(
  h: Harness,
  draws: readonly ImageDraw[],
  paths: readonly string[],
): Promise<SourcedDraw[]> {
  const memo = identified.get(h) ?? new Map<string, number>();
  identified.set(h, memo);
  const group = paths.join("|");
  const found: SourcedDraw[] = [];
  for (const draw of draws) {
    const key = `${group}#${draw.image.id}`;
    let index = memo.get(key);
    if (index === undefined) {
      index = await sourceIndex(h, draw.image.id, paths);
      if (index < 0) index = await sourceIndex(h, draw.image.id, paths, true);
      memo.set(key, index);
    }
    if (index >= 0) found.push({ draw, index });
  }
  return found;
}

/**
 * The one draw of `paths` on the frame, or a failure naming what was drawn.
 *
 * `what` names the thing the point is about, so the failure a reviewer reads
 * says which produced file the frame was supposed to carry.
 */
export async function oneDrawOf(
  h: Harness,
  calls: readonly DrawCall[],
  paths: readonly string[],
  what: string,
): Promise<SourcedDraw> {
  const found = await drawsOf(h, calls, paths);
  if (found.length !== 1) {
    fail(
      `exactly one draw of ${what} on the frame (${paths.join(", ")})`,
      `${found.length} such draws, out of ${imageDraws(calls).length} images drawn`,
    );
  }
  return found[0]!;
}

/**
 * The draw of `paths` nearest `at`, or a failure.
 *
 * What a check reads when several of the same sheet are on the frame at once,
 * such as one moth of a roster or one lantern of a set.
 */
export async function drawOfNear(
  h: Harness,
  calls: readonly DrawCall[],
  paths: readonly string[],
  at: XY,
  what: string,
  reach = BLIT_TOL,
): Promise<SourcedDraw> {
  const found = await drawsOf(h, calls, paths);
  let best: SourcedDraw | undefined;
  for (const entry of found) {
    if (
      best === undefined ||
      drawGap(entry.draw, at) < drawGap(best.draw, at)
    ) {
      best = entry;
    }
  }
  if (best === undefined || drawGap(best.draw, at) > reach) {
    fail(
      `a draw of ${what} centred within ${reach} units of (${at.x.toFixed(1)}, ${at.y.toFixed(1)})`,
      found.length === 0
        ? "no draw of that produced file on the frame"
        : found.map(
            (entry) =>
              `(${entry.draw.cx.toFixed(1)}, ${entry.draw.cy.toFixed(1)})`,
          ),
    );
  }
  return best;
}

/**
 * The one draw CENTRED at `at` and drawn from one of `paths`, or a failure.
 *
 * {@link drawOfNear} resolves the source of every image the frame drew before it
 * picks the nearest; this one narrows by position FIRST and resolves only the
 * draws that landed where the thing is. What a point reads when a frame carries a
 * dozen different sheets at once, such as the whole roster posed on the field:
 * the question is what was drawn at each place, and resolving a moth's sheet
 * against a hound's draw answers nothing.
 */
export async function drawFromAt(
  h: Harness,
  calls: readonly DrawCall[],
  paths: readonly string[],
  at: XY,
  what: string,
  reach = BLIT_TOL,
): Promise<SourcedDraw> {
  const here = imageDraws(calls).filter((draw) => drawGap(draw, at) <= reach);
  const found = await drawsAmong(h, here, paths);
  if (found.length !== 1) {
    fail(
      `exactly one draw of ${what} centred within ${reach} units of ` +
        `(${at.x.toFixed(1)}, ${at.y.toFixed(1)}) (${paths.join(", ")})`,
      `${found.length} such draws, out of ${here.length} images drawn there`,
    );
  }
  return found[0]!;
}

/** The files of one enemy's walk sheet, frame `0` first. */
export function enemySheet(id: EnemyId): string[] {
  return Array.from({ length: ENEMY_WALK_FRAMES }, (_unused, frame) =>
    enemyFrame(id, frame),
  );
}

/** The side an enemy's sheet is drawn at: "twice its radius in `ENEMIES`, square". */
export function enemySide(id: EnemyId): number {
  return 2 * ENEMIES[id].radius;
}

/** The files of one weapon's effect, frame `0` first; one file for a still effect. */
export function effectFiles(weapon: WeaponId): readonly string[] {
  return EFFECT_SPRITES[weapon].files;
}

/** Where a world point is drawn on the stage, for the frame `snapshot` describes. */
export function stageOf(snapshot: WickSnapshot, at: XY): XY {
  return stagePoint(snapshot, at.x, at.y);
}

/* -------------------------------------------------------------------------- */
/* Which way a sprite was drawn                                               */
/* -------------------------------------------------------------------------- */
//
// `specs/world.md` — "Facing": "the lamplighter's sprite is drawn facing the same
// way" as `facing`. `specs/assets.md` leaves the build two ways to do it:
// "produce one facing and mirror it in code, or produce both", and it allows an
// enemy's sprite to be "mirrored across its vertical axis to face the sign of its
// heading's `x`" the same way. Both are read here, because both are conformant: a
// build that reflects through the transform reports a negative destination width,
// and one that pre-renders a reflected copy draws a source whose pixels are the
// produced file reflected.

/** Which way round a sprite reached the canvas, relative to its produced file. */
export type Orientation = "upright" | "mirrored" | "either" | "unknown";

/**
 * Which way round `draw` put one of `paths` on the canvas.
 *
 * `"either"` for a sprite whose produced file is its own reflection, where the
 * question has no answer and every build satisfies whichever way the requirement
 * reads; `"unknown"` when the source is none of the files at all.
 */
export async function orientationOf(
  h: Harness,
  draw: ImageDraw,
  paths: readonly string[],
): Promise<Orientation> {
  const upright = (await sourceIndex(h, draw.image.id, paths)) >= 0;
  const reflected = (await sourceIndex(h, draw.image.id, paths, true)) >= 0;
  const flippedByTransform = draw.dw < 0;
  if (upright && reflected) return "either";
  if (upright) return flippedByTransform ? "mirrored" : "upright";
  if (reflected) return flippedByTransform ? "upright" : "mirrored";
  return "unknown";
}

/**
 * The one draw of `paths` on the frame, whichever way round it was put there.
 *
 * The counterpart of {@link oneDrawOf} for a point about facing, which has to
 * find the sprite before it can say which way it faces.
 */
export async function oneSpriteDraw(
  h: Harness,
  calls: readonly DrawCall[],
  paths: readonly string[],
  what: string,
): Promise<ImageDraw> {
  return (await oneDrawOf(h, calls, paths, what)).draw;
}

/**
 * Which of `paths` `draw` put on the canvas, counted from `0`, whichever way
 * round it was put there, or `-1` when it is none of them.
 *
 * What a point about a sheet's FRAME reads: `specs/assets.md` numbers a sheet's
 * files from `0` and states each animation as an index into that numbering, so
 * the index is the reading and the mirror is beside the point.
 */
export async function frameIndexOf(
  h: Harness,
  draw: ImageDraw,
  paths: readonly string[],
): Promise<number> {
  const upright = await sourceIndex(h, draw.image.id, paths);
  if (upright >= 0) return upright;
  return sourceIndex(h, draw.image.id, paths, true);
}
