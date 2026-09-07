// instrumentation/draw-launch-vx-stands-alone — `drawLaunchVx` performs the
// launch's draw and nothing else.
//
// THE RULE. `specs/instrumentation.md`, The cascade: `drawLaunchVx()` "performs
// one launch's `vx` draw and returns the signed value drawn", and "does nothing
// else: no card launches, no flyer is added, and no declared field changes".
//
// WHY IT IS ITS OWN POINT. The two `cascade/launch-vx` points read the draw off
// this operation instead of off a running cascade, so an operation that
// launched a card as a side effect, or that returned something other than a
// number, would hand those points a reading of the wrong thing. This point
// names that defect; what the VALUE drawn is held to is theirs.
//
// THE TABLE HOLDS A CARD A LAUNCH COULD TAKE, on the screen the cascade runs on:
// a King on foundation `0` with launching on, so an operation that launched
// instead of drawing has a card to launch and the reading catches it. Whole
// snapshots are compared, so a change to ANY declared field fails the point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { RANK_MAX } from "../constants";
import { captureStill, createHarness, openWon, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns a number and leaves every declared field as it stood", async () => {
  await openWon(h);
  await h.debug.addCard("foundation", 0, "spades", RANK_MAX, true);
  const before = await h.snapshot();

  const drawn = await h.debug.drawLaunchVx();
  const after = await h.snapshot();

  await h.advance(1);
  await captureStill(h, "drawn");

  assertTrue(
    typeof drawn === "number" && Number.isFinite(drawn),
    `drawLaunchVx() to return a finite number, and it returned ` +
      `${JSON.stringify(drawn)} (specs/instrumentation.md)`,
  );
  assertEqual(
    JSON.stringify(after),
    JSON.stringify(before),
    "snapshot() after drawLaunchVx() to match the snapshot before it, field for " +
      "field (specs/instrumentation.md)",
  );
});
