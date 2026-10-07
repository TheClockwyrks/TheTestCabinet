// screens/opens-on-title — a freshly initialized build is on the title screen.
//
// THE RULE. specs/screens.md: "The game is on exactly one of four screens at a
// time, and it opens on `title`." That is a statement about the state the build's
// own `initialize` produced, before anything has driven the game at all.
//
// SO NOTHING IS POSED. `reset()` restores `screen` to `"title"`
// (specs/instrumentation.md), and `setScreen` sets it outright, so a check that
// called either one would be reading its own pose back rather than the screen the
// build opened with. What is read here is `engine.state` as the build handed it
// over, sampled before the first frame runs.
//
// The frame that follows exists only to put the opening screen on the canvas for
// the still; the verdict rests on the reading taken before it, so a build that
// opened elsewhere and corrected itself on its first update fails here.
//
// WHAT THIS DOES NOT DECIDE. What the title screen SHOWS, which is
// `screens/title-shows-title`, `title-shows-tagline`, `title-shows-new-game` and
// `title-shows-mode-label`, and whether its controls answer, which is
// `screens/title-new-game-enters-play` and `screens/title-how-to-opens`.

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

it("reports the title screen as the screen it initialized on", async () => {
  // The state `initialize` handed the engine, read before a frame has run and
  // before anything has been posed.
  const opened = h.snapshot().screen;

  // One frame, so the still is the screen the build actually drew rather than an
  // empty canvas. It cannot reach the reading above.
  await h.advance(1);
  captureStill(h, "title");
  const drawn = h.snapshot().screen;

  assertEqual(
    opened,
    "title",
    "the screen a freshly initialized build reports, before anything has " +
      "posed one (specs/screens.md: the game opens on title)",
  );
  assertEqual(
    drawn,
    "title",
    "the screen after one frame of a game nothing has touched, which is the " +
      "screen the player is actually looking at — a build that reported " +
      "title and then left it on its own first frame has not opened on the " +
      "title screen (specs/screens.md)",
  );
});
