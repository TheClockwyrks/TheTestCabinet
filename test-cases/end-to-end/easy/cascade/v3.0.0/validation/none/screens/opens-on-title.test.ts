// screens/opens-on-title — the game is on the `title` screen when it is ready to
// be played, before anything has asked it for another one.
//
// `specs/screens.md`: "The game is on exactly one of four screens at a time, and
// it opens on `title`." That is the first thing a player meets, and a build that
// opened straight onto a table, or onto its how-to page, has none of the entry
// the specification describes — which is why the item is capped at `broken`.
//
// WHAT THIS READS, AND THE ONE LIMIT ON IT. The harness takes the game off the
// wall clock and calls `reset()` before a check touches anything, so the reading
// below is of a build that has initialized and been reset, and `reset` restores
// `screen` to `"title"` (`specs/instrumentation.md`). The two statements agree,
// so a conformant build answers `"title"` either way and a build that answers
// anything else has broken one of them. Nothing here poses a screen: the whole
// point is to read the one the build is holding when it is handed over.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

/** One frame, so the canvas carries the screen the assertion read. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("is on the title screen when it is handed over", async () => {
  const opened = await h.snapshot();

  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "title");

  assertEqual(opened.screen, "title", "the screen the game opened on");
});
