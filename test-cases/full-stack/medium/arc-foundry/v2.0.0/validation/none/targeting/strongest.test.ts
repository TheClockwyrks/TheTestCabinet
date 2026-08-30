// targeting/strongest — `strongest` shoots whatever carries the most health.
//
// specs/components.md fixes it: `strongest` "Selects the in-range unit that is
// Carrying the most remaining health". Remaining health, not maximum, so the three
// units here are all Dynamos and are posed to three different remaining figures
// with `setUnitHp`, which "never changes the maximum, so the unit stays the same
// type at the same wave scaling".
//
// They are held at one distance and at one checkpoint, so neither the geometry nor
// the chain can separate them and no tie-break is in play: the health is the only
// thing that differs, and it is the only thing that can pick one out.

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

it("shoots the unit with the most remaining health", async () => {
  await openYard(h, { wave: 1 });
  const shooter = await standShooter(h, "strongest");

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

  const target = await captureReplay(h, "strongest", () => firstShotTarget(h));

  const most = posed.reduce((a, b) => (a.hp > b.hp ? a : b));
  assertEqual(
    target,
    most.id,
    `the unit carrying ${most.hp} health, the most of the three in range ` +
      `(specs/components.md)`,
  );
});
