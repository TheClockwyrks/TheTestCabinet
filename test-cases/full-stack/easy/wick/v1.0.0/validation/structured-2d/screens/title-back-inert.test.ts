// Wick — screens/title-back-inert: `back` does nothing on the title screen.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`title`":
// "`confirm` takes the highlighted item, and `back` does nothing."
// `specs/controls.md`, "What each screen reads", gives the title row
// `up`, `down`, `confirm`, and `mute` alone, and "An action a row omits does
// nothing on that screen"; `back` is bound to `Escape`.
//
// THE DRIVE. `reset` to the title screen and one `ArrowDown`, so the highlight
// sits on the second item rather than the one an arrival sets — a build that
// treats `back` as a return to the title would land on `title` with
// `menuIndex` `0` and read as inert if the highlight were left where it
// started. Then one real `Escape`, and both fields are read.
//
// THE TOLERANCE. None: a screen name and an index.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, tap, type Harness } from "../harness";

/** The item the highlight is moved to before the press. */
const HIGHLIGHTED = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves the title screen and its highlight untouched by Escape", async () => {
  h.reset();
  const posed = await tap(h, "ArrowDown");
  assertEqual(posed.screen, "title", "the screen the press is made on");
  assertEqual(posed.menuIndex, HIGHLIGHTED, "menuIndex before the press");

  const after = await tap(h, "Escape");
  captureStill(h, "inert");

  assertEqual(after.screen, "title", "the screen after Escape");
  assertEqual(after.menuIndex, HIGHLIGHTED, "menuIndex after Escape");
});
