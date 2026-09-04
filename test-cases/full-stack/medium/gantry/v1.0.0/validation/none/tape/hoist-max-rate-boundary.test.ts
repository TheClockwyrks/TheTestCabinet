// tape/hoist-max-rate-boundary — the tape editor accepts a hoist command at
// HOIST_MAX_RATE and refuses one above it.
//
// `specs/program.md` § The axes gives the `hoist` row a max rate of
// `HOIST_MAX_RATE` (`4`) u/s, and § The tape gives the rule it bounds: "The
// tape editor
// accepts a command only with a rate greater than `0` and at most the axis's max
// rate, and a move only with at least one command."
//
// BOTH SIDES OF THE ONE BOUND, IN ONE CHECK, because they are one edge case read
// twice: "at most" makes `4` acceptable and anything above it not, so a
// build that made the comparison strict refuses the first, and one that left the
// rate unchecked, or clamped it instead of refusing, takes the second. The rejected
// rate is half again the bound, well clear of any arithmetic a conforming
// build does with the figure.
//
// THE REFUSAL IS SILENT, so it is read as a length. `specs/instrumentation.md`
// has a pose that the game would refuse do nothing at all, and
// `specs/program.md` gives the editor no other answer, so what says the command
// was refused is that the tape did not grow. The tape is emptied first, and the
// two calls are made in that order, so the reading after each is unambiguous:
// nothing, then exactly one step carrying the accepted rate.
//
// THE CALLS GO STRAIGHT TO THE EDITOR'S OWN OPERATION. `poseTape` would fail the
// check on a refusal, which is the outcome half this point is about, so
// `addMoveStep` is called directly on the program screen — where
// `specs/instrumentation.md` says the tape poses apply.
//
// The world is otherwise empty: a tape is edited on its own and this point
// concerns no crane, no load and no run.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { HOIST_MAX_RATE } from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** Half again the bound: above the bound, and nowhere near a rounding of it. */
const OVER = 6;

/** The target the command carries; this point is about the rate alone. */
const TARGET = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes a hoist command at HOIST_MAX_RATE and refuses one above it", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.setScreen("program");

  await h.debug.addMoveStep("hoist", TARGET, OVER);
  const refused = await h.snapshot();
  assertLength(
    refused.program,
    0,
    `the steps the tape holds after a hoist command at rate ${OVER}, above ` +
      `HOIST_MAX_RATE (${HOIST_MAX_RATE}) (specs/program.md)`,
  );

  await h.debug.addMoveStep("hoist", TARGET, HOIST_MAX_RATE);
  const accepted = await h.snapshot();
  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  assertLength(
    accepted.program,
    1,
    `the steps the tape holds after a hoist command at rate ${HOIST_MAX_RATE}, ` +
      "which is HOIST_MAX_RATE and is accepted (specs/program.md)",
  );
  const step = accepted.program[0];
  assertEqual(step?.kind, "move", "the kind of the step the editor appended");
  if (step?.kind === "move") {
    assertLength(step.commands, 1, "the commands that step carries");
    assertEqual(
      step.commands[0]?.axis,
      "hoist",
      "the axis the accepted command names",
    );
    assertEqual(
      step.commands[0]?.rate,
      HOIST_MAX_RATE,
      "the rate the accepted command carries (specs/program.md)",
    );
  }
});
