// progression/ending-dismissed-pointer — a primary pointer press dismisses an
// ending to the title.
//
// THE SPEC LINE. `specs/controls.md` ("Confirming with the pointer"):
// "`title`, `gameover`, and `victory` read a primary pointer press anywhere on
// the field as confirm, on the press edge and once per press, exactly as the
// keyboard raises it", and "The whole field is the region, so no part of it
// answers differently from any other". `specs/controls.md` ("What each screen
// reads") says the same from the other side: "`gameover`, `victory` | confirm
// dismisses the ending, from the keyboard or a primary pointer press".
//
// WHY IT IS ITS OWN POINT. A build dismissable by keyboard alone is not the
// same build as one dismissable by both, and a player who started the run with
// the pointer has no reason to reach for a key to leave it.
// `progression/ending-dismissed` is the keyboard's half.
//
// WHERE THE PRESS LANDS. The field's own center, which `specs/overview.md`
// fixes at 960 x 540. The spec makes the whole field the region, so the center
// is a point every conformant build answers and no layout the build chose is
// read to find it.
//
// THE DRIVE. The ending is posed by `progression/ending.ts` and the press is a
// real primary press dispatched at the engine's own event target, running the
// frame that reads it.
//
// THE TOLERANCE. None. A screen name is an exact comparison.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { FIELD_H, FIELD_W } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { poseEnding } from "./ending";

/** The field's own center, which every conformant build answers on an ending. */
const CENTER = { x: FIELD_W / 2, y: FIELD_H / 2 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title when the pointer is pressed on an ending", async () => {
  const posed = await poseEnding(h);

  const dismissed = await h.clickPointer(CENTER.x, CENTER.y);
  await captureStill(h, "dismissed");

  assertEqual(posed.screen, "gameover", "the screen the press was made from");
  assertEqual(dismissed.screen, "title", "the screen the pointer press left");
});
