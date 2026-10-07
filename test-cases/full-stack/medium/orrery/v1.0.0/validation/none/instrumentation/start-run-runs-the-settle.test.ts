// instrumentation/start-run-runs-the-settle — the boundary pass `startRun` runs
// before cycle 0.
//
// THE RULE. "`startRun()` | Runs the game's run-start sequence of
// `specs/simulation.md`: every arm and wheel at its rest pose holding nothing,
// every wheel's six fixtures placed, **the settle**, `sim.cycle` at `0`..."
// (`specs/instrumentation.md`, The run). And the sequence itself: "1. Every arm
// and wheel takes its rest pose, holding nothing, and every wheel's six fixtures
// appear on its spoke hexes. 2. The settle runs: one pass of the boundary sequence
// defined below, on a field holding only fixtures. 3. The cycle counter starts at
// `0` and the machine begins cycle `0`" (`specs/simulation.md`, The run).
//
// WHAT THE SETTLE IS READ THROUGH IS A RISE, because a rise is the one member of
// the boundary sequence that can act on a field holding nothing but fixtures: "the
// sigil phase, then sets, then rises, then the area bank, then the completion
// check", and of a rise, "When every footprint hex is vacant, the reagent appears:
// one new mote per pattern mote and one filament per pattern filament, at the
// placed pose, unheld" (`specs/sigils.md`). So a rise standing against an empty
// field has spawned its reagent by the time `startRun` returns.
//
// AND NO FRAME IS ADVANCED between the call and the reading, which is what makes
// the verdict about the SETTLE rather than about cycle `0`: the counters are still
// `0`, the run has only just opened, and the only thing that can have put a mote
// on the field is the boundary pass `startRun` ran itself.
//
// THE WORLD IS POSED, NOT SEARCHED. A posed challenge whose one reagent is a
// single mote, an empty machine, the completion switch held off, and exactly one
// part on the field: the rise. Nothing else can spawn, consume, bind or move
// anything, so the mote the snapshot reports is the reagent this rise raised.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNear,
  assertNotNull,
} from "../assert";
import { FRACTION_TOLERANCE } from "../constants";
import {
  captureStill,
  createHarness,
  holdCompletion,
  looseMotes,
  moteAt,
  openChallengeDocument,
  placeRise,
  type Harness,
} from "../harness";
import { BARE, ORIGIN } from "../fixtures";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("has run one boundary pass, so the rise's reagent is on the field before cycle 0 begins", async () => {
  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();
  await holdCompletion(h);
  await placeRise(h, 0, ORIGIN, 0);

  await h.debug.startRun();
  const settled = await h.snapshot();

  await h.advance(1);
  await captureStill(h, "settled");

  assertNotNull(settled.sim, "startRun opens a run");
  assertEqual(settled.sim?.cycle, 0, "the cycle counter starts at 0");
  assertNear(
    settled.sim?.fraction ?? -1,
    0,
    FRACTION_TOLERANCE,
    "the run opens at the start of cycle 0",
  );

  const raised = moteAt(settled, ORIGIN);
  assertNotNull(
    raised,
    "the settle ran one pass of the boundary sequence, so the rise standing against an empty field has spawned its reagent",
  );
  assertEqual(
    raised?.type,
    BARE.reagents[0]?.motes[0]?.type,
    "the reagent that appeared is the challenge's, one new mote per pattern mote",
  );
  assertLength(
    looseMotes(settled),
    1,
    "the challenge's one reagent is one mote, and nothing else is on the field to have spawned another",
  );
});
