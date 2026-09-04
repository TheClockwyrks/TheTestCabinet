// controls/tape-editor-removes-a-step — a step removed from the middle of the
// tape goes, and the steps around it keep their order.
//
// `specs/controls.md` § Editing the tape: "what the player can do is fixed: add a
// step, a move or an action; ... edit, reorder, and remove existing steps; and
// read the whole tape in order. Every edit is reflected in the state's program
// (`specs/state.md`)." `specs/instrumentation.md` § The tape gives the pose that
// stands for that edit: "`removeStep(index)` Removes the step at `index`."
//
// THE STEP REMOVED IS THE MIDDLE ONE, which is the whole point: a build that
// removed the last step, or that removed the right step but left the survivors
// renumbered or reordered, reads correctly on a one-step tape and wrongly here.
// The two survivors are told apart by their axes — `slew` first, `hoist` last —
// so the reading says which of them is where rather than only how many are left.
//
// The tape is emptied first so the three steps are the whole of it and index `1`
// names the step this validator wrote there. Every rate is the axis's own maximum
// and every target is an ordinary value, so the editor accepts each step as
// written (`specs/program.md`: a rate "greater than `0`" and "at most the axis's
// max rate"; "Targets are accepted as written").
//
// The screen is taken to `program` with `setScreen`, which "shows a named screen
// and sets nothing else", rather than by pressing the `program` action on the
// way: that binding is its own review point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { HOIST_MAX_RATE, SLEW_MAX_RATE } from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** The index of the action step written between the two moves. */
const MIDDLE = 1;

/** The first survivor: a slew move, told apart by its axis and target. */
const FIRST = { axis: "slew", target: 90, rate: SLEW_MAX_RATE } as const;

/** The last survivor: a hoist move, told apart by its axis and target. */
const LAST = { axis: "hoist", target: 6, rate: HOIST_MAX_RATE } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes the middle step and leaves the others in order", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.setScreen("program");
  await h.debug.addMoveStep(FIRST.axis, FIRST.target, FIRST.rate);
  await h.debug.addActionStep("attach");
  await h.debug.addMoveStep(LAST.axis, LAST.target, LAST.rate);
  await h.advance(1);
  assertLength(
    (await h.snapshot()).program,
    3,
    "the three steps the tape carries before one is removed",
  );

  await h.debug.removeStep(MIDDLE);
  await h.advance(1);

  const { program } = await h.snapshot();
  assertLength(
    program,
    2,
    `the steps the tape carries after step ${MIDDLE} was removed ` +
      "(specs/controls.md § Editing the tape)",
  );
  const first = program[0];
  assertEqual(
    first?.kind === "move" ? first.commands[0]?.axis : first?.kind,
    FIRST.axis,
    "the axis the first surviving step commands, which is the step that " +
      "stood before the removed one (specs/controls.md § Editing the tape)",
  );
  const last = program[1];
  assertEqual(
    last?.kind === "move" ? last.commands[0]?.axis : last?.kind,
    LAST.axis,
    "the axis the second surviving step commands, which is the step that " +
      "stood after the removed one (specs/controls.md § Editing the tape)",
  );

  await h.capture("state", "the tape with its middle step removed");
});
