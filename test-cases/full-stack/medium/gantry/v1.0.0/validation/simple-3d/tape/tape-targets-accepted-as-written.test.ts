// tape/tape-targets-accepted-as-written — the editor takes a target the crane
// standing at the time cannot reach.
//
// specs/program.md § The tape: "Targets are accepted as written: whether a target
// is reachable depends on the structure, so it is judged when the step starts."
// The trolley is the axis where that matters, since "its upper bound is the
// track's current length" — an editor that judged a trolley target against the
// crane on screen would refuse a tape the player is about to build the track for,
// and would refuse it silently.
//
// THE CRANE IS THE ONE THAT MAKES THE TARGET UNREACHABLE. The minimal crane's
// track is its single rail member, from `(0, 4, 0)` to `(4, 4, 0)`: `4` units
// long, so `0` to `4` is the whole of the trolley's range at this moment and a
// target of `12` is three times past its far end. The command is still accepted
// as written, and the target the tape reports back is `12` exactly rather than a
// value clamped to the track.
//
// The rate is the trolley's max rate, which the editor does judge, so nothing but
// the target is in question. The yard is emptied and the tape cleared first, so
// the step read back is the only one on the tape; no run is started, because the
// judgement this point excludes belongs to the editor and not to a run.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { TROLLEY_MAX_RATE } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  standMinimalCrane,
  type Harness,
} from "../harness";

/** Three times past the far end of the minimal crane's four-unit track. */
const TARGET = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("accepts a trolley target beyond the standing crane's track", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await h.debug.setScreen("program");

  await h.debug.addMoveStep("trolley", TARGET, TROLLEY_MAX_RATE);
  const program = (await h.snapshot()).program;

  await h.advance(1);
  await h.capture(
    "program",
    "The tape carrying a trolley target past the track's far end",
  );

  assertLength(
    program,
    1,
    "the steps on the tape after a trolley command targeting 12 on a crane " +
      "whose track is 4 long, which the editor accepts as written " +
      "(specs/program.md)",
  );
  const step = program[0];
  assertEqual(step?.kind, "move", "the kind of the step the tape carries");
  if (step?.kind === "move") {
    assertEqual(step.commands[0]?.axis, "trolley", "the axis commanded");
    assertEqual(
      step.commands[0]?.target,
      TARGET,
      "the target the tape carries, as written rather than held to the " +
        "track the crane has now (specs/program.md)",
    );
  }
});
