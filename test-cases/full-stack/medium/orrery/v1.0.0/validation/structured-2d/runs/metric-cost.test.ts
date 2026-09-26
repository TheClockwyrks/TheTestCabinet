// runs/metric-cost — what a finished run records as `cost` is what the editor
// charged for the machine.
//
// THE RULE. The metric table of `specs/simulation.md` (Completion and metrics)
// gives `cost` as "The machine's cost, as `specs/parts.md` computes it", and
// `specs/parts.md` computes it in one line: "A machine's cost is the sum of its
// placed parts' costs", against the `PART_COSTS` table — `arm` `20`, `bind` `10`,
// `track` "`5` per cell", and `0` for a `rise` and a `set`.
//
// THE CONFIGURATION is a machine whose cost is a figure a reader can add up: one
// `arm` (`20`), one `bind` (`10`), and a three-cell `track` (`3 x 5 = 15`), which
// is `45`. The `set` that lets the run finish at all is priced at `0`, so it
// changes the sum by nothing and the machine still records `45`; the challenge
// asks for a `target` of `1`, so one delivery completes it and the cost is
// recorded after a single cycle. The three priced parts are laid well apart, none
// of them touching the others, and nothing on the machine has a tape.
//
// THE VERDICT is `45` three times over: the figure `PART_COSTS` gives for these
// parts, the `editor.cost` the snapshot derives before the run, and the `cost` the
// completed run recorded. The first of the three is what keeps this from
// asserting the reference's arithmetic back at itself — it is computed here from
// `specs/parts.md`'s own table, over the machine document the check placed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { at } from "../field";
import { armPart, setPart, sigilPart, solution, trackPart } from "../formats";
import { ONE_DELIVERY, ORIGIN } from "../fixtures";
import { machineCost } from "../parts";
import {
  advanceCycles,
  captureStill,
  createHarness,
  openRun,
  spawnMote,
  type Harness,
} from "../harness";

/** The three-cell open track, west of everything else. */
const TRACK = [at(-3, 0), at(-2, 0), at(-1, 0)];

/**
 * One arm (20), one bind (10) and a three-cell track (15) — 45 — plus the set
 * (0) the run needs to finish at all.
 */
const MACHINE = solution([
  armPart("arm", 0, -3, 0, 1, []),
  sigilPart("bind", 2, 0, 0),
  trackPart(TRACK),
  setPart(0, ORIGIN.q, ORIGIN.r),
]);

/** What `PART_COSTS` charges for this machine: 20 + 10 + 3 x 5 + 0. */
const COST = 45;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("records the sum of PART_COSTS over the placed parts, a track counting five per cell", async () => {
  assertEqual(
    machineCost(MACHINE.parts),
    COST,
    "specs/parts.md prices this machine at 45: one arm, one bind and a three-cell track",
  );

  await openRun(h, { challenge: ONE_DELIVERY, machine: MACHINE });

  const before = await h.snapshot();
  assertEqual(
    before.editor.parts.length,
    MACHINE.parts.length,
    "the machine on the field is the machine the check placed",
  );
  assertEqual(
    before.editor.cost,
    COST,
    "the editor charges PART_COSTS over the placed parts",
  );

  await spawnMote(h, ORIGIN, "sol");
  await advanceCycles(h, 1);
  await captureStill(h, "cost");

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "complete",
    "the delivery reached the target of 1, so the metrics were recorded",
  );
  assertNotNull(
    after.sim?.metrics ?? null,
    "a completed run records its metrics",
  );
  assertEqual(
    after.sim?.metrics?.cost,
    COST,
    "the recorded cost is the machine's cost",
  );
});
