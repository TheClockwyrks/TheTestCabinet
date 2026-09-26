// targeting/last — `last` shoots whatever is least far along the chain.
//
// specs/components.md fixes it: `last` "Selects the in-range unit that is Least
// far along the chain, by the same ordering", the ordering specs/pathing.md gives,
// which compares the checkpoint a unit is heading for before anything else.
//
// The same three units as `first`, at the same three checkpoints, at one distance
// and one health, so the two priorities are read off exactly the same yard and
// must answer with opposite ends of it. That is what makes this its own point: a
// build that has `first` right and `last` inverted, or wired to the same code,
// fails here and passes there.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  openYard,
  releaseUnit,
  type Harness,
} from "../harness";
import { firstShotTarget, standShooter } from "./scenario";

/** One place per unit, all the same distance from the shooter's centre. */
const PLACES = [
  { waypoint: 2, at: { x: 0, y: -60 } },
  { waypoint: 4, at: { x: 60, y: 0 } },
  { waypoint: 6, at: { x: 0, y: 60 } },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("shoots the unit heading for the nearest checkpoint", async () => {
  openYard(h, { wave: 1 });
  const shooter = standShooter(h, "last");

  const posed: { waypoint: number; id: number }[] = [];
  for (const place of PLACES) {
    posed.push({
      waypoint: place.waypoint,
      id: releaseUnit(h, "dynamo", {
        waypoint: place.waypoint,
        at: { x: shooter.cx + place.at.x, y: shooter.cy + place.at.y },
        frozen: true,
      }),
    });
  }

  const target = await captureReplay(h, "last", () => firstShotTarget(h));

  const least = posed.reduce((a, b) => (a.waypoint < b.waypoint ? a : b));
  assertEqual(
    target,
    least.id,
    `the unit heading for checkpoint ${least.waypoint}, the least far along of ` +
      `the three in range (specs/components.md)`,
  );
});
