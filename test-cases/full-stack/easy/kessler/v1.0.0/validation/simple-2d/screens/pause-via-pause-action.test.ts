// screens/pause-via-pause-action — pause pauses a live session.
//
// specs/screens.md, on `playing`: "`back` and `pause` set `screen` to
// `paused`", and specs/controls.md binds `pause` to `KeyP`, "so a player
// reaches the pause menu with either `Escape` or `KeyP`". This point is
// `pause`'s path; `back`'s is its own point.
//
// The session is entered through the surface — setScreen("playing") "starts a
// fresh session exactly as confirming START does" — so a broken title menu
// costs the navigation points, not this one. What is pressed here is KeyP.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { KEYS } from "../constants";
import { captureStill, openHarness, tap, type Harness } from "../harness";
import { posePlaying } from "./scenes";

/** The key specs/controls.md binds to `pause`. */
const PAUSE = KEYS.pause[0];

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("pause on playing sets screen to paused", async () => {
  const posed = posePlaying(h);
  assertEqual(posed.screen, "playing", "the screen pause is pressed on");

  await tap(h, PAUSE);
  captureStill(h, "paused-via-key-p");

  assertEqual(h.snapshot().screen, "paused", "the screen pause set");
});
