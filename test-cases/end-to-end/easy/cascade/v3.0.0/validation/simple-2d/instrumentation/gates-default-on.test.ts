// instrumentation/gates-default-on — every faculty gate starts on, and a reset puts
// it back on.
//
// specs/instrumentation.md, of the four gates: "each gates one faculty and nothing
// else, each is on by default and restored to on by `reset`, and each is reported
// by `snapshot`". `reset` restores the same four by name.
//
// WHY IT MATTERS BEYOND ITS OWN POINT. A gate is a scenario's tool, and a scenario
// that did not ask for one must not get it: `openTable` in `harness.ts` opens every
// check in this project with a `reset` and then leaves the gates alone, precisely
// because what a player gets is all four on. A build whose gates default off would
// hand every one of those checks a game with no automatic flip, no win, no cascade
// and no painted table, and each of them would then be reading a different game
// from the one its item names.
//
// TWO CHECKS, and they are two different builds. The first reads the game AS IT
// STARTS, before anything has been posed at all, which is the state a player meets;
// a build whose gates are off there fails it whatever its `reset` does. The second
// poses all four off and resets, which is what a build that never restores them
// fails.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("starts the game with every gate on", async () => {
  const opened = h.snapshot();

  await h.advance(1);

  assertEqual(opened.autoFlip, true, "autoFlip as the game starts");
  assertEqual(opened.winDetect, true, "winDetect as the game starts");
  assertEqual(opened.launching, true, "launching as the game starts");
  assertEqual(opened.trailPainting, true, "trailPainting as the game starts");
});

it("turns every gate back on when it resets", async () => {
  h.debug.setAutoFlip(false);
  h.debug.setWinDetect(false);
  h.debug.setLaunching(false);
  h.debug.setTrailPainting(false);

  // The four are really off, so the reading after the reset is of the reset.
  const posed = h.snapshot();
  assertEqual(posed.autoFlip, false, "autoFlip, posed off before the reset");
  assertEqual(posed.winDetect, false, "winDetect, posed off before the reset");
  assertEqual(posed.launching, false, "launching, posed off before the reset");
  assertEqual(
    posed.trailPainting,
    false,
    "trailPainting, posed off before the reset",
  );

  h.debug.reset();
  const after = h.snapshot();

  // The table reset returned to, every gate on.
  await h.advance(1);
  captureStill(h, "reset");

  assertEqual(after.autoFlip, true, "reset turns autoFlip back on");
  assertEqual(after.winDetect, true, "reset turns winDetect back on");
  assertEqual(after.launching, true, "reset turns launching back on");
  assertEqual(after.trailPainting, true, "reset turns trailPainting back on");
});
