// presentation — the readings every check in this directory takes off a frame.
//
// A presentation point asks one of three questions of a frame the build drew:
// WHICH produced file a figure was painted from, WHERE the bitmap's center
// landed on the stage, and HOW MUCH of the stage it covered. `harness.ts`
// already turns a frame's calls into blits carrying the produced path each one
// painted and the box each covered; this module names the three readings on top
// of that, so each check states its requirement and nothing else.
//
// Nothing here decides a verdict of its own beyond the one every check shares:
// a figure the specification says is drawn, and that the frame did not draw at
// all, fails the point that asked for it, through `assertDefined`.

import { assertDefined, assertWithin, fail } from "../assert";
import {
  DRAWN_POINT_TOLERANCE,
  EFFECT_SPRITES,
  ENEMY_SHEET_DIR,
  LAMPLIGHTER_IDLE_PATH,
  type EnemyId,
  type WeaponId,
} from "../constants";
import {
  blitBoxOnStage,
  blitCenterOnStage,
  blitsOfFile,
  blitsUnderDir,
  worldToStage,
  type Blit,
  type Harness,
  type Point,
  type WickSnapshot,
} from "../harness";

/**
 * The directory the lamplighter's idle sprite and its six walk frames sit
 * under, taken from the idle sprite's own path so the two cannot disagree:
 * specs/assets.md puts them at `assets/sprites/lamplighter/idle.png` and
 * `assets/sprites/lamplighter/walk/0.png` to `5.png`.
 */
export const LAMPLIGHTER_DIR = LAMPLIGHTER_IDLE_PATH.slice(
  0,
  LAMPLIGHTER_IDLE_PATH.lastIndexOf("/"),
);

/** The directory enemy `id`'s four walk frames sit under (specs/assets.md). */
export function enemyDir(id: EnemyId): string {
  return `${ENEMY_SHEET_DIR}/${id}`;
}

/**
 * How far a drawn sprite's WIDTH or HEIGHT on the stage may sit from the extent
 * the specification gives the thing it covers.
 *
 * Twice DRAWN_POINT_TOLERANCE, because an extent is the difference of two
 * edges and a build may snap each of them to a whole device pixel. It stays far
 * below any figure a check here compares against: the smallest extent the specs
 * state is the 8 units of a small gem.
 */
export const DRAWN_EXTENT_TOLERANCE = 2 * DRAWN_POINT_TOLERANCE;

/**
 * The last blit of a produced file under `dir` on this frame, or the check
 * fails because the build drew nothing there.
 *
 * The LAST such blit, because that is the one a player sees where two overlap.
 */
export function drawnUnder(
  blits: readonly Blit[],
  dir: string,
  what: string,
): Blit {
  const found = blitsUnderDir(blits, dir);
  const last = found[found.length - 1];
  assertDefined(
    last,
    `a drawImage of a produced file under ${dir}, the ${what}`,
  );
  return last;
}

/** The last blit of the produced file at `path`, or the check fails. */
export function drawnFile(
  blits: readonly Blit[],
  path: string,
  what: string,
): Blit {
  const found = blitsOfFile(blits, path);
  const last = found[found.length - 1];
  assertDefined(last, `a drawImage of ${path}, the ${what}`);
  return last;
}

/** Where the last blit under `dir` put its center, in logical stage units. */
export function drawnCenterUnder(
  h: Harness,
  blits: readonly Blit[],
  dir: string,
  what: string,
): Point {
  return blitCenterOnStage(h, drawnUnder(blits, dir, what));
}

/**
 * The frame number a sheet file's name carries: `3` for
 * `assets/sprites/lamplighter/walk/3.png`. A file named anything else fails the
 * check that read it, since specs/assets.md numbers a sheet's frames from `0`
 * and gives each its own file.
 */
export function frameNumber(id: string, what: string): number {
  const match = /\/(\d+)\.png$/.exec(id);
  if (match === null) {
    fail(`a numbered frame of the ${what} sheet, as <n>.png`, id);
  }
  return Number(match[1]);
}

/**
 * The frame the sheet a check is watching showed after `ticks` ticks, against
 * the frame the specification's formula gives, accepting the frame of the tick
 * before on a tick that falls EXACTLY on a frame boundary.
 *
 * The boundary slack is the honest tolerance for the arithmetic the specs
 * spell: every animation figure is a count of seconds (`WALK_FRAME_TIME` is
 * `0.1`, `SPARK_FLASH / 4` is `0.05`), and `n × TICK_DT` for an `n` that lands
 * on such a boundary is a double that may sit either side of it, so a build
 * that spells the formula exactly as the specs write it advances on that one
 * tick or on the next. Every tick between two boundaries is asserted exactly,
 * so a sheet that advances at any other rate, or in any other order, still
 * fails.
 */
export function assertFrameAt(
  drawn: number,
  ticks: number,
  frameTicks: number,
  expected: (elapsed: number) => number,
  context: string,
): void {
  const want = expected(ticks);
  if (drawn === want) return;
  if (ticks > 0 && ticks % frameTicks === 0 && drawn === expected(ticks - 1)) {
    return;
  }
  fail(`frame ${want} (${context})`, drawn);
}

/**
 * Every blit of `weapon`'s produced effect on this frame: the one file for an
 * effect that holds one shape, any frame of the sheet for one that moves
 * (specs/assets.md, The weapon effects).
 */
export function effectBlits(blits: readonly Blit[], weapon: WeaponId): Blit[] {
  const sprite = EFFECT_SPRITES[weapon];
  return sprite.frames === 1
    ? blitsOfFile(blits, sprite.path)
    : blitsUnderDir(blits, sprite.path);
}

/**
 * Assert that the frame drew `weapon`'s effect over the shape centered on the
 * world point `(wx, wy)` with the stage extent `width x height`: the blit
 * nearest that point is centered on it and covers exactly that extent.
 *
 * This is the reading every "drawn where its hitbox is" point takes, from
 * specs/assets.md: "Each is produced on the canvas its row states and scaled in
 * code to the live shape ... so the effect's drawn extent is the hitbox's
 * extent on every tick it is drawn", and "Each is drawn centered on the thing
 * it depicts".
 */
export function assertEffectOverShape(
  h: Harness,
  blits: readonly Blit[],
  weapon: WeaponId,
  snapshot: WickSnapshot,
  wx: number,
  wy: number,
  width: number,
  height: number,
  context: string,
): void {
  const at = worldToStage(snapshot.run.player, wx, wy);
  const found = effectBlits(blits, weapon);
  let nearest: Blit | undefined;
  let best = Infinity;
  for (const blit of found) {
    const center = blitCenterOnStage(h, blit);
    const away = Math.hypot(center.x - at.x, center.y - at.y);
    if (away < best) {
      best = away;
      nearest = blit;
    }
  }
  assertDefined(
    nearest,
    `a drawImage of ${EFFECT_SPRITES[weapon].path} (${context})`,
  );
  const over = nearest as Blit;
  const center = blitCenterOnStage(h, over);
  assertWithin(center.x, at.x, DRAWN_POINT_TOLERANCE, `${context}: center x`);
  assertWithin(center.y, at.y, DRAWN_POINT_TOLERANCE, `${context}: center y`);
  const box = blitBoxOnStage(h, over);
  assertWithin(box.w, width, DRAWN_EXTENT_TOLERANCE, `${context}: drawn width`);
  assertWithin(
    box.h,
    height,
    DRAWN_EXTENT_TOLERANCE,
    `${context}: drawn height`,
  );
}

/** Assert the frame drew no part of `weapon`'s effect anywhere. */
export function assertNoEffect(
  blits: readonly Blit[],
  weapon: WeaponId,
  context: string,
): void {
  const found = effectBlits(blits, weapon);
  if (found.length > 0) {
    fail(
      `no drawImage of ${EFFECT_SPRITES[weapon].path} (${context})`,
      found.map((blit) => blit.id),
    );
  }
}
