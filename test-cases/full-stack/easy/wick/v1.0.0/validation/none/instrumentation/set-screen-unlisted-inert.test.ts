// Wick — instrumentation/set-screen-unlisted-inert: `setScreen("chest")` from
// `playing`, `setScreen("levelup")` from `title`, and `setScreen("paused")`
// from `title` each leave the state exactly as it was.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `setScreen(name)`):
// "Any row not listed, `chest` from anywhere or `levelup` from `title` among
// them, leaves the state as it was." The `paused` row lists `playing` alone as
// its source. The comparison is exact equality of the documented snapshot
// across each call.
//
// WHY THE WORLD IS POSED AS IT IS. The `chest` call is made on an isolated
// run, the other two on the title the reset leaves; each is one of the rows
// the sentence names, and a screen change on any of them is plain to read.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { type ScreenName } from "../constants";
import {
  captureStill,
  createHarness,
  posedState,
  isolate,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Call `setScreen(name)` and read the snapshot untouched across it. */
async function requireInert(name: ScreenName): Promise<void> {
  const before = await h.snapshot();
  try {
    await h.debug.setScreen(name);
  } catch {
    // A refusal leaves the state as it was too; what is read is the state.
  }
  const after = await h.snapshot();
  assertEqual(after.screen, before.screen, `the screen after setScreen('${name}') from ${before.screen}`);
  assertDeepEqual(
    posedState(after),
    posedState(before),
    `the snapshot across setScreen('${name}') from ${before.screen}`,
  );
}

it("leaves the state as it was on an unlisted row", async () => {
  await isolate(h);
  await requireInert("chest");

  await h.debug.reset();
  await requireInert("levelup");
  await requireInert("paused");
  await captureStill(h, "inert");
});
