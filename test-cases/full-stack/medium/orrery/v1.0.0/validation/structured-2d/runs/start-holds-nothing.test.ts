// runs/start-holds-nothing — a run opens with every gripper open, whatever the
// last one was left holding.
//
// THE RULE. "Starting a run: 1. Every arm and wheel takes its rest pose, holding
// nothing" (`specs/simulation.md`, The run), which `specs/instrumentation.md`
// restates under `startRun`: "every arm and wheel at its rest pose holding
// nothing". `sim.grips` is where a hold shows: "one entry per holding gripper:
// the part, the spoke direction the gripper currently sits on, and the mote at
// the gripper" (`specs/state.md`), so a run holding nothing reports no entries at
// all. That the hold cannot simply have survived is the run-stop rule: "Stopping
// a run ... discards the motes and every runtime pose" (`specs/simulation.md`).
//
// THE CONFIGURATION. One arm at the origin, rotation `0`, length `1`, with an
// empty tape, and one mote on the hex its single gripper rests on. Nothing else
// is on the field, so the only grip there can be is the one this check gives.
//
// HOW THE FIRST RUN IS LEFT HOLDING. Through the faculty gate
// `specs/instrumentation.md` names for a gripper's hold — "`setGrip`, which takes
// hold with no `grab` ever running" — so no cycle runs, nothing moves, and the
// hold is the only thing about the first run that differs from a fresh one. The
// hold is read back before the run is stopped, so a second run that reports no
// grips is reporting a hold that was really there.
//
// THE VERDICT. On the second run `sim.grips` is empty and `sim.cycle` is `0`:
// the run has opened, and it has opened holding nothing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import { at } from "../field";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  heldBy,
  openBareRun,
  partIds,
  spawnMote,
  stopRun,
  takeGrip,
  type Harness,
} from "../harness";

/** One arm, rotation `0`, length `1`: its one gripper rests on `(1, 0)`. */
const MACHINE = solution([armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, [])]);

/** The hex the arm's gripper rests on, and the spoke it sits on. */
const GRIPPER_HEX = at(1, 0);
const SPOKE = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the second run with no grip, whatever the first one ended up holding", async () => {
  await openBareRun(h, { challenge: BARE, machine: MACHINE });
  const arm = (await partIds(h))[0] ?? -1;

  const mote = await spawnMote(h, GRIPPER_HEX, "sol");
  await takeGrip(h, arm, SPOKE, mote);

  const holding = await h.snapshot();

  await stopRun(h);
  await h.debug.startRun();
  await h.advance(1);
  await captureStill(h, "open");

  const opened = await h.snapshot();
  assertNotNull(
    holding.sim,
    "the first run is live, which is what a grip can be given on",
  );
  assertEqual(
    heldBy(holding, arm, SPOKE),
    mote,
    "the first run really ends up holding the mote, so the second run has a hold to have cleared",
  );
  assertNotNull(opened.sim, "the second run is live");
  assertLength(
    opened.sim?.grips ?? [],
    0,
    "a run starts with every gripper open, so sim.grips is empty",
  );
  assertEqual(
    opened.sim?.cycle,
    0,
    "the reading is taken at cycle 0, before any cycle of the second run has run",
  );
});
