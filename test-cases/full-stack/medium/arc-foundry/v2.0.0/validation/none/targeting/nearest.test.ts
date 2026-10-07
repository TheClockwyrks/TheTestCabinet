// targeting/nearest — `nearest` shoots whatever is closest.
//
// specs/components.md fixes it: `nearest` "Selects the in-range unit that is At the
// shortest straight-line distance from the structure's center", whatever their
// positions along the chain.
//
// Three units are held at three distinct distances inside the radius, at one
// health, and at one checkpoint, so nothing but the distance can separate them and
// no tie-break is in play. The closest is not the one furthest along, because all
// three share a checkpoint and the tie-break never fires — so a build that quietly
// falls back on the chain ordering picks the wrong one.

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

/** Three distinct distances, all inside the Scrap Capacitor's `100`. */
const PLACES = [
  { away: 90, at: { x: -90, y: 0 } },
  { away: 40, at: { x: 40, y: 0 } },
  { away: 65, at: { x: 0, y: 65 } },
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

it("shoots the unit at the shortest straight-line distance", async () => {
  await openYard(h, { wave: 1 });
  const shooter = await standShooter(h, "nearest");

  const posed: { away: number; id: number }[] = [];
  for (const place of PLACES) {
    posed.push({
      away: place.away,
      id: await releaseUnit(h, "dynamo", {
        waypoint: WAYPOINT,
        at: { x: shooter.cx + place.at.x, y: shooter.cy + place.at.y },
        frozen: true,
      }),
    });
  }

  const target = await captureReplay(h, "nearest", () => firstShotTarget(h));

  const closest = posed.reduce((a, b) => (a.away < b.away ? a : b));
  assertEqual(
    target,
    closest.id,
    `the unit standing ${closest.away} from the centre, the closest of the ` +
      `three in range (specs/components.md)`,
  );
});
