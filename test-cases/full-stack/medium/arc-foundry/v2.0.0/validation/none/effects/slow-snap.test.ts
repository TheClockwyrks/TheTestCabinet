// Arc Foundry — effects/slow-snap: a slow landing on a unit snaps on that unit.
//
// THE REQUIREMENT, from `specs/assets.md`: the slow snap is spawned when "a slow
// is applied", it carries "a drag snap clinging to the slowed unit", and it is
// spawned "at the position of the event that raised it: ... the slow snap and the
// burn on the unit carrying them".
//
// THE SLOW IS APPLIED DIRECTLY, AND THAT IS THE POINT. `specs/instrumentation.md`
// applies `setUnitSlow` "through the rule `specs/enemies.md` fixes for an applied
// slow", and a pose "arranges the yard through the same systems play uses". So the
// event this point is about is raised with nothing else raised beside it: no shot
// is fired, no projectile connects, and no impact burst plays on the same frame to
// be mistaken for the snap. A Choke's hit is what `audio/slow` drives, because
// that point is about a cue rather than about which system was played where.
//
// WHAT IS READ, AND HOW THE UNIT'S OWN CYCLE IS KEPT OUT OF THE ANSWER. A snap
// "clinging to the slowed unit" is drawn over the unit, so the reading has to be
// taken there — and a unit's own idle cycle loops while it is on the yard
// (`specs/assets.md`), so those pixels are already moving before any slow lands.
// That is why the reading is a COMPARISON against the same ground under the same
// looping cycle rather than against a still picture: a four-frame loop advances a
// handful of times in a tenth of a second, and a system simulated live moves on
// nearly every frame of it. The band above the unit is left out, because
// `specs/enemies.md` draws a health bar on every unit and a bar is not a snap.

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
import { lattice, motion } from "./region";

/** Clear ground, well away from the map's waypoint platforms and its chain. */
const AT = tileCenter(26, 17);

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

it("sets the ground around a unit moving when a slow lands on it", async () => {
  await openYard(h, { wave: 1 });
  const unit = await parkUnit(h, "mote", AT);
  await h.advance(1);
  const still = await motion(h, POINTS, WINDOW);

  const played = await captureReplay(h, "slow", async () => {
    await h.debug.setUnitSlow(unit, 0.3, 4);
    await h.advance(1);
    return motion(h, POINTS, WINDOW);
  });

  assertGreaterThan(
    played,
    still,
    "the ground around a unit to change on more frames after a slow is " +
      "applied to it than before, so a slow snap is played on it " +
      `(specs/assets.md); it changed on ${still} of ${WINDOW} frames before`,
  );
  assertGreaterThanOrEqual(
    played,
    MOVING,
    "the snap to keep moving across the tenth of a second after the slow " +
      "lands, as a live particle system does (specs/assets.md)",
  );
});
