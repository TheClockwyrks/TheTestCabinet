// controls/escape-pauses — Escape pauses a live session.
//
// specs/controls.md binds `back` to `Escape`, live on `playing`, where "`back`
// and `pause` both pause, so a player reaches the pause menu with either
// `Escape` or `KeyP`". specs/screens.md states the transition from the
// screen's side: on `playing`, "`back` and `pause` set `screen` to `paused`".
//
// The session is isolated and entered through the surface — no menu on the
// way in, nothing on the field — so the one thing the press can do is the one
// thing this point is about. What the pause freezes is the pause-freezing
// point's business; the reading here is the screen the press landed on.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS } from "../constants";
import { openHarness, type Harness } from "../harness";
import { pauseWith } from "./pause";

/** The key this point is about, as `specs/controls.md` binds it. */
const KEY = BINDINGS.back[0];

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves a live session to the paused screen with Escape", async () => {
  assertEqual(KEY, "Escape", "the binding this point presses");
  const press = await pauseWith(h, KEY, "paused");
  assertEqual(press.after.screen, "paused", "the screen after Escape");
});
