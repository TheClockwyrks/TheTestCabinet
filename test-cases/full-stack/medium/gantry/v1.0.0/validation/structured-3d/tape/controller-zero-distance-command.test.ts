// tape/controller-zero-distance-command — a command targeting the value its axis
// already holds moves nothing and is done on the tick it is issued.
//
// specs/program.md § Axis motion: "A command whose target is the axis's current
// value therefore has `s` of `0`: the axis neither brakes nor accelerates, it
// does not move, and step 3 finds it arrived, so the command is done on the tick
// it is issued."
//
// THE HOIST IS THE AXIS WITH A NAMED STARTING VALUE. Every run starts with
// `hoist` at `HOIST_START` (`2`) (§ The axes), so a command targeting
// `HOIST_START` is the zero-distance case exactly, with no pose needed to arrange
// it — and the rate it is given is a real one, the hoist's max, so nothing about
// the command itself is degenerate: what makes the tick do nothing is the
// distance, which is what this decides.
//
// One tick is driven, the tick the step is taken on. A build that ran the drive
// term with `s` of `0` would report a rate of `0` and an unmoved axis too, so the
// reading that separates it is the command: `s * (T - x) <= 0` holds at `0`, so
// step 3 finds the axis arrived and clears the command on this tick rather than
// leaving it live for a tick that can never move it.
//
// The yard is emptied and the tape carries this one step, so nothing else can
// have touched the axis.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("finishes a command targeting the axis's own value on the tick it is issued", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, [
    {
      kind: "move",
      commands: [{ axis: "hoist", target: HOIST_START, rate: HOIST_MAX_RATE }],
    },
  ]);
  const started = await startRun(h);

  const after = await runTicks(h, 1);

  await h.capture("state", "The hoist under a command it was already at");

  assertEqual(
    started.run.axes.hoist.value,
    HOIST_START,
    "the hoist at the run's start, which is the value the command targets " +
      "(specs/program.md)",
  );
  assertEqual(
    after.run.axes.hoist.value,
    HOIST_START,
    "the hoist's value after the tick that issued a command targeting it: " +
      "`s` is 0, so the axis does not move (specs/program.md)",
  );
  assertEqual(
    after.run.axes.hoist.rate,
    0,
    "the hoist's rate after that tick: it neither braked nor accelerated " +
      "(specs/program.md)",
  );
  assertNull(
    after.run.axes.hoist.command,
    "the hoist's command after that tick: step 3 finds it arrived, so it is " +
      "done on the tick it was issued (specs/program.md)",
  );
});
