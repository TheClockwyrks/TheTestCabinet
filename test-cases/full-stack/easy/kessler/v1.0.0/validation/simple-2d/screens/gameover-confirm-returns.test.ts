// screens/gameover-confirm-returns — confirm leaves the game-over screen.
//
// specs/screens.md, on `gameover`: "`confirm` returns to `title`."
// specs/controls.md has `gameover` read `confirm` and nothing else.
//
// The game-over screen is reached through the surface rather than by spending
// lives, because entering it is `last-life-enters-gameover`'s point, and a
// build that cannot reach the screen must fail there alone. `Enter` is the
// key pressed: it carries `confirm` alone, while `Space` also carries
// `launch`, and whether each bound key fires is the controls category's
// concern.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { KEYS } from "../constants";
import {
  captureStill,
  openHarness,
  poseScene,
  tap,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

/** The confirm key that carries no second action. */
const CONFIRM = KEYS.confirm[1];

it("sets the screen back to title on confirm", async () => {
  const posed = poseScene(h, "gameover");
  assertEqual(posed.screen, "gameover", "the screen confirm is pressed on");

  await tap(h, CONFIRM);
  captureStill(h, "title");

  const after = h.snapshot();
  assertEqual(
    after.screen,
    "title",
    "the screen confirm returned to from game over",
  );
});
