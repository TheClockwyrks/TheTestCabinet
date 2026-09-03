// controls/camera-drag-yaw — a rightward drag turns the yaw at `ORBIT_PER_PX`
// per logical pixel.
//
// `specs/controls.md` § The camera: "Dragging the pointer turns the camera the
// same way: rightward movement moves the yaw as `right` does, movement toward the
// top of the stage moves the pitch as `up` does, and each turns by
// `ORBIT_PER_PX` per logical pixel of that movement", with `ORBIT_PER_PX`
// (`0.25`). § Clicks and drags fixes which movement counts: "A drag turns the
// camera by the movement it makes after it becomes one; the movement that carried
// it across the boundary turns nothing."
//
// SO THE GESTURE IS THREE ACTS. The press goes down; one move of exactly
// `CLICK_SLOP` (`6`) pixels makes it a drag and turns nothing; one move of
// `DRAG_PX` (`100`) pixels rightward is the whole of the movement that counts.
// `right` raises the yaw, so the yaw rises by `ORBIT_PER_PX * DRAG_PX` (`25`)
// degrees, from `CAMERA_START_YAW` (`45`) to `70` — short of the wrap, so the
// reading is the turn rather than the fold.
//
// THE TOLERANCE IS ONE LOGICAL PIXEL of the drag, `ORBIT_PER_PX` degrees: a build
// is free to keep the pointer at whole logical pixels (`specs/state.md` fixes the
// units the position is in and not its precision). A build that turned by the
// whole `106` pixels instead misses by `1.5` degrees, six times that.
//
// A frame runs after each act, because "a build is free to act on an event as it
// arrives or on the frame that reads it, so a caller that needs the game to have
// consumed one runs a frame after it" (`specs/instrumentation.md`).

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
const DRAG_PX = 100;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises the yaw by ORBIT_PER_PX per pixel dragged rightward", async () => {
  await openSite(h, 0);

  await h.pointerDown(PRESS.x, PRESS.y);
  await h.advance(1);
  // The move that carries the press across the boundary: it makes the press a
  // drag and turns nothing.
  await h.pointerMove(PRESS.x + CLICK_SLOP, PRESS.y);
  await h.advance(1);
  // The movement the drag turns by.
  await h.pointerMove(PRESS.x + CLICK_SLOP + DRAG_PX, PRESS.y);
  await h.advance(1);
  await h.pointerUp();
  await h.advance(1);

  const { camera } = await h.snapshot();
  assertClose(
    camera.yaw,
    CAMERA_START_YAW + ORBIT_PER_PX * DRAG_PX,
    ORBIT_PER_PX,
    `the camera yaw after a drag of ${DRAG_PX} logical pixels rightward, ` +
      `which turns at ORBIT_PER_PX (${ORBIT_PER_PX}) degrees a pixel ` +
      "(specs/controls.md)",
  );

  await h.capture("state", "the yard after a rightward orbit drag");
});
