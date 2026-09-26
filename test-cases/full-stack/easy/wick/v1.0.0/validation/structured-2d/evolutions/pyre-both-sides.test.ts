// evolutions/pyre-both-sides — Pyre slashes both sides on every firing.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Pyre"): "Pyre is
// Taper's slash on both sides of the player on every firing: two rectangles of
// `width × height`, one extending `width` in the facing direction from the
// player's `x` and one mirrored to the opposite side, each centered vertically
// on the player's `y`, each hitting on the tick it fires alone". `PYRE_STATS`
// gives width 200 and height 60, and with no passive held `areaMul` is 1
// (`specs/passives.md`). `specs/state.md` (`ZoneState`): "`x`, `y`: ... for a
// slash the center of the rectangle", so facing right the two rectangles are
// centered at `player.x ± 100` on `player.y`. `specs/weapons.md` ("Shapes and
// overlap"): "A rectangle and a circle overlap when the distance from the
// circle's center to the nearest point of the rectangle is less than the
// circle's radius", so a moth standing at either center is inside its
// rectangle and is hit ("Hits and death": "A hit removes the shape's damage
// per hit from the enemy's `hp`").
//
// WHY BOTH MOTHS ARE READ AS HIT RATHER THAN AS DAMAGED. Pyre deals 60 and a
// moth holds 5 `hp` (`specs/enemies.md`), so a moth either rectangle reaches
// dies on the firing tick and is gone from `enemies`; a moth neither reached
// keeps exactly the `hp` it was posed with, since with `enemyMotion`,
// `enemyContact` and `despawning` off nothing else can touch it.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run at the origin facing right
// — the facing a fresh run starts with (`specs/world.md`, Facing), read back
// before the firing — with one moth at each rectangle's center and nothing
// else, Pyre armed, `weaponFire` the one switch on. The two moths stand 100
// units out, past the `PICKUP_RADIUS` (`48`) their gems would have to be
// inside to be drawn in, so what they drop stays where it fell and changes
// nothing.
//
// THE TOLERANCE. None on the outcomes, which are a count and two enemy
// readings; `MOTION_EPS` on the two rectangle centers, each the player's `x`
// less or plus half a width.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { MOTION_EPS, PICKUP_RADIUS, PYRE_STATS } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  placeEnemyNear,
  zonesOfKind,
  type Harness,
} from "../harness";
import { fireFromPosed, hpOf, wasHit } from "./evolved";

/** Half a slash's width: where each rectangle's center sits. */
const HALF = PYRE_STATS.width / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("hits a moth on the facing side and a moth on the mirrored side on one firing tick", async () => {
  if (!(HALF > PICKUP_RADIUS)) {
    throw new Error("the moths must stand outside the pickup radius");
  }

  const posed = isolate(h);
  assertEqual(
    posed.run.player.facing,
    "right",
    "the facing a fresh run starts with (specs/world.md, Facing)",
  );
  const { player } = posed.run;
  const ahead = placeEnemyNear(h, "moth", HALF, 0);
  const behind = placeEnemyNear(h, "moth", -HALF, 0);
  const before = h.snapshot();
  const hpAhead = hpOf(before, ahead);
  const hpBehind = hpOf(before, behind);

  const firing = await fireFromPosed(h, "pyre");
  captureStill(h, "both");

  const slashes = zonesOfKind(firing.after, "slash");
  assertEqual(
    slashes.length,
    PYRE_STATS.amount,
    "the slashes the firing tick created (specs/evolutions.md, Pyre)",
  );
  const centers = slashes.map((slash) => slash.x).sort((a, b) => a - b);
  assertNear(
    centers[0],
    player.x - HALF,
    MOTION_EPS,
    "the mirrored slash's center x, half a width behind the player (specs/evolutions.md, Pyre)",
  );
  assertNear(
    centers[1],
    player.x + HALF,
    MOTION_EPS,
    "the facing slash's center x, half a width ahead of the player (specs/evolutions.md, Pyre)",
  );
  assertEqual(
    wasHit(firing.after, ahead, hpAhead),
    true,
    "whether the moth on the facing side was hit on the firing tick (specs/evolutions.md, Pyre)",
  );
  assertEqual(
    wasHit(firing.after, behind, hpBehind),
    true,
    "whether the moth on the mirrored side was hit on the firing tick (specs/evolutions.md, Pyre)",
  );
});
