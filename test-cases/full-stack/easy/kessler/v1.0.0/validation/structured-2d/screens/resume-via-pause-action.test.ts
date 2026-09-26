// screens/resume-via-pause-action — pause resumes from the pause menu.
//
// specs/screens.md, on `paused`: "`back` and `pause` both do exactly what
// `RESUME` does" — and `confirm` on RESUME "returns to `playing`". This point
// is `pause`'s path (KeyP); `confirm`'s and `back`'s are their own points.
//
// The paused session is posed through the surface alone, so a broken pause
// key on the PLAYING screen costs its own point rather than this one. What is
// pressed here is KeyP on the paused screen.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS } from "../constants";
import { captureStill, openHarness, tap, type Harness } from "../harness";
import { posePaused } from "./scenes";

/** The key specs/controls.md binds to `pause`. */
const PAUSE = BINDINGS.pause[0];

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("pause on paused sets screen back to playing", async () => {
  const posed = posePaused(h);
  assertEqual(posed.screen, "paused", "the screen pause is pressed on");

  await tap(h, PAUSE);
  captureStill(h, "resumed-via-key-p");

  assertEqual(
    h.snapshot().screen,
    "playing",
    "the screen pause returned to from paused",
  );
});
