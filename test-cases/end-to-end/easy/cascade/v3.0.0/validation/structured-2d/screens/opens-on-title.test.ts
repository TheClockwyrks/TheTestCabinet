// screens/opens-on-title — the game opens on the title screen.
//
// specs/screens.md: "The game is on exactly one of four screens at a time, and it
// opens on `title`." So the first thing a player sees is the title, not a table
// mid-deal, and every other screen of this case is reached from there.
//
// THE BUILD IS READ AS IT INITIALIZED, WITH NOTHING POSED. `reset` restores the
// title screen (specs/instrumentation.md), so a check that reset first would be
// reading its own pose back and would pass on a build that opens straight into
// play. The harness creates the engine, initializes the build's game and advances
// no frame, so the snapshot taken before anything else here is exactly the state
// the build opened in.
//
// THE FRAME AFTER IT IS READ TOO, because "opens on `title`" is a statement about
// what a player sees rather than about the instant before the first frame: a
// build that reports the title and then leaves it unbidden on its first update
// has not opened on the title screen. Nothing in this check touches the game
// between the two readings, so the only thing that could move the screen is the
// build itself.

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

it("opens on the title screen, and stays there unbidden", async () => {
  // No pose at all: this is the game the build's own `initialize` left behind.
  const opened = h.snapshot();

  await h.advance(1);
  captureStill(h, "title");
  const drawn = h.snapshot();

  assertEqual(
    opened.screen,
    "title",
    "the screen a freshly initialized build reports, before any frame has run " +
      "(specs/screens.md)",
  );
  assertEqual(
    drawn.screen,
    "title",
    "the screen after one frame of a game nothing has touched, which is the " +
      "screen the player is looking at (specs/screens.md)",
  );
});
