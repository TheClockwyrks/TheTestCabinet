// screens/pause-via-back — back pauses a live session.
//
// specs/screens.md, on `playing`: "`back` and `pause` set `screen` to
// `paused`", and `paused` is "The pause menu, over the field drawn exactly as
// the tick that paused it left it" — so the field is still behind the menu.
// This point is `back`'s path; `pause`'s is its own point.
//
// The session is entered through the surface — setScreen("playing") "starts a
// fresh session exactly as confirming START does" — so a broken title menu
// costs the navigation points, not this one. What is pressed here is Escape.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS } from "../constants";
import { captureStill, openHarness, tap, type Harness } from "../harness";
import { posePlaying, targetTotal } from "./scenes";

/** The key specs/controls.md binds to `back`. */
const BACK = BINDINGS.back[0];

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("back on playing sets screen to paused with the field behind it", async () => {
  const posed = await posePlaying(h);
  assertEqual(posed.screen, "playing", "the screen back is pressed on");

  await tap(h, BACK);
  await captureStill(h, "paused-via-escape");

  const after = await h.snapshot();
  assertEqual(after.screen, "paused", "the screen back set");
  assertEqual(
    after.balls.length,
    posed.balls.length,
    "the session's balls, still behind the menu",
  );
  assertEqual(
    targetTotal(after),
    targetTotal(posed),
    "the session's targets, still behind the menu",
  );
});
