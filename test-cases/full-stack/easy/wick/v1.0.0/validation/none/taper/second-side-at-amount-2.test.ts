// Wick — taper/second-side-at-amount-2: amount `2` fires a mirrored second
// slash on the same tick.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Taper"): "With amount
// `2` a second slash fires on the same tick, mirrored to the opposite side of
// the player." Row 3 of `TAPER_LEVELS` is the first with amount `2`, at width
// `120`, so with the lamplighter at the origin facing right the two rectangles
// span `x` from `0` to `120` and from `-120` to `0`, both centered on the
// player's `y`. A moth at `(100, 0)` is inside the first and one at
// `(-100, 0)` inside the second, and the firing tick hits both.
//
// THE POSE. An isolated night, facing posed right, one moth each side, and
// Taper held at level 3 fired by one tick (`taper/stage.ts`). A build that
// fires one slash alone leaves the moth behind the player standing, which is
// what separates this point from `slash-geometry`.
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
import { assertHit } from "./stage";

/** The first level whose row carries amount `2`. */
const LEVEL = 3;

/** The probe on the facing side. */
const AHEAD = { x: 100, y: 0 };

/** The probe on the mirrored side. */
const BEHIND = { x: -100, y: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("hits a moth on each side of the player on the same firing tick", async () => {
  const opened = await isolate(h);
  await h.debug.setFacing("right");
  const at = opened.run.player;
  const ahead = await placeEnemy(h, "moth", at.x + AHEAD.x, at.y + AHEAD.y);
  const behind = await placeEnemy(h, "moth", at.x + BEHIND.x, at.y + BEHIND.y);

  const firing = await fireWeapon(h, "taper", LEVEL);
  await captureStill(h, "both");

  assertHit(firing.after, ahead, "the moth on the facing side");
  assertHit(firing.after, behind, "the moth on the mirrored side");
});
