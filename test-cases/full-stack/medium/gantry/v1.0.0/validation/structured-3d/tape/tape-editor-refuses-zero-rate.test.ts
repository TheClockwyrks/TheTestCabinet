// tape/tape-editor-refuses-zero-rate — a command with a rate of `0` never joins
// the tape.
//
// specs/program.md § The tape: "The tape editor accepts a command only with a
// rate greater than `0` and at most the axis's max rate". A rate of `0` is the
// edge of that bound from below: it is not greater than `0`, so the editor takes
// nothing — and a build that compared with `>=` rather than `>` would append a
// step whose axis could never arrive, which is why the exact figure `0` is the
// value this asserts and not a negative one.
//
// The refusal is silent — "a refused edit changes nothing" — so what decides the
// point is the tape itself, read after the call. The world is cleared first so
// the tape starts empty and its length has exactly one meaning; no crane is
// stood up and no run is started, because the editor's rule is an edit-time rule
// and neither would take part in it.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** Somewhere the slew can be told to go; the target is not what is judged. */
const TARGET = 90;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses a command whose rate is zero", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.setScreen("program");

  await h.debug.addMoveStep("slew", TARGET, 0);
  const program = (await h.snapshot()).program;

  await h.advance(1);
  await h.capture("state", "The empty tape a zero-rate command left behind");

  assertLength(
    program,
    0,
    "the steps on the tape after a slew command at rate 0, which is not " +
      "greater than 0 and is refused (specs/program.md)",
  );
});
