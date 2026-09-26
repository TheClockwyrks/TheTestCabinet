// instrumentation/start-run-throws-without-a-challenge — the one argumentless call
// that refuses.
//
// THE RULE. "`startRun` throws with no challenge open"
// (`specs/instrumentation.md`, The run), which is the same shape every refusal on
// this surface takes: "An argument outside the domain its operation states is
// invalid, and the call fails loudly rather than guessing what was meant."
//
// AND NOTHING IS LEFT BEHIND. `sim` is `null` while editing
// (`specs/instrumentation.md`, Snapshot shape), and a refused call that had opened
// a run anyway would report one — so the check reads the throw and then reads
// `sim` again, because a build that threw AFTER standing a run up would pass the
// first reading and fail the second.
//
// THE WORLD IS POSED, NOT SEARCHED. `reset` "Restores every declared field of the
// game's state to its title-screen value: the title screen with its first menu
// item highlighted... no challenge open... no run", which is exactly the state
// this point is about, reached in one call. The check reads back that no challenge
// is open before making the call, so the refusal is refusing what it was meant to.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  openTitle,
  type Harness,
} from "../harness";

/** Whether a call threw, as one word, so a failure reads as an expected/actual pair. */
async function outcomeOf(call: () => Promise<unknown>): Promise<string> {
  try {
    await call();
    return "returned";
  } catch {
    return "threw";
  }
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("throws and leaves sim null", async () => {
  await openTitle(h);

  const posed = await h.snapshot();
  assertNull(posed.challenge, "a reset leaves no challenge open");
  assertNull(posed.sim, "a reset leaves no run");

  const outcome = await outcomeOf(() => h.debug.startRun());

  await h.advance(1);
  await captureStill(h, "refused");

  assertEqual(
    outcome,
    "threw",
    "startRun throws an Error with no challenge open",
  );
  const after = await h.snapshot();
  assertNull(after.sim, "the refused startRun leaves sim null");
  assertNull(after.challenge, "the refused startRun opens no challenge");
});
