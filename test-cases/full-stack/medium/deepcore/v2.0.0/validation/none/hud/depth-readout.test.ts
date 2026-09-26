// hud/depth-readout — the bar states the depth in meters.
//
// `specs/ui.md`: the status bar shows the depth in meters. `specs/world.md` fixes
// the figure — a miner whose feet rest at world `y` is at
// `max(0, (y - SURFACE_Y) / TILE * METERS_PER_ROW)` meters — and
// `specs/instrumentation.md` requires the snapshot to report the same figure as
// `depthMeters`. So the bar is asked for the figure the snapshot reports, at two
// depths a long way apart, and the whole-meter reading is what is looked for
// because how many decimals a build shows is the build's.
//
// The miner stands on a floor laid at each row rather than falling to it, so what
// is read is the depth of a settled miner and no frame of the descent.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PLAYABLE_COL_MIN } from "../constants";
import {
  captureStill,
  createHarness,
  layFloor,
  openScene,
  pinDrill,
  standOn,
  type Harness,
} from "../harness";
import { barText, statesNumber } from "./bar";

/** Two rows a long way apart, both inside the Standard mine. */
const ROWS = [41, 101] as const;

const COL = PLAYABLE_COL_MIN + 8;

/** Whole meters either way, because a build may round or truncate the figure. */
const SLACK = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("states the depth the snapshot reports, at two depths", async () => {
  await openScene(h);
  await pinDrill(h);

  const stated: string[] = [];
  const wanted: string[] = [];
  for (const row of ROWS) {
    await layFloor(h, row);
    await standOn(h, COL, row);
    const { depthMeters } = await h.snapshot();
    wanted.push(`${Math.round(depthMeters)} m: true`);
    stated.push(
      `${Math.round(depthMeters)} m: ${statesNumber(await barText(h), depthMeters, SLACK)}`,
    );
  }
  await captureStill(h, "depth");

  assertEqual(stated.join(", "), wanted.join(", "), "specs/ui.md");
});
