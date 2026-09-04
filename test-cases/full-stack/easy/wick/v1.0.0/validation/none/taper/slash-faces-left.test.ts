// Wick — taper/slash-faces-left: with facing left, the slash extends toward
// `-x`.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Taper"): the slash's
// "near vertical edge is at the player's `x`, it extends `width` in the facing
// direction", and ("The nearest enemy") "The facing direction is `facing` from
// `specs/world.md`: `+x` for `"right"` and `-x` for `"left"`." Row 1 of
// `TAPER_LEVELS` gives width `120`, so with the lamplighter at the origin
// facing left the rectangle spans `x` from `-120` to `0`. A moth at
// `(-100, 0)` is inside it; one at `(100, 0)` has its nearest point at
// `(0, 0)`, `100` away, far beyond its radius of `10` (`specs/enemies.md`),
// and is not overlapped.
//
// THE POSE. An isolated night with `setFacing("left")` posed on the
// surface (`specs/instrumentation.md`: "Sets `facing` to `facing`, `"left"`
// or `"right"`"), rather than a key held, so a build with a broken facing
// rule fails the `lamplighter/` points and this one reads the slash alone. Two
// moths, one each side, and Taper at level 1 fired by one tick
// (`taper/stage.ts`).
//
// TOLERANCE. None: each moth is either gone or standing at its posed hp.

import { afterEach, beforeEach, it } from "vitest";
import {
  captureStill,
  createHarness,
  fireWeapon,
  isolate,
  placeEnemy,
  type Harness,
} from "../harness";
import { assertHit, assertUntouched } from "./stage";

/** The level whose row the slash is read at: width `120`. */
const LEVEL = 1;

/** The probe on the facing side, inside the slash. */
const LEFT = { x: -100, y: 0 };

/** The probe on the other side, where no slash reaches. */
const RIGHT = { x: 100, y: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("hits the moth on the left and not the one on the right when facing left", async () => {
  const opened = await isolate(h);
  await h.debug.setFacing("left");
  const at = opened.run.player;
  const left = await placeEnemy(h, "moth", at.x + LEFT.x, at.y + LEFT.y);
  const right = await placeEnemy(h, "moth", at.x + RIGHT.x, at.y + RIGHT.y);

  const firing = await fireWeapon(h, "taper", LEVEL);
  await captureStill(h, "left");

  assertHit(firing.after, left, "the moth on the facing side");
  assertUntouched(firing.after, right, "the moth on the other side");
});
