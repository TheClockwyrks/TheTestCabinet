// load/roster-speed — each Load type travels at the speed its roster row gives.
//
// `specs/enemies.md`'s roster fixes a speed per type: a Mote walks at `60`, a
// Spark at `120`, a Slug at `38`, a Cluster at `72`, a Filament at `85`, a Dynamo
// at `30`. `specs/instrumentation.md` reports both figures a unit carries —
// `baseSpeed`, "the roster speed", and `speed`, "current speed, after any slow" —
// and both are read, because a build that scaled one and not the other reports a
// unit that walks at a figure the roster never gave.
//
// READ OFF A UNIT THAT IS TRAVELLING, because the roster's speed is what a unit
// MOVES at: a held unit is not one that is moving, and a build that reported a
// figure it never walks at would pass a reading taken at the spawn. Each type is
// released alone on an empty yard and removed before the next, so nothing else is
// on the yard while it is read.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { LOAD_ROSTER } from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  type Harness,
} from "../harness";
import { travellingFor } from "./vitals";

/** The tolerance a speed is read to: six decimal places. */
const PLACES = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves each roster type at its roster speed", async () => {
  await openYard(h, { wave: 1 });

  for (const def of LOAD_ROSTER) {
    const moving = await travellingFor(h, def.type);
    await captureStill(h, "speed");
    assertCloseTo(
      moving.baseSpeed,
      def.speed,
      PLACES,
      `a ${def.type}'s roster speed`,
    );
    assertCloseTo(
      moving.speed,
      def.speed,
      PLACES,
      `a ${def.type} carrying no slow moves at its roster speed`,
    );
  }
});
