// presentation — watching one weapon's shape through its life, shared by the
// ten "drawn where its hitbox is" points.
//
// Each of those points makes the same claim of a different weapon, in the words
// of specs/assets.md ("The weapon effects"): "Each weapon has one effect the
// game draws wherever the weapon's shape is live, as specs/weapons.md and
// specs/evolutions.md define that shape ... Each is produced on the canvas its
// row states and scaled in code to the live shape, which areaMul and later
// levels grow, so the effect's drawn extent is the hitbox's extent on every
// tick it is drawn." Two things follow, and this module asserts both: the
// effect is over the shape on EVERY tick the shape is live, and it is gone once
// the shape is, because a picture left behind reads as a hitbox that is no
// longer there.
//
// How LONG a shape lives belongs to the point that decides its weapon's timing
// rather than to these, so the sweep runs for as long as the build keeps the
// shape and is bounded only by the ticks specs/world.md's timer rule gives that
// shape's duration ("An interval of s seconds anywhere in this specification is
// likewise round(s × TICK_HZ) ticks"), with two ticks of slack.
//
// The point about the six evolved effects makes the same claim of one frame
// rather than of a life, of six weapons at once, so it reads through
// `assertEffectOverEachShape` at the foot of this module.

import {
  assertDefined,
  assertGreaterThan,
  assertWithin,
  fail,
} from "../assert";
import {
  DRAWN_POINT_TOLERANCE,
  EFFECT_SPRITES,
  type WeaponId,
} from "../constants";
import {
  blitBoxOnStage,
  blitCenterOnStage,
  blitsOf,
  worldToStage,
  type Blit,
  type Harness,
  type ProjectileSnapshot,
  type WickSnapshot,
  type ZoneSnapshot,
} from "../harness";
import {
  DRAWN_EXTENT_TOLERANCE,
  assertEffectOverShape,
  assertNoEffect,
  effectBlits,
} from "./drawn";

/** A live shape, as a frame must draw it: a center and a full extent. */
export interface Live {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A circle's drawn extent: its full diameter on both axes. */
export function circleOf(shape: ProjectileSnapshot | ZoneSnapshot): Live {
  return {
    x: shape.x,
    y: shape.y,
    width: 2 * shape.radius,
    height: 2 * shape.radius,
  };
}

/** A slash's drawn extent: the full rectangle its width and height give. */
export function rectangleOf(zone: ZoneSnapshot): Live {
  if (zone.width === undefined || zone.height === undefined) {
    fail(
      "a slash carrying the width and height specs/state.md gives its rectangle",
      JSON.stringify(zone),
    );
  }
  return { x: zone.x, y: zone.y, width: zone.width, height: zone.height };
}

/** Ticks watched past the shape's last, so "on no tick after" has a witness. */
const WATCHED_AFTER = 3;

/**
 * Watch a live shape from the tick it appeared, which the caller has already
 * run, until it is gone, asserting `weapon`'s effect over it on every tick it
 * exists and no effect at all on the ticks after.
 *
 * `bound` ends the sweep: it is the ticks the shape's own duration gives it
 * under the timer rule, with two ticks of slack, so a shape that never goes
 * away fails here rather than running forever, while HOW LONG a shape lives is
 * left to the point that decides its weapon's timing. A shape that was already
 * gone on the tick the caller staged fails too, since the point cannot be
 * decided without one.
 */
export async function watchLife(
  h: Harness,
  weapon: WeaponId,
  locate: (snapshot: WickSnapshot) => Live | undefined,
  what: string,
  bound: number,
): Promise<void> {
  let ticks = 0;
  for (;;) {
    const snapshot = h.snapshot();
    const live = locate(snapshot);
    if (live === undefined) break;
    ticks += 1;
    if (ticks > bound) {
      fail(
        `${what} to be gone within ${bound} ticks, the ticks its duration gives it`,
        `still live on tick ${ticks}`,
      );
    }
    assertEffectOverShape(
      h,
      blitsOf(h.lastCalls()),
      weapon,
      snapshot,
      live.x,
      live.y,
      live.width,
      live.height,
      `${what} on tick ${ticks} of its life`,
    );
    await h.tick(1);
  }
  assertGreaterThan(ticks, 0, `${what}: the ticks its shape was live for`);

  for (let after = 1; after <= WATCHED_AFTER; after += 1) {
    assertNoEffect(
      blitsOf(h.lastCalls()),
      weapon,
      `${what}, ${after} tick${after === 1 ? "" : "s"} after its shape was gone`,
    );
    await h.frameDraw();
  }
}

/**
 * Assert the frame drew `weapon`'s own produced effect over EVERY one of the
 * shapes `shapes` names: for each, SOME blit of that weapon's file centered on
 * the point the camera formula gives it and covering its extent.
 *
 * The same claim {@link assertEffectOverShape} makes, matched rather than
 * taken nearest, which is what a weapon whose shapes land where the game's own
 * generator put them needs: two of Blaze's five puddles may scatter within a
 * unit of one another, and "the blit nearest this puddle" is then the other
 * puddle's, while "a blit over this puddle" is decided whatever they did.
 */
export function assertEffectOverEachShape(
  h: Harness,
  blits: readonly Blit[],
  weapon: WeaponId,
  snapshot: WickSnapshot,
  shapes: readonly Live[],
  what: string,
): void {
  const drawn = effectBlits(blits, weapon).map((blit) => ({
    center: blitCenterOnStage(h, blit),
    box: blitBoxOnStage(h, blit),
  }));
  for (const [index, live] of shapes.entries()) {
    const at = worldToStage(snapshot.run.player, live.x, live.y);
    const over = drawn.find(
      (blit) =>
        Math.abs(blit.center.x - at.x) <= DRAWN_POINT_TOLERANCE &&
        Math.abs(blit.center.y - at.y) <= DRAWN_POINT_TOLERANCE,
    );
    assertDefined(
      over,
      `a drawImage of ${EFFECT_SPRITES[weapon].path} centered on (${at.x}, ${at.y}), ${what} ${index}`,
    );
    const box = (over as { box: { w: number; h: number } }).box;
    assertWithin(
      box.w,
      live.width,
      DRAWN_EXTENT_TOLERANCE,
      `${what} ${index}: drawn width`,
    );
    assertWithin(
      box.h,
      live.height,
      DRAWN_EXTENT_TOLERANCE,
      `${what} ${index}: drawn height`,
    );
  }
}
