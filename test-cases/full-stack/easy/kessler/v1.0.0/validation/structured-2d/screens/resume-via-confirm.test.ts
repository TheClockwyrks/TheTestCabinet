// screens/resume-via-confirm — confirming RESUME returns to play.
//
// specs/screens.md, on `paused`: "`confirm` on `RESUME` returns to `playing`
// with the session intact". RESUME is entry `0`, and "Entering a menu-bearing
// screen highlights entry `0`", so the pause menu opens on it and the one key
// pressed is the `confirm` edge itself. Whether the session comes back intact
// is the states category's point; what is decided here is the screen.
//
// The paused session is posed through the surface alone, so a broken pause
// key costs its own point rather than this one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS } from "../constants";
import { captureStill, openHarness, tap, type Harness } from "../harness";
import { posePaused } from "./scenes";

/** The key that carries `confirm` alone — `Space` also carries `launch`. */
const CONFIRM = BINDINGS.confirm[1];

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("confirm on RESUME sets screen back to playing", async () => {
  const posed = posePaused(h);
  assertEqual(posed.screen, "paused", "the screen confirm is pressed on");
  assertEqual(posed.menu.index, 0, "the highlighted entry, RESUME");

  await tap(h, CONFIRM);
  captureStill(h, "resumed-via-confirm");

  assertEqual(
    h.snapshot().screen,
    "playing",
    "the screen confirm on RESUME returned to",
  );
});
