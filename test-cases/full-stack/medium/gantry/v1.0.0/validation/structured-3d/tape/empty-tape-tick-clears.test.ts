// tape/empty-tape-tick-clears — the tick that finds no step left, with every load
// placed, ends the run cleared.
//
// specs/program.md § The tick pipeline: "A tick that finds no live step and no
// step left to take is the tick the run ends on: cleared if every load is
// `placed`, otherwise failed as `loads-unplaced`." And: "The tape's last step is
// no different: the run ends at the top of the first tick that finds it complete
// and no step left to take, so a final action step's own tick runs in full and
// the tick after it is the one that ends the run."
//
// THE TAPE IS THE SHORTEST ONE THAT PLACES A LOAD: an `attach` on tick 1 and a
// `release` on tick 2, "two actions in a row occupy two ticks and never one". So
// tick 3 is the first tick that finds no step left, and it is the tick the run
// ends on — cleared, because the site's one load is `placed` by then.
//
// THE LOAD IS ALREADY ON ITS PAD, standing with its lift point at the hook and
// its target pose the pose it holds. That is what makes this a reading of the
// tape's ending rather than of a flight: the release is judged against
// specs/rigging.md's three tolerances and passes them all — no distance, no yaw
// difference, and a bob that has not moved — so the load is `placed` and what is
// left to decide is the tick after the last step.
//
// The yard holds that one load and nothing else, so "every load is placed" is a
// reading about the load this scenario placed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOIST_START } from "../constants";
import {
  addOneLoad,
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
} from "../harness";

/** The bare hook at a run's start: the track origin, `HOIST_START` below. */
const HOOK = { x: 0, y: 4 - HOIST_START, z: 0, yaw: 0 } as const;

/** Attach on tick 1, release on tick 2, so tick 3 finds no step left. */
const ENDING_TICK = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("clears the site on the tick that finds no step left with every load placed", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", 40, HOOK, HOOK);
  await poseTape(h, [
    { kind: "action", action: "attach" },
    { kind: "action", action: "release" },
  ]);
  await startRun(h);

  const last = await runTicks(h, 2);
  const ending = await runTicks(h, 1);

  await h.capture("state", "The run cleared on the tick after its last step");

  assertEqual(
    last.run.loads[0]?.phase,
    "placed",
    "the load's phase after the release on tick 2, which is what the ending " +
      "tick reads to clear the site (specs/rigging.md)",
  );
  assertEqual(
    last.run.phase,
    "running",
    "the run after tick 2: the tape's last step ran in full on its own tick, " +
      "and the tick after it is the one that ends the run (specs/program.md)",
  );

  assertEqual(
    ending.run.phase,
    "cleared",
    `the run on tick ${ENDING_TICK}, the first tick that finds no live step ` +
      "and no step left to take, with every load placed (specs/program.md)",
  );
  assertEqual(
    ending.run.tick,
    ENDING_TICK,
    "the tick the run ends on, which counts like any other (specs/program.md)",
  );
});
