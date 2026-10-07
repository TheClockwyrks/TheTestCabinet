// water/lane-rows — a freshly laid-out level carries eight water lanes, one on
// each row of the water band.
//
// specs/strait.md puts the water band on rows `WATER_TOP` (`2`) to
// `WATER_BOTTOM` (`9`), and specs/water.md says each row of that band is one
// lane and that `WATER_LANES` names the eight "in ascending row order".
// specs/instrumentation.md reports them as `waterLanes`, "the eight water lanes,
// rows 2..9 ascending", so the whole of this reading is the array's length and
// the row each entry carries, in the order they arrive.
//
// NOTHING IS POSED BUT THE LEVEL. The lanes are not something a scenario puts on
// the strait; they are what laying a level out produces (`setLevel` "lays the
// strait out for it"), so this check lays one out and reads what it got. It is
// read at the moment the layout happened, before a tick of lane motion has run.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
import { WATER_ROWS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { layOutLevel } from "./harness";

/** The level laid out. Level 1 is the level a run opens on (specs/progression.md). */
const LEVEL = 1;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("reports one water lane on each of rows 2 to 9, in ascending order", async () => {
  const laid = await layOutLevel(harness, LEVEL);
  await captureStill(harness, "scene");

  assertLength(
    laid.waterLanes,
    WATER_ROWS.length,
    "the water band is eight lanes, one per row (specs/water.md)",
  );
  assertDeepEqual(
    laid.waterLanes.map((lane) => lane.row),
    [...WATER_ROWS],
    "the rows the eight water lanes occupy, in the order they are reported",
  );

  // Nothing the page threw or logged as an error while this harness drove it.
  assertDeepEqual(harness.pageErrors, []);
});
