// presentation/effects — the drive and the reading the ten "drawn where its
// shape is" suites share.
//
// NOT a check: a module of arrangements and readings. Each suite poses its own
// weapon's shape, names the produced files that weapon's effect draws from,
// and calls the reading below; the claim, its bound, and the spec sentence it
// comes from stay in the suite.
//
// THE REQUIREMENT ALL TEN SHARE. `specs/assets.md`, "The weapon effects":
// "Each weapon has one effect the game draws wherever the weapon's shape is
// live, as `specs/weapons.md` and `specs/evolutions.md` define that shape. Each
// is produced on the canvas its row states and scaled in code to the live
// shape, which `areaMul` and later levels grow, so the effect's drawn extent is
// the hitbox's extent on every tick it is drawn." The table's "Drawn over"
// column then names the shape and the span for each weapon, and
// `specs/state.md` reports that shape in the snapshot: a zone's `x`, `y`, and
// `radius`, a slash's `width` and `height`, a projectile's `x`, `y`, and
// `radius`.
//
// So the reading is the same for all ten: on every tick the snapshot holds the
// shape, the frame drew one of the weapon's own produced files, centred on the
// shape's centre, covering the shape's extent; on the ticks after the shape is
// gone, the frame drew none of them.
//
// WHY THE DRIVE ENDS ON THE SNAPSHOT RATHER THAN A COUNT. Each shape's life is
// its own (`SLASH_FLASH`, a projectile's `duration`, an aura that never
// expires), and the suite that owns it says how it ends. The trace runs a tick
// at a time and stops when the shape leaves the snapshot, so nothing here
// hard-codes a life.

import { assertBetween, assertGreaterThan, assertTrue, fail } from "../assert";
import type { Blit, Harness, WickSnapshot } from "../harness";
import { drawnFrom, EXTENT_TOL, SPRITE_TOL } from "./sprites";

/** A live hitbox, as the snapshot reports it: its centre and its full extent. */
export interface Shape {
  x: number;
  y: number;
  /** The full extent across, in world units: a diameter, or a slash's width. */
  w: number;
  h: number;
}

/** A circle's shape: its centre and the diameter its radius spans. */
export function circleShape(circle: {
  x: number;
  y: number;
  radius: number;
}): Shape {
  return {
    x: circle.x,
    y: circle.y,
    w: circle.radius * 2,
    h: circle.radius * 2,
  };
}

/** One tick of a trace: what the frame drew, and the shape that tick left. */
export interface EffectTick {
  /** Ticks driven since the trace began, counting from `1`. */
  tick: number;
  /** The shape the snapshot held after this tick, or `null` once it is gone. */
  shape: Shape | null;
  /** Everything the frame blitted. */
  blits: Blit[];
}

export interface TraceOptions {
  /** Ticks to keep driving after the shape leaves the snapshot. Defaults to `4`. */
  after?: number;
  /** The most ticks the shape may live before the trace gives up. */
  maxTicks?: number;
  /**
   * Run after each tick is recorded, for a shape that ends by a pose rather
   * than by a timer: the aura and the Chandelier set never expire, so the
   * suite that owns one drops its weapon partway through the trace.
   */
  act?: (tick: number) => void;
}

/**
 * Drive a tick at a time, reading each frame's bitmaps and the shape the tick
 * left, until the shape is gone and `after` more ticks have run.
 *
 * The frame renders the state its own tick left, so the shape read from the
 * snapshot after a frame is the shape that frame drew.
 */
export async function traceEffect(
  h: Harness,
  locate: (snapshot: WickSnapshot) => Shape | null,
  options: TraceOptions = {},
): Promise<EffectTick[]> {
  const after = options.after ?? 4;
  const maxTicks = options.maxTicks ?? 400;
  const trace: EffectTick[] = [];
  let gone = 0;
  for (let tick = 1; tick <= maxTicks && gone < after; tick += 1) {
    const blits = await h.frameBlits();
    const shape = locate(h.snapshot());
    trace.push({ tick, shape, blits });
    if (shape === null) gone += 1;
    options.act?.(tick);
  }
  return trace;
}

/**
 * Assert that `files` were drawn over the shape on every tick it existed, at
 * its centre and its extent, and on no tick after.
 *
 * `what` names the shape in the failure, so a suite reads as its own weapon's.
 */
export function assertDrawnOverShape(
  h: Harness,
  trace: readonly EffectTick[],
  files: readonly string[],
  what: string,
): void {
  const live = trace.filter((entry) => entry.shape !== null);
  assertGreaterThan(live.length, 0, `ticks holding a live ${what}`);
  if (trace[trace.length - 1].shape !== null) {
    fail(`a tick on which the ${what} is gone`, "the shape outlived the trace");
  }

  for (const entry of live) {
    const shape = entry.shape as Shape;
    const drawn = drawnFrom(
      h,
      entry.blits,
      files,
      shape.x,
      shape.y,
      SPRITE_TOL,
    );
    assertGreaterThan(
      drawn.length,
      0,
      `one of ${files.join(", ")} drawn centred on the ${what} on tick ` +
        `${entry.tick}, where the shape stands at (${shape.x.toFixed(2)}, ` +
        `${shape.y.toFixed(2)})`,
    );
    const blit = drawn[drawn.length - 1];
    assertBetween(
      blit.w,
      shape.w - EXTENT_TOL,
      shape.w + EXTENT_TOL,
      `the drawn width of the ${what}'s effect on tick ${entry.tick}, against ` +
        `the shape's ${shape.w.toFixed(2)}`,
    );
    assertBetween(
      blit.h,
      shape.h - EXTENT_TOL,
      shape.h + EXTENT_TOL,
      `the drawn height of the ${what}'s effect on tick ${entry.tick}, ` +
        `against the shape's ${shape.h.toFixed(2)}`,
    );
  }

  for (const entry of trace) {
    if (entry.shape !== null) continue;
    assertTrue(
      entry.blits.every((blit) => !files.includes(blit.id)),
      `no frame of the ${what}'s effect drawn on tick ${entry.tick}, after ` +
        `the shape is gone`,
    );
  }
}
