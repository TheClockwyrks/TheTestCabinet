// controls/key-p-pauses — KeyP pauses a live session.
//
// specs/controls.md binds `pause` to `KeyP`, live on `playing`, where "`back`
// and `pause` both pause, so a player reaches the pause menu with either
// `Escape` or `KeyP`". specs/screens.md states the transition from the
// screen's side: on `playing`, "`back` and `pause` set `screen` to `paused`".
//
// Same arrangement as controls/escape-pauses with only the key changed: a
// build that pauses on Escape alone fails here and passes there, which is the
// separation the two points exist for.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS } from "../constants";
import { openHarness, type Harness } from "../harness";
import { pauseWith } from "./pause";

/** The key this point is about, as `specs/controls.md` binds it. */
const KEY = BINDINGS.pause[0];

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves a live session to the paused screen with KeyP", async () => {
  assertEqual(KEY, "KeyP", "the binding this point presses");
  const press = await pauseWith(h, KEY, "paused");
  assertEqual(press.after.screen, "paused", "the screen after KeyP");
});
