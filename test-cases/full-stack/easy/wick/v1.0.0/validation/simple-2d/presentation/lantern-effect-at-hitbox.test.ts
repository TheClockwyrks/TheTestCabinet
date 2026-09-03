// presentation/lantern-effect-at-hitbox — the lantern sprite is drawn over the
// circle a live lantern hits with, and nowhere after.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The weapon effects"):
// "lantern | Lantern | assets/sprites/effects/lantern.png | one sprite |
// 28 x 28 | each lantern's circle, for its life", and "Each is produced on the
// canvas its row states and scaled in code to the live shape, which areaMul and
// later levels grow, so the effect's drawn extent is the hitbox's extent on
// every tick it is drawn." specs/weapons.md ("Lantern") fixes the shape: "Each
// lantern is a circle of radius, and each is a zone with ttl set to duration",
// and ("Shapes and overlap") that a circle is "a center and a radius", so its
// extent is the full diameter. specs/state.md has the snapshot report that
// radius and the lantern's own center, which "a lantern and an aura are placed
// relative to the lamplighter every tick", so the point the effect is read
// against is the snapshot's, not a formula of the check's.
//
// THE WORLD. An isolated playing run (`isolate`): nothing on the field, no
// other weapon held, every driver switch off but the one the firing needs.
// Lantern alone is held at level 1, whose amount is 1, so the firing tick
// creates exactly one lantern, and its cooldown is posed to 0 so the next tick
// fires it. `effectMotion` stays off, so the lantern holds its angle and the
// effect is read against a center that only the placement rule moves.
//
// WHAT IS READ. On every tick the lantern is in the snapshot, the blit of
// `lantern.png` nearest the point the camera formula gives its center: its
// center is that point and its box is the lantern's own diameter. Then the
// ticks after the lantern is gone, on which no `lantern.png` is blitted at all.
//
// TOLERANCE. DRAWN_POINT_TOLERANCE (1 unit) on the drawn center and
// DRAWN_EXTENT_TOLERANCE (2 units) on each extent, the case's tolerances for a
// bitmap a build may snap to whole device pixels. A level-1 lantern is 28 units
// across and rides an orbit of 90, so an effect drawn on the lamplighter rather
// than on the lantern misses by 90.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { LANTERN_LEVELS, ticksFor } from "../constants";
import {
  armWeapon,
  captureReplay,
  createHarness,
  holdWeapon,
  isolate,
  zonesOfKind,
  type Harness,
} from "../harness";
import { circleOf, watchLife } from "./effects";

/** The level held: amount 1, so the firing tick creates one lantern. */
const LEVEL = 1;

/** The ticks its duration gives it, with the sweep's two ticks of slack. */
const BOUND = ticksFor(LANTERN_LEVELS[LEVEL - 1].duration) + 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the lantern sprite over its circle for as long as the lantern is live", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the frames are drawn on");
  assertEqual(
    LANTERN_LEVELS[LEVEL - 1].amount,
    1,
    "Lantern's amount at level 1",
  );
  const slot = holdWeapon(h, "lantern", LEVEL);
  armWeapon(h, slot);

  await captureReplay(h, "effect", async () => {
    const fired = await h.tick(1);
    assertLength(
      zonesOfKind(fired, "lantern"),
      1,
      "the lanterns the firing tick created",
    );
    await watchLife(
      h,
      "lantern",
      (snapshot) => {
        const lantern = zonesOfKind(snapshot, "lantern")[0];
        return lantern === undefined ? undefined : circleOf(lantern);
      },
      "the Lantern lantern",
      BOUND,
    );
  });
});
