// targeting/weakest — `weakest` shoots whatever carries the least health.
//
// specs/components.md fixes it: `weakest` "Selects the in-range unit that is
// Carrying the least remaining health". This is the other direction of
// `strongest`, and its own point for the same reason `last` is `first`'s: a build
// that has one right and the other inverted, or wired to the same code, must grade
// differently from one that has both.
//
// The same three units on the same yard as `strongest`, posed to the same three
// healths at one distance and one checkpoint, so the two priorities are read off
// an identical arrangement and must answer with opposite ends of it.

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

/** Three healths, all under a Dynamo's maximum at wave 1, at one distance. */
const PLACES = [
  { hp: 200, at: { x: 0, y: -60 } },
  { hp: 100, at: { x: 60, y: 0 } },
  { hp: 300, at: { x: 0, y: 60 } },
];

/** The checkpoint all three head for, so the chain cannot separate them. */
const WAYPOINT = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shoots the unit with the least remaining health", async () => {
  await openYard(h, { wave: 1 });
  const shooter = await standShooter(h, "weakest");

  const posed: { hp: number; id: number }[] = [];
  for (const place of PLACES) {
    posed.push({
      hp: place.hp,
      id: await releaseUnit(h, "dynamo", {
        waypoint: WAYPOINT,
        at: { x: shooter.cx + place.at.x, y: shooter.cy + place.at.y },
        hp: place.hp,
        frozen: true,
      }),
    });
  }

  const target = await captureReplay(h, "weakest", () => firstShotTarget(h));

  const least = posed.reduce((a, b) => (a.hp < b.hp ? a : b));
  assertEqual(
    target,
    least.id,
    `the unit carrying ${least.hp} health, the least of the three in range ` +
      `(specs/components.md)`,
  );
});
