// modes/bottleneck-zone-reported — Bottleneck marks the central zone the
// specification names, and both corridors run through it.
//
// THE RULE. specs/modes.md, Bottleneck: "Bottleneck restricts building to a marked
// central zone, `BOTTLENECK_ZONE`: columns `13` through `36` and rows `8` through
// `27`, both ends included", and "the zone spans both straight vent-to-exhaust
// corridors". Its table says the same in the Build zone column. The zone is read
// back as `buildZone`, which specs/instrumentation.md lists among the derived fields
// that follow `setMode` with no other operation, and surface.ts fixes its spelling:
// `{ col0, row0, col1, row1 }`, "Inclusive on both ends; `null` off Bottleneck".
//
// FOUR EDGES, READ ONE AT A TIME. A zone reported one column short on the right is a
// different defect from one reported one row low at the top, and a player feels them
// differently — the first takes tiles away from the buildable middle, the second
// shifts the whole band. Reading each edge on its own is what lets a failure name
// which. The figures are read from `BOTTLENECK_ZONE` in `src/constants.ts`, the
// module the case SEEDS and the build is told not to edit, so they are the ones the
// build was handed, and the assertions are exact: whole tile indices a specification
// fixes outright, with no tolerance on them.
//
// THE CORRIDORS ARE THE SPECIFICATION'S SECOND SENTENCE, READ OFF THE BUILD'S OWN
// REPORT. specs/floor.md opens the left vent and the right exhaust on rows `16`
// through `19`, and the top vent and the bottom exhaust on columns `22` through
// `29`, so the two straight vent-to-exhaust corridors are the band of rows `16..19`
// and the band of columns `22..29`. A zone the surge's straight way never touches
// would be a zone no tower built inside could ever defend — the mode would have no
// teeth — so this is a real property and not a restatement, and it is asserted
// against the zone the build reported rather than against the specified one. On a
// conformant build it holds; on a build whose zone has drifted off the corridors it
// is the reading that says WHY the drift matters, beside the edges that say by how
// much.
//
// NOTHING BUT THE MODE IS POSED before the reading, because specs/modes.md derives
// the zone from the mode alone. The floor is drawn afterwards, so the still a
// reviewer opens is the zone the build marked on it (modes/run.ts).

import { afterEach, beforeEach, it } from "vitest";
import {
  BOTTLENECK_ZONE,
  LEFT_VENT_ROWS,
  RIGHT_EXHAUST_ROWS,
  TOP_VENT_COLS,
} from "../constants";
import { assertEqual, assertNotNull, assertTrue } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { drawOpening, poseMode } from "./run";

/** The mode this point reads. */
const MODE = "bottleneck";

/** A build zone as the snapshot reports it. */
type Zone = { col0: number; row0: number; col1: number; row1: number };

/** Whether any of `rows` lies inside the reported zone's row band. */
function coversARowOf(zone: Zone, rows: readonly number[]): boolean {
  return rows.some((row) => row >= zone.row0 && row <= zone.row1);
}

/** Whether any of `cols` lies inside the reported zone's column band. */
function coversAColumnOf(zone: Zone, cols: readonly number[]): boolean {
  return cols.some((col) => col >= zone.col0 && col <= zone.col1);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports columns 13 to 36 and rows 8 to 27, spanning both corridors", async () => {
  poseMode(h, MODE);
  const zone = h.snapshot().buildZone;

  await drawOpening(h);
  captureStill(h, "zone");

  assertNotNull(
    zone,
    "the buildZone Bottleneck derives, the mode restricting building to a " +
      "marked central zone (specs/modes.md, Bottleneck)",
  );
  const reported = zone as Zone;

  assertEqual(
    reported.col0,
    BOTTLENECK_ZONE.col0,
    "the first buildable column of the Bottleneck zone (specs/modes.md, Bottleneck)",
  );
  assertEqual(
    reported.col1,
    BOTTLENECK_ZONE.col1,
    "the last buildable column of the Bottleneck zone, both ends included " +
      "(specs/modes.md, Bottleneck)",
  );
  assertEqual(
    reported.row0,
    BOTTLENECK_ZONE.row0,
    "the first buildable row of the Bottleneck zone (specs/modes.md, Bottleneck)",
  );
  assertEqual(
    reported.row1,
    BOTTLENECK_ZONE.row1,
    "the last buildable row of the Bottleneck zone, both ends included " +
      "(specs/modes.md, Bottleneck)",
  );

  assertTrue(
    coversARowOf(reported, LEFT_VENT_ROWS) &&
      coversARowOf(reported, RIGHT_EXHAUST_ROWS),
    `the reported zone covering a row of the left vent-to-exhaust corridor, ` +
      `rows ${LEFT_VENT_ROWS[0]}-${LEFT_VENT_ROWS[LEFT_VENT_ROWS.length - 1]} ` +
      "(specs/modes.md, Bottleneck; specs/floor.md, The openings)",
  );
  assertTrue(
    coversAColumnOf(reported, TOP_VENT_COLS),
    `the reported zone covering a column of the top vent-to-exhaust corridor, ` +
      `columns ${TOP_VENT_COLS[0]}-${TOP_VENT_COLS[TOP_VENT_COLS.length - 1]} ` +
      "(specs/modes.md, Bottleneck; specs/floor.md, The openings)",
  );
});
