// instrumentation/reset-restores-the-completion-switch — however the switch stood,
// reset puts it back on.
//
// THE RULE. "The switch is on when the game is played, `reset` restores it,
// `setCompletion` sets it, and the snapshot reports it as `completion`"
// (`specs/instrumentation.md`, The switch and the gates). `reset` says it again in
// its own row — "Restores every declared field of the game's state to its
// title-screen value: ... the completion switch on" — and the resting-value table
// gives `completion` as `true`.
//
// AND IT IS RESTORED IN SUBSTANCE, NOT ONLY IN THE READING. A build that reported
// `completion: true` while still holding the check off would pass a check that read
// the field alone, so the second half of this point runs a challenge to a boundary
// that reaches its target — with nothing touching the switch since the reset — and
// requires it to complete, which is the switch's own ON column: "A boundary at which
// every set's tally has reached the challenge's `target` completes the run."
//
// THE POSE is `First Light`, Extra 1 of `specs/challenges.md` — one `sol` in, the
// same `sol` out, `target` `6` — with a machine of one set, so the boundary under
// test is reached by one constellation delivered onto that set and by nothing else.
// `setCompletion` is called exactly once in the whole check, before the reset, and
// never after it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { CONSTELLATION_TARGET } from "../constants";
import { EAST } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  holdCompletion,
  placeSet,
  spawnMote,
  tallyOf,
  type Harness,
} from "../harness";

/** `First Light` is Extra 1, whose one product is a lone `sol`. */
const EXTRA_INDEX = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the switch on after a reset, and completes a satisfied run", async () => {
  await holdCompletion(h);
  const held = await h.snapshot();
  assertEqual(
    held.completion,
    false,
    "the switch is held off before the reset",
  );

  await h.debug.reset();
  const reset = await h.snapshot();
  assertEqual(
    reset.completion,
    true,
    "reset reports the completion switch on however it stood before",
  );

  // And the switch is on in substance: nothing touches it from here on.
  await h.debug.openChallenge("extras", EXTRA_INDEX);
  await h.debug.clearMachine();
  await placeSet(h, 0, EAST);
  await h.debug.startRun();
  await h.debug.clearMotes();
  await h.debug.setTally(0, CONSTELLATION_TARGET - 1);
  await spawnMote(h, EAST, "sol");
  await captureReplay(h, "restored", () => advanceCycles(h, 1));

  const completed = await h.snapshot();
  assertNotNull(completed.sim, "the run is reported at the boundary");
  assertEqual(
    completed.completion,
    true,
    "the switch is still the one reset restored",
  );
  assertEqual(
    tallyOf(completed, 0),
    CONSTELLATION_TARGET,
    "the boundary delivered the constellation that reached the target",
  );
  assertEqual(
    completed.sim?.status,
    "complete",
    "and a run started after a reset completes at a satisfied boundary",
  );
});
