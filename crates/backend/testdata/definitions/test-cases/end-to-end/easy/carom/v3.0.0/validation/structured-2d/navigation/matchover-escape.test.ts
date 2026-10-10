// Carom — navigation/matchover-escape: Escape on the match-over screen returns to the title.
//
// One transition of the menu state machine specs/ui.md fixes. The match-over
// screen is POSED: `openMatchOver` sets the winner, the final score and
// `menuIndex`, which is what specs/balls.md says reaching the screen leaves
// behind. Playing a match out to reach it would put the serve, the physics, the
// scoring and the win rule between this check and the one transition it decides,
// and each of those is another point's. So the ONE press this check makes is the
// `back` edge this point is about.
//
// The point that DOES drive a real match to its end is `gameplay/match-win`,
// which is where a broken win rule belongs.
//
// The key is a real key event dispatched at the target the engine listens on, so
// the action is raised by the binding the case declares, and the result is read
// back off the game's own state. The still is the frame the press left.
//
// Nothing on the field is posed or removed. specs/ui.md advances nothing on the
// match-over screen and nothing on the title, so this transition runs over a
// world that cannot move under it either way.
//
// `menuIndex` is read back as 0 because returning to the title sets it to
// `titleIndex`, and this match was posed rather than confirmed off the title
// menu, so `titleIndex` is still the 0 `reset` left it at.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openMatchOver,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title from the match-over screen on Escape", async () => {
  await openMatchOver(h, { winner: "left" });

  const over = h.snapshot();
  assertEqual(over.screen, "matchover");
  assertEqual(over.winner, "left");
  assertEqual(over.titleIndex, 0);

  await h.tap("Escape");
  captureStill(h, "title");

  const title = h.snapshot();
  assertEqual(title.screen, "title");
  assertEqual(title.menuIndex, 0);
});
