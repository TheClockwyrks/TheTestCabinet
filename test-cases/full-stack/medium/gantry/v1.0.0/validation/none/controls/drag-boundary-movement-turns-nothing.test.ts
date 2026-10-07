// controls/drag-boundary-movement-turns-nothing — the movement that carried a
// press across the slop boundary turns the camera by nothing.
//
// `specs/controls.md` § Clicks and drags: "A drag turns the camera by the
// movement it makes after it becomes one; the movement that carried it across the
// boundary turns nothing." A press becomes a drag on the move that "reaches
// `CLICK_SLOP` (`6`) logical pixels" from where it went down, so the first move
// below — exactly `CLICK_SLOP` rightward — is the boundary crossing, and the
// second is the whole of the movement the camera turns by.
//
// THE TWO READINGS THE RULE SEPARATES. `right` raises the yaw by `ORBIT_PER_PX`
// (`0.25`) degrees a logical pixel, so a build that turns by the `AFTER_PX`
// (`40`) pixels made after the crossing reads `CAMERA_START_YAW` plus `10`
// degrees, and a build that also turns by the `6` that made the crossing reads
// `11.5` — a gap of `1.5` degrees, six times the tolerance. The tolerance itself
// is one logical pixel of drag, because a build is free to keep the pointer at
// whole logical pixels.
//
// The yaw is the axis under test because it runs free (`specs/controls.md`: "yaw
// runs free and wraps"), so neither reading can be nipped by a limit: `45` plus
// either turn is well short of the wrap.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose } from "../assert";
import {
  CAMERA_START_YAW,
  CLICK_SLOP,
  ORBIT_PER_PX,
  STAGE_H,
  STAGE_W,
} from "../constants";
import { createHarness, openSite, type Harness } from "../harness";

/** Where the press goes down: the middle of the stage. */
const PRESS = { x: STAGE_W / 2, y: STAGE_H / 2 } as const;

/** The rightward movement made after the press has become a drag. */
const AFTER_PX = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("turns the camera by the movement after the crossing alone", async () => {
  await openSite(h, 0);

  await h.pointerDown(PRESS.x, PRESS.y);
  await h.advance(1);
  // Exactly CLICK_SLOP: the move that makes the press a drag.
  await h.pointerMove(PRESS.x + CLICK_SLOP, PRESS.y);
  await h.advance(1);
  // The movement the drag turns by.
  await h.pointerMove(PRESS.x + CLICK_SLOP + AFTER_PX, PRESS.y);
  await h.advance(1);
  await h.pointerUp();
  await h.advance(1);

  const { camera } = await h.snapshot();
  await h.advance(1);
  await h.capture("state", "the yard after a drag past the slop boundary");

  assertClose(
    camera.yaw,
    CAMERA_START_YAW + ORBIT_PER_PX * AFTER_PX,
    ORBIT_PER_PX,
    `the camera yaw after a drag whose ${CLICK_SLOP}-pixel crossing turns ` +
      `nothing and whose ${AFTER_PX} pixels after it turn at ORBIT_PER_PX ` +
      `(${ORBIT_PER_PX}) degrees a pixel (specs/controls.md)`,
  );
});
