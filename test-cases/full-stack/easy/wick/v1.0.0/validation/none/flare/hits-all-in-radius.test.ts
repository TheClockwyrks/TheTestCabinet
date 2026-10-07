// Wick — flare/hits-all-in-radius: the burst reaches every enemy within its
// radius, and nothing past it.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Flare"): "On firing,
// every enemy within `radius` of the player's center takes `damage` on that
// tick"; row 1 of `FLARE_LEVELS` gives radius `640` and damage `100`;
// ("Shapes and overlap") "An enemy is within `d` of a point when the distance
// from that point to the enemy's center is at most `d`", so the test is the
// distance between centers against the radius, inclusive at `640`, and the
// enemy's own radius reads nothing into it; ("Derived stats") the radius is
// the "table value × `areaMul`", `1` with no passive held
// (`specs/passives.md`); ("Hits and death") "A hit removes the shape's damage
// per hit from the enemy's `hp`", and an enemy whose `hp` is "at or below `0`
// after the hits ... dies on that tick". A moth carries `5` hp
// (`specs/enemies.md`, unscaled at a run clock of `0`), well under the `100`,
// so a moth the burst reaches is gone on the firing tick and a moth it does
// not is still there at its `5`.
//
// THE POSE. An isolated night with the lamplighter at the origin and six moths
// on the axes through it, at distances `100`, `300`, `500`, `620`, and `640`,
// which the radius covers, and `640.5`, which it does not. Each stands on an
// axis, so its distance from the lamplighter's center is one coordinate and is
// exact in floating point whichever way a build compares it, and `640` sits on
// the boundary the specification makes inclusive. Then Flare held at level 1
// and fired through the shared `fireWeapon`. `enemyMotion` and `enemyContact`
// are held, so every moth stands where it was posed on the firing tick and
// none of them reaches the lamplighter.
//
// TOLERANCE. None: each moth is gone, or it is present at the hp it was posed
// with.

import { afterEach, beforeEach, it } from "vitest";
import { weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  fireWeapon,
  isolate,
  placeEnemy,
  type EnemyView,
  type Harness,
} from "../harness";
import { FLARE, assertBurned, assertUntouched } from "./stage";

/** The level whose row is fired: radius `640`, damage `100`. */
const LEVEL = 1;

/** Row 1's damage, `100`. */
const DAMAGE = weaponRow(FLARE, LEVEL).damage;

/** The five points inside the radius, each on an axis through the lamplighter. */
const INSIDE = [
  { x: 100, y: 0 },
  { x: -300, y: 0 },
  { x: 0, y: 500 },
  { x: 0, y: -620 },
  { x: 640, y: 0 },
];

/** The point half a unit past the radius. */
const OUTSIDE = { x: 640.5, y: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("kills the five moths at 100, 300, 500, 620 and 640 and leaves the moth at 640.5 untouched", async () => {
  await isolate(h);
  const inside: EnemyView[] = [];
  for (const at of INSIDE) {
    inside.push(await placeEnemy(h, "moth", at.x, at.y));
  }
  const outside = await placeEnemy(h, "moth", OUTSIDE.x, OUTSIDE.y);

  const firing = await fireWeapon(h, FLARE, LEVEL);
  await captureStill(h, "burst");

  for (const [index, moth] of inside.entries()) {
    const at = INSIDE[index]!;
    assertBurned(firing.after, moth, DAMAGE, `the moth at (${at.x}, ${at.y})`);
  }
  assertUntouched(firing.after, outside, "the moth at 640.5");
});
