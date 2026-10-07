// instrumentation/screen-reads-back — each of the four screens `setScreen` sets
// is the screen `snapshot().screen` reports.
//
// THE RULE. `specs/instrumentation.md`, The screen and the menus:
// `setScreen(screen)` "Sets the current screen: `"title"`, `"howto"`, `"playing"`,
// or `"won"`", and the snapshot shape carries `screen` as one of the four. The
// file states the contract the whole surface is built to: "Every field an
// operation can set is present, so every operation is verifiable by setting a
// value and reading it back."
//
// WHY IT IS A `broken` POINT. `setScreen` is how nearly every scenario in this
// suite reaches the screen it is about — `openTable` is one call to it — so a
// build whose screen does not read back leaves dozens of checks posing a screen
// they never reached.
//
// ALL FOUR ARE POSED, IN A FIXED ORDER, and none of the readings is of the screen
// the pose before it left: a build that reports a constant fails on the second,
// and a build that reports the screen it was last on rather than the screen it
// was set to fails on every one after the first.
//
// EACH IS READ WITH NO FRAME BETWEEN THE POSE AND THE READING, because a frame
// could carry the game off a screen it had just been put on — a `won` screen runs
// the victory cascade (`specs/victory.md`) — and the reading would then be of the
// update rather than of the pose.
//
// THAT `setScreen` CHANGES NO OTHER FIELD is not decided here. `specs/instrumentation.md`
// states it — "a screen posed this way leaves the table and the selection exactly
// as they stand" — and every scenario in this suite that poses a screen over a
// table it laid first rests on it. This point decides the read-back.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  type Harness,
  type Screen,
} from "../harness";

/** The four screens, posed in an order in which no two neighbours are equal. */
const SCREENS: readonly Screen[] = ["howto", "playing", "won", "title"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports each posed screen back through snapshot", async () => {
  const read: { posed: Screen; reported: Screen }[] = [];
  for (const screen of SCREENS) {
    await h.debug.setScreen(screen);
    read.push({ posed: screen, reported: (await h.snapshot()).screen });
  }

  await h.advance(1);
  // Before the assertions, so a failing pose still leaves the picture of the
  // screen the last one reached.
  await captureStill(h, "posed");

  for (const step of read) {
    assertEqual(
      step.reported,
      step.posed,
      `snapshot().screen after setScreen(${JSON.stringify(step.posed)}) ` +
        `(specs/instrumentation.md)`,
    );
  }
});
