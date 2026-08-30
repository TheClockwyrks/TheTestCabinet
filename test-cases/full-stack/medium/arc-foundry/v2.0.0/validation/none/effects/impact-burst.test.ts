// Arc Foundry — effects/impact-burst: a shot that connects bursts where it landed.
//
// THE REQUIREMENT, from `specs/assets.md`: the impact system is spawned when "any
// shot connects with a unit", it carries "a small burst of sparks at the point of
// impact", and it is spawned "at the position of the event that raised it: ... the
// impact where a shot connects".
//
// THE WORLD. One Scrap Capacitor and one held Mote inside its stated range, and
// nothing else. `specs/components.md` puts the hit on the projectile — "when the
// projectile comes within `PROJECTILE_HIT_R` (`6`) of that position it applies its
// damage" — so the frame the unit's health drops is the frame the shot connected,
// and that is the frame the reading starts on. The projectile is removed by then,
// so nothing of the shot itself is left in the picture.
//
// A MOTE SURVIVES THE HIT, ON PURPOSE. `specs/components.md` gives a Scrap
// Capacitor `6` damage and `specs/enemies.md` scales a Mote to ten health on wave
// one at Medium, so the unit lives and no death burst can stand in for the impact.
//
// WHAT IS READ, AND HOW THE UNIT'S OWN CYCLE IS KEPT OUT OF THE ANSWER. The burst
// is drawn where the shot landed, which is on the unit, so the reading is taken
// there — and a unit's idle cycle loops while it is on the yard. The reading is
// therefore a comparison against the same ground under the same looping cycle: a
// four-frame loop advances a handful of times in a tenth of a second, and a system
// simulated live moves on nearly every frame of it. The band above the unit is
// left out, because a health bar dropping is not a burst.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
} from "../assert";
import { structureCenter } from "../constants";
import {
  captureReplay,
  createHarness,
  openYard,
  parkUnit,
  standComponent,
  ticks,
  unitById,
  type Harness,
} from "../harness";
import { lattice, motion } from "./region";

/** Clear ground, well away from the map's waypoint platforms and its chain. */
const ANCHOR = { col: 21, row: 17 };
const HEAD = structureCenter(ANCHOR.col, ANCHOR.row);

/** Eighty units away, inside the Scrap Capacitor's stated range of `100`. */
const AT = { x: HEAD.x + 80, y: HEAD.y };

/** Over the unit and the ground just around it, clear of the health bar above it. */
const POINTS = lattice(AT, 18, 3).filter((point) => point.y >= AT.y - 8);

const WINDOW = ticks(0.1);
const MOVING = WINDOW / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sets the impact point moving on the frame a shot connects", async () => {
  await openYard(h, { wave: 1 });
  const unit = await parkUnit(h, "mote", AT);
  await h.advance(1);
  const still = await motion(h, POINTS, WINDOW);

  await standComponent(h, "capacitor", 1, ANCHOR.col, ANCHOR.row);
  const full = unitById(await h.snapshot(), unit).maxHp;

  const played = await captureReplay(h, "impact", async () => {
    const hit = await h.until(
      (s) => s.units.some((u) => u.id === unit && u.hp < full),
      { maxFrames: ticks(3) },
    );
    return { hit: hit.hit, moving: await motion(h, POINTS, WINDOW) };
  });

  assertEqual(
    played.hit,
    true,
    "a Scrap Capacitor's shot to connect with a Mote eighty units away within " +
      "three seconds (specs/components.md)",
  );
  assertGreaterThan(
    played.moving,
    still,
    "the point a shot connected at to change on more frames than the same " +
      "ground did before the shot, so an impact burst is played there " +
      `(specs/assets.md); it changed on ${still} of ${WINDOW} frames before`,
  );
  assertGreaterThanOrEqual(
    played.moving,
    MOVING,
    "the burst to keep moving across the tenth of a second after the hit, as " +
      "a live particle system does (specs/assets.md)",
  );
});
