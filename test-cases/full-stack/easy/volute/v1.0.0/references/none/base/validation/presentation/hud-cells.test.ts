// presentation/hud-cells — the HUD draws the produced cell icon once for each
// cell remaining.
//
// THE REQUIREMENT. `specs/ui.md` — "The HUD": "Cells | The cells remaining, as
// one produced cell icon per cell". `specs/assets.md` fixes the file: "HUD cell
// icon | 24 x 24", one of the two produced icons the HUD carries.
//
// THE DRIVE. A run opens with three cells (`specs/progression.md`: "A run starts
// with 3 cells"), and one core is posed 20 units short of the intake with the
// inlet stopped. "A core whose arc position `s` reaches 5000 arrives at the
// intake and spends a cell", which leaves two, empties the channel, and opens a
// `setback` interlude of 2 s before the same level restarts. The count is read
// on `playing` at each end of that — three cells before the arrival, two after
// the interlude — because the requirement is about what the HUD shows DURING
// PLAY, and reading it on the `setback` screen would be reading the interlude's
// own copy as well, which `specs/ui.md` also has showing "how many cells remain".
//
// HOW THE CELL ICON IS TOLD FROM THE PRESSURE ICON. Not by a path — the bundler
// inlines a 24 x 24 PNG as a `data:` URI — and not by its size, since
// `specs/assets.md` gives both HUD icons the same 24 x 24 canvas. By what the
// requirement itself says: the cell icon is the produced icon whose draws COUNT
// the cells, so it is the 24 x 24 source drawn three times while three cells
// remain and twice once one is spent. A gauge's own icon is drawn once whatever
// the cells are doing, so it is never that source.
//
// THE BOUND. Exact counts, both times. `specs/ui.md` says one icon per cell, so
// there is nothing to put a tolerance on: a build that draws a dimmed icon for a
// spent cell draws three at two cells and fails, which is the miss the point is
// for.

import { afterEach, beforeEach, it } from "vitest";
import { CELLS, INTAKE_S } from "../constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  poseHall,
  type Harness,
} from "../harness";
import { drawCounts, hudIconDraws } from "./readouts";

/** How far short of the intake the one core is posed. */
const SHORT_OF_INTAKE = 20;

/** The cells left once one arrival has spent one. */
const AFTER_SPEND = CELLS - 1;

/** Ticks allowed for the arrival, and for the interlude that follows it. */
const ARRIVAL_TICKS = 300;
const INTERLUDE_TICKS = 300;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws one produced cell icon for each cell remaining", async () => {
  await poseHall(h, {
    level: 1,
    cores: [[INTAKE_S - SHORT_OF_INTAKE, "halide", null]],
  });

  const full = await h.frameCalls();
  const opened = await h.snapshot();
  assertEqual(opened.cells, CELLS, "the cells a fresh run carries");
  const atFull = drawCounts(hudIconDraws(full));

  const spent = await h.stepUntil((snapshot) => snapshot.cells < CELLS, {
    maxTicks: ARRIVAL_TICKS,
    poll: 1,
  });
  assertTrue(spent.hit, "the intake spending a cell within five seconds");
  assertEqual(spent.snapshot.cells, AFTER_SPEND, "the cells one arrival left");

  const resumed = await h.stepUntil(
    (snapshot) => snapshot.screen === "playing",
    {
      maxTicks: INTERLUDE_TICKS,
      poll: 1,
    },
  );
  assertTrue(resumed.hit, "the level restarting after the setback interlude");

  const short = await h.frameCalls();
  await captureStill(h, "hud");
  const atShort = drawCounts(hudIconDraws(short));

  const counted = [...atFull.entries()].filter(
    ([id, drawn]) => drawn === CELLS && atShort.get(id) === AFTER_SPEND,
  );
  assertTrue(
    counted.length > 0,
    `a produced 24 x 24 icon drawn ${CELLS} times at ${CELLS} cells and ${AFTER_SPEND} times at ${AFTER_SPEND}`,
  );
});
