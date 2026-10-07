// ice/lane-rows — a freshly laid-out level carries eight ice lanes, one on each
// row of the ice band.
//
// specs/strait.md puts the ice band on rows `ICE_TOP` (`11`) to `ICE_BOTTOM`
// (`18`), and specs/ice.md says each row of that band is one lane and that
// `ICE_LANES` names the eight "in ascending row order".
// specs/instrumentation.md reports them as `iceLanes`, "the eight ice lanes,
// rows 11..18 ascending", so the whole of this reading is the array's length and
// the row each entry carries, in the order they arrive.
//
// NOTHING IS POSED BUT THE LEVEL. The lanes are not something a scenario puts on
// the strait; they are what laying a level out produces — `setLevel(n)` "lays
// the sixteen lanes out for it" (specs/instrumentation.md) — so this check lays
// one out and reads what it got. It is read at the moment the layout happened,
// before a tick of lane motion has run.

import { afterEach, beforeEach, it } from "vitest";
import { ICE_LANES } from "../constants";
import { assertDeepEqual, assertLength } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { layOutLevel } from "./harness";

/** The level laid out. Level 1 is the level a run opens on (specs/progression.md). */
const LEVEL = 1;

/** The eight rows the ice band occupies, ascending (specs/ice.md's lane table). */
const ICE_ROWS = ICE_LANES.map((lane) => lane.row);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports one ice lane on each of rows 11 to 18, in ascending order", async () => {
  const laid = await layOutLevel(h, LEVEL);
  captureStill(h, "scene");

  assertLength(
    laid.iceLanes,
    ICE_ROWS.length,
    "the ice band is eight lanes, one per row (specs/ice.md)",
  );
  assertDeepEqual(
    laid.iceLanes.map((lane) => lane.row),
    ICE_ROWS,
    "the rows the eight ice lanes occupy, in the order they are reported",
  );
});
