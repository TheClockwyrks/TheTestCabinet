// screens/start-touch — a touch contact on the title starts a run.
//
// THE SPEC IT RESTS ON. `specs/controls.md` ("Confirming with the pointer"):
// "A touch contact is a pointer, so a contact landing on the field raises
// confirm on those three screens as a mouse press does", over "`title`,
// `gameover`, and `victory` read a primary pointer press anywhere on the field
// as confirm". `specs/controls.md` ("Where input reaches the game") states the
// same requirement from the layer's side: the input layer "reports the pointer
// position in the field's logical units ... so a mouse, a pen, and a touch
// contact all reach the game through the same reads".
//
// WHY IT IS ITS OWN POINT, AND WHY IT RUNS UNDER `none` ALONE.
// `screens/start-pointer` drives a mouse, and a build that listens for
// `mousedown` rather than `pointerdown` answers it while answering no finger
// at all — which is every phone and every tablet. Under either engine that
// normalization is the engine's, done before the build sees anything, so the
// point would grade the engine; under `none` the input layer is the build's
// own work, which is why the manifest scopes it here.
//
// WHAT A REAL CONTACT IS. The harness's context reports a touchscreen, and the
// gesture is dispatched as a genuine touch event: it carries `pointerType:
// "touch"`, it has no hover before it, and the contact lands and lifts across
// driven frames the way a finger does. A posed pointer position would prove
// nothing about the layer that has to hear it.
//
// WHERE THE CONTACT LANDS. The field's own center, which `specs/overview.md`
// fixes at 960 x 540. "The whole field is the region, so no part of it answers
// differently from any other", so no layout the build chose is read to find
// the point.
//
// THE TOLERANCE. None. The screen and the level are both exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { FIELD_H, FIELD_W } from "../constants";
import {
  captureStill,
  createHarness,
  touchTap,
  type Harness,
} from "../harness";

/** The field's own center, which every conformant build answers on the title. */
const CENTER = { x: FIELD_W / 2, y: FIELD_H / 2 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens level 1 in play when a touch contact lands on the title", async () => {
  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the screen the contact lands on",
  );

  await touchTap(h, CENTER.x, CENTER.y);
  const opened = await h.snapshot();
  await captureStill(h, "playing");

  assertEqual(
    opened.screen,
    "playing",
    "the screen the touch contact left the game on",
  );
  assertEqual(opened.level, 1, "the level a fresh run opens");
});
