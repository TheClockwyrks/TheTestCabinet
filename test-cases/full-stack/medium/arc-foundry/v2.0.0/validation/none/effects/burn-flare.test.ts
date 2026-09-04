// Arc Foundry — effects/burn-flare: a burn landing on a unit flares on that unit.
//
// THE REQUIREMENT, from `specs/assets.md`: the burn is spawned when "a burn is
// applied", it carries "an ember flare on impact and a low flicker while the burn
// ticks", and it is spawned "at the position of the event that raised it: ... the
// slow snap and the burn on the unit carrying them".
//
// THE BURN IS APPLIED DIRECTLY. `specs/instrumentation.md` applies `setUnitBurn`
// "through the rule `specs/enemies.md` fixes for an applied burn", so the event
// this point is about is raised alone: no shot, no projectile, and no impact burst
// on the same frame to be mistaken for the flare. A Rectifier's hit is what
// `audio/burn` drives, because that point is about a cue rather than about which
// system was played where.
//
// WHAT IS READ, AND WHY IT IS BESIDE THE UNIT. A unit's own idle cycle loops while
// it is on the yard, so the pixels over its sprite are moving before any burn
// lands. The reading is taken in the band just outside the `20 x 20` frame a Mote
// is drawn at and below it, clear of the health bar — which matters more here than
// for the slow, because a burn removes health while it ticks and a bar redrawing
// is not a flare.
//
// THE BURN IS SMALL AND SHORT ENOUGH THAT THE UNIT LIVES. One point a second for
// four seconds against a Mote, which `specs/enemies.md` scales to ten health on
// wave one at Medium: nothing dies inside the tenth of a second being read, so no
// death burst can stand in for the flare.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertGreaterThanOrEqual } from "../assert";
import { tileCenter } from "../constants";
import {
  captureReplay,
  createHarness,
  openYard,
  parkUnit,
  ticks,
  type Harness,
} from "../harness";
import { motion } from "./region";

/** Clear ground, well away from the map's waypoint platforms and its chain. */
const AT = tileCenter(26, 17);

/** Just outside the Mote's own frame and below it, so neither the cycle nor the bar reads. */
const POINTS = (() => {
  const points: { x: number; y: number }[] = [];
  for (let dx = -24; dx <= 24; dx += 4) {
    for (let dy = 12; dy <= 26; dy += 3) {
      points.push({ x: AT.x + dx, y: AT.y + dy });
    }
  }
  return points;
})();

const WINDOW = ticks(0.1);
const MOVING = WINDOW / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sets the ground around a unit moving when a burn lands on it", async () => {
  await openYard(h, { wave: 1 });
  const unit = await parkUnit(h, "mote", AT);
  await h.advance(1);
  const still = await motion(h, POINTS, WINDOW);

  const played = await captureReplay(h, "burn", async () => {
    await h.debug.setUnitBurn(unit, 1, 4);
    await h.advance(1);
    return motion(h, POINTS, WINDOW);
  });

  assertGreaterThan(
    played,
    still,
    "the ground around a unit to change on more frames after a burn is " +
      "applied to it than before, so a burn flare is played on it " +
      `(specs/assets.md); it changed on ${still} of ${WINDOW} frames before`,
  );
  assertGreaterThanOrEqual(
    played,
    MOVING,
    "the flare to keep moving across the tenth of a second after the burn " +
      "lands, as a live particle system does (specs/assets.md)",
  );
});
