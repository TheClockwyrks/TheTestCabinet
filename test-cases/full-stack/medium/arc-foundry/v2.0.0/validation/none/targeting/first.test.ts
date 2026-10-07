// targeting/first — `first` shoots whatever is furthest along the chain.
//
// specs/components.md fixes it: `first` "Selects the in-range unit that is
// Furthest along the chain, by the progress ordering of specs/pathing.md", and
// specs/pathing.md fixes that ordering: "compared first by the index of the
// checkpoint the unit is heading for, and then, among units heading for the same
// checkpoint, by the remaining length of that unit's route to it, shorter first".
//
// Three units are held in range at three different checkpoints, which is the
// ordering's first term and settles it outright, so this suite reads the priority
// rather than a tie-break. They stand at one distance from the shooter and carry
// one health between them, so neither `nearest` nor `strongest` nor `weakest`
// could pick out the unit `first` must — a build that ignores the setting and
// shoots by some other rule cannot pass by luck.

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

afterEach(async () => {
  await h.dispose();
});

it("shoots the unit heading for the furthest checkpoint", async () => {
  await openYard(h, { wave: 1 });
  const shooter = await standShooter(h, "first");

  const posed: { waypoint: number; id: number }[] = [];
  for (const place of PLACES) {
    posed.push({
      waypoint: place.waypoint,
      id: await releaseUnit(h, "dynamo", {
        waypoint: place.waypoint,
        at: { x: shooter.cx + place.at.x, y: shooter.cy + place.at.y },
        frozen: true,
      }),
    });
  }

  const target = await captureReplay(h, "first", () => firstShotTarget(h));

  const furthest = posed.reduce((a, b) => (a.waypoint > b.waypoint ? a : b));
  assertEqual(
    target,
    furthest.id,
    `the unit heading for checkpoint ${furthest.waypoint}, the furthest along ` +
      `of the three in range (specs/components.md)`,
  );
});
