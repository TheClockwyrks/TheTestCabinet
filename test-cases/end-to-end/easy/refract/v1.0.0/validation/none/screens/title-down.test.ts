// Refract — screens/title-down: one down press moves the title selection from
// the first item to the second.
//
// specs/ui.md: on the title, `up` and `down` move the highlight by one item, and
// `menuIndex` is 0 on arrival. The press is a real key through Chromium's input
// pipeline — the surface carries no operation for the registered actions — so
// what is graded is the build's own menu handling behind the `down` action.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  fireAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves menuIndex from 0 to 1 with one down press", async () => {
  const opened = await h.snapshot();
  assertEqual(opened.screen, "title", "the game opens on the title");
  assertEqual(opened.menuIndex, 0, "menuIndex is 0 on arriving at the title");

  await fireAction(h, "down");
  await captureStill(h, "menu");

  const moved = await h.snapshot();
  assertEqual(
    moved.screen,
    "title",
    "the press moves the highlight, not the screen",
  );
  assertEqual(moved.menuIndex, 1, "one down press from 0");
});
