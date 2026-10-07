// screens/resume-via-back — back resumes from the pause menu.
//
// specs/screens.md, on `paused`: "`back` and `pause` both do exactly what
// `RESUME` does" — and `confirm` on RESUME "returns to `playing`". This point
// is `back`'s path; `confirm`'s and `pause`'s are their own points.
//
// The paused session is posed through the surface alone, so a broken pause
// key costs its own point rather than this one. What is pressed here is the
// key that resumes.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS } from "../constants";
import { captureStill, openHarness, tap, type Harness } from "../harness";
import { posePaused } from "./scenes";

/** The key specs/controls.md binds to `back`. */
const BACK = BINDINGS.back[0];

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("back on paused sets screen back to playing", async () => {
  const posed = await posePaused(h);
  assertEqual(posed.screen, "paused", "the screen back is pressed on");

  await tap(h, BACK);
  await captureStill(h, "resumed-via-back");

  assertEqual(
    (await h.snapshot()).screen,
    "playing",
    "the screen back returned to from paused",
  );
});
