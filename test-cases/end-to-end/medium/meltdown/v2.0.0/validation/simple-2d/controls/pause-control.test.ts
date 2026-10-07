// Meltdown — controls/pause-control: the panel's Pause control opens the pause
// screen.
//
// THE RULE. specs/hud.md gives the control: "The panel carries... a Pause
// control". specs/controls.md answers a press and release inside a panel control
// as "That control is operated", and gives `pause` the effect "Opens the pause
// screen from live play". specs/screens.md names the screen: `paused`, "The pause
// menu, over the frozen floor."
//
// THE CONTROL AND THE KEY ARE SEPARATE POINTS, because a build can wire one and
// not the other, and specs/controls.md requires that "Every interaction and every
// menu is reachable with the pointer alone". `controls.pause-key` reads the key,
// and reads the return from the pause screen with it.
//
// ONLY THE OPENING IS READ HERE, which is what the item names. specs/hud.md's
// panel is drawn during a run; what a player taps to leave the pause screen is one
// of the three rows specs/screens.md gives it — `RESUME` — and that is
// `screens.pause-resume`'s requirement. So this point stops at the transition the
// control is for and does not assume the panel is still tappable behind the menu,
// a thing no specification states.
//
// THE FREEZE IS NOT READ HERE. That the floor actually stops while the screen is
// `paused` is `waves.pause-freezes-the-floor`, and it is measured there over a
// window of the game's own time, because "the simulation does not advance"
// (specs/waves.md) is a claim about the clock the player's game runs on rather
// than about where a build put its gate. `screen` is a field, and a field reads
// the same however the clock is driven.
//
// THE RECTANGLE IS THE BUILD'S OWN, read off the snapshot, and specs/hud.md
// carries Pause at all times during a run, so this one is never null.
//
// THE WORLD IS AN EMPTY, QUIET, LIVE RUN, so no leak, no wave clear and no
// arriving unit can move the screen on its own while the tap is read.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  clickControl,
  createHarness,
  startRun,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens the pause screen when the reported Pause rectangle is tapped", async () => {
  startRun(h);
  await h.advance(1);
  const before = h.snapshot();
  assertEqual(
    before.screen,
    "playing",
    "posing: the screen the scenario is posed on (specs/screens.md)",
  );

  await clickControl(h, before.controls.pause);
  captureStill(h, "paused");

  assertEqual(
    h.snapshot().screen,
    "paused",
    "the screen a press and release inside the reported pause rectangle " +
      "leaves live play on (specs/hud.md, specs/controls.md)",
  );
});
