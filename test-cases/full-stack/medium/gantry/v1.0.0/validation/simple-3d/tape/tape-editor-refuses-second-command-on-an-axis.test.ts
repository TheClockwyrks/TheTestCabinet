// tape/tape-editor-refuses-second-command-on-an-axis — a move step carries at
// most one command per axis.
//
// specs/program.md § The tape: "A move: one or more commands, at most one per
// axis." So a second command on an axis the step already commands is refused, and
// the step keeps the command it had — an editor that replaced it, or that let two
// commands sit on one axis, would leave a step whose axis has two targets and no
// order to reach them in.
//
// The step is read back whole rather than only counted: the requirement is that
// the command already there is the one that survives, so its axis, its target and
// its rate are all held against what the accepted edit asked for. The refused
// command names a different target (`45` against `90`) so a step that quietly
// took the second one over the first is caught by the target rather than by the
// count alone.
//
// The world is cleared first so the step under test is the tape's only step and
// carries index `0`, which is the index `addCommand` is given. Nothing is built
// and no run is started: this is an edit-time rule and neither takes part in it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { SLEW_MAX_RATE } from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** The command the step is built with, and the one it must keep. */
const KEPT = { target: 90, rate: SLEW_MAX_RATE };

/** The second command on the same axis, which the editor refuses. */
const REFUSED = { target: 45, rate: SLEW_MAX_RATE };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses a second command on an axis the step already commands", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.setScreen("program");

  await h.debug.addMoveStep("slew", KEPT.target, KEPT.rate);
  await h.debug.addCommand(0, "slew", REFUSED.target, REFUSED.rate);
  const program = (await h.snapshot()).program;

  await h.advance(1);
  await h.capture(
    "program",
    "The step that kept its one slew command after a second was refused",
  );

  assertLength(program, 1, "the steps on the tape");
  const step = program[0];
  assertEqual(step?.kind, "move", "the kind of the step the tape carries");
  if (step?.kind === "move") {
    assertLength(
      step.commands,
      1,
      "the commands the step carries, since a move carries at most one per " +
        "axis (specs/program.md)",
    );
    assertEqual(step.commands[0]?.axis, "slew", "the axis the command names");
    assertEqual(
      step.commands[0]?.target,
      KEPT.target,
      "the target the step's slew command keeps, which is the accepted " +
        "command's and not the refused one's (specs/program.md)",
    );
    assertEqual(
      step.commands[0]?.rate,
      KEPT.rate,
      "the rate the step's slew command keeps",
    );
  }
});
