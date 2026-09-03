// tape/tape-editor-refuses-rate-above-max — the tape editor takes a command at
// the axis's max rate and refuses one above it.
//
// specs/program.md § The tape: "The tape editor accepts a command only with a
// rate greater than `0` and at most the axis's max rate". The slew's max rate is
// `SLEW_MAX_RATE` (`30`) deg/s (§ The axes), so `31` is over the bound and `30`
// is the bound itself.
//
// BOTH VALUES EXERCISE THE ONE BOUND, from either side of it, which is why they
// share a validator: a build that took every rate and a build that took none both
// break the same rule, and only the pair tells them apart. The accepted rate is
// the bound exactly, so nothing between the two figures is being asserted — a
// build is free to hold the comparison in whatever form it likes as long as `30`
// is in and `31` is out.
//
// The world is emptied first — no loads, no obstacles, no structure, and above
// all no tape — so the step this reads is the one the refused edit either did or
// did not leave behind, and the tape length is a reading with one meaning.
// Nothing here starts a run: the editor's refusal is an edit-time rule, and the
// structure a run would need has nothing to do with it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { SLEW_MAX_RATE } from "../constants";
import { createHarness, openSite, type Harness } from "../harness";

/** Over the slew's max rate by one degree a second. */
const OVER = SLEW_MAX_RATE + 1;

/** Somewhere the slew can be told to go; the target is not what is judged. */
const TARGET = 90;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses a command above the axis's max rate and accepts one at it", async () => {
  await openSite(h, 0);
  // The precondition is an empty tape on the screen a tape edit applies on, and
  // nothing else: the structure and the yard decide no refusal here.
  await h.debug.setScreen("program");
  await h.debug.clearProgram();

  await h.debug.addMoveStep("slew", TARGET, OVER);
  const refused = (await h.snapshot()).program;

  await h.debug.addMoveStep("slew", TARGET, SLEW_MAX_RATE);
  const accepted = (await h.snapshot()).program;

  await h.advance(1);
  await h.capture("state", "The tape after a refused rate and an accepted one");

  assertLength(
    refused,
    0,
    `the steps on the tape after a slew command at rate ${OVER}, which is ` +
      `above SLEW_MAX_RATE (${SLEW_MAX_RATE}) and is refused (specs/program.md)`,
  );
  assertLength(
    accepted,
    1,
    `the steps on the tape after a slew command at rate ${SLEW_MAX_RATE}, ` +
      "which is the axis's max rate and is accepted (specs/program.md)",
  );
  const step = accepted[0];
  assertEqual(step?.kind, "move", "the kind of the step the editor took");
  if (step?.kind === "move") {
    assertEqual(
      step.commands[0]?.rate,
      SLEW_MAX_RATE,
      "the rate the accepted command carries",
    );
  }
});
