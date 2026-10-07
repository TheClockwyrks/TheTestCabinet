// presentation/effects — the drive the ten "effect drawn where its shape is"
// points share.
//
// THE REQUIREMENT THEY ALL READ. `specs/assets.md` — "The weapon effects": "Each
// weapon has one effect the game draws wherever the weapon's shape is live, as
// `specs/weapons.md` and `specs/evolutions.md` define that shape. Each is
// produced on the canvas its row states and scaled in code to the live shape,
// which `areaMul` and later levels grow, so the effect's drawn extent is the
// hitbox's extent on every tick it is drawn." The row's "Drawn over" column then
// names the shape and the span for each weapon, and each point below quotes its
// own row.
//
// WHAT THE DRIVE DOES. One shape is posed alone on an emptied night, and the
// night is then stepped ONE TICK AT A TIME for the whole of that shape's life
// and past its end. On every tick the shape is in `zones` or `projectiles`, the
// frame must carry a draw of that weapon's produced effect file, centred on the
// shape's centre as the camera maps it and drawn at the shape's own extent. On
// every tick after it is gone, the frame must carry no draw of that file at all.
// Both halves are the point: an effect that outlives its hitbox lies about where
// the danger is, and one that never appears leaves the hitbox invisible.
//
// THE SHAPE IS READ LIVE, NOT ASSUMED. Each tick's extent comes from the snapshot
// the tick left, because that is what the sentence above compares the drawing to:
// whether the hitbox itself carries the figure its level table gives it is
// another category's point, and a build that reported one figure and drew another
// is what this one is about.
//
// THE FIRST TICK IS THE ONE THE SHAPE APPEARED ON. A shape created by a firing
// tick is already drawn on that tick's own frame, which has been rendered by the
// time the drive is handed the snapshot, so {@link OverShapeOptions.opened} takes
// that frame as tick `1` and the drive steps the rest. A shape a pose put in the
// world has no frame of its own, so a drive without `opened` starts at the first
// tick stepped.
//
// THE TOLERANCE. `BLIT_TOL`, one logical unit, on the centre and on the extent
// alike: at the harness's default fit one unit is one device pixel and a build is
// free to round a fractional world position to the pixel grid before it blits.
// Nothing wider is allowed, because the extent IS the figure the specification
// fixes — a `120 x 40` slash, a circle of twice its radius.

import { BLIT_TOL, type WeaponId } from "../constants";
import { assertNear, assertEqual, assertGreaterThan } from "../assert";
import {
  stagePoint,
  type DrawCall,
  type Harness,
  type WickSnapshot,
} from "../harness";
import { drawOfNear, drawsOf, effectFiles, squareSide } from "./readouts";

/** The live shape a point is about, in world units. */
export interface LiveShape {
  x: number;
  y: number;
  /** The extent the effect is drawn at, across and down. */
  width: number;
  height: number;
}

/** A circle's shape: "the effect's drawn extent is the hitbox's extent". */
export function circleShape(shape: {
  x: number;
  y: number;
  radius: number;
}): LiveShape {
  return {
    x: shape.x,
    y: shape.y,
    width: shape.radius * 2,
    height: shape.radius * 2,
  };
}

/** What one of these points drives. */
export interface OverShapeOptions {
  /** The weapon whose row of `specs/assets.md` is being read. */
  weapon: WeaponId;
  /** The live shape in a snapshot, or `null` once it is gone. */
  find(snapshot: WickSnapshot): LiveShape | null;
  /** How many ticks the shape's own row gives it, the tick it appeared included. */
  life: number;
  /** The tick that created the shape, whose frame has already been rendered. */
  opened?: WickSnapshot;
  /** How many ticks past the end to read. Four by default. */
  after?: number;
  /**
   * Whether the shape is a rectangle, read as `dw` and `dh` rather than as a
   * square's diagonal. A slash alone: `specs/weapons.md` fixes its rectangle
   * axis-aligned, and leaves a projectile free to be "turned to its velocity".
   */
  rectangle?: boolean;
  /**
   * Run after the tick numbered `life`: what a point about a shape that lives
   * until something ends it does to end it, such as dropping the weapon whose
   * aura the placement rule keeps in the world.
   */
  endLife?: () => Promise<void>;
}

/** What the drive saw: how many ticks the shape was drawn on. */
export interface OverShapeResult {
  drawn: number;
}

/**
 * Step the night one tick at a time and hold every frame to the requirement.
 *
 * The shape must be live on the first tick read, must go on being drawn over
 * itself for every tick it stays, and must leave nothing behind on the ticks
 * after it is gone.
 */
export async function drawnOverShape(
  h: Harness,
  options: OverShapeOptions,
): Promise<OverShapeResult> {
  const files = effectFiles(options.weapon);
  const after = options.after ?? 4;
  const what = `${options.weapon}'s produced effect`;
  let drawn = 0;
  let gone = 0;

  const read = async (
    snapshot: WickSnapshot,
    calls: readonly DrawCall[],
    tick: number,
  ): Promise<void> => {
    const shape = options.find(snapshot);
    if (shape === null) {
      gone += 1;
      const stray = await drawsOf(h, calls, files);
      assertEqual(
        stray.length,
        0,
        `draws of ${what} on tick ${tick}, which is ${gone} tick(s) after its ` +
          "shape was gone and a tick the effect is drawn on no longer " +
          "(specs/assets.md)",
      );
      return;
    }
    assertEqual(
      gone,
      0,
      `${what}'s shape to stay gone once it has expired, rather than ` +
        `reappearing on tick ${tick} (specs/weapons.md)`,
    );
    const at = stagePoint(snapshot, shape.x, shape.y);
    const found = await drawOfNear(h, calls, files, at, what);
    if (options.rectangle === true) {
      assertNear(
        Math.abs(found.draw.dw),
        shape.width,
        BLIT_TOL,
        `the width ${what} was drawn at on tick ${tick}, which is its shape's ` +
          "own width (specs/assets.md)",
      );
      assertNear(
        Math.abs(found.draw.dh),
        shape.height,
        BLIT_TOL,
        `the height ${what} was drawn at on tick ${tick}, which is its ` +
          "shape's own height (specs/assets.md)",
      );
    } else {
      assertNear(
        squareSide(found.draw),
        shape.width,
        BLIT_TOL,
        `the extent ${what} was drawn at on tick ${tick}, which is its ` +
          "circle's diameter (specs/assets.md)",
      );
    }
    drawn += 1;
  };

  let tick = 0;
  if (options.opened !== undefined) {
    tick = 1;
    await read(options.opened, await h.lastCalls(), tick);
  }
  while (tick < options.life + after && gone < after) {
    if (options.endLife !== undefined && tick === options.life) {
      await options.endLife();
    }
    tick += 1;
    const snapshot = await h.step(1);
    await read(snapshot, await h.lastCalls(), tick);
  }

  assertGreaterThan(
    drawn,
    0,
    `${what} to be drawn over its shape on at least the tick the shape was ` +
      "live (specs/assets.md)",
  );
  assertEqual(
    drawn,
    options.life,
    `the ticks ${what} was drawn on, which is every tick its shape existed ` +
      "(specs/assets.md)",
  );
  return { drawn };
}
