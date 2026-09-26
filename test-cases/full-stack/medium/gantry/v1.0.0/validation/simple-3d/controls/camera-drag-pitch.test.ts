// controls/camera-drag-pitch — a drag toward the top of the stage raises the
// pitch at `ORBIT_PER_PX` per logical pixel.
//
// `specs/controls.md` § The camera: "Dragging the pointer turns the camera the
// same way: rightward movement moves the yaw as `right` does, movement toward the
// top of the stage moves the pitch as `up` does, and each turns by
// `ORBIT_PER_PX` per logical pixel of that movement", with `ORBIT_PER_PX`
// (`0.25`), and "`up` raises the pitch". § Clicks and drags fixes which movement
// counts: "A drag turns the camera by the movement it makes after it becomes one;
// the movement that carried it across the boundary turns nothing."
//
// SO THE GESTURE IS THREE ACTS. The press goes down; one move of exactly
// `CLICK_SLOP` (`6`) pixels toward the top makes it a drag and turns nothing; one
// move of `DRAG_PX` (`100`) pixels further toward the top is the whole of the
// movement that counts. The pitch rises by `ORBIT_PER_PX * DRAG_PX` (`25`)
// degrees, from `CAMERA_START_PITCH` (`30`) to `55` — clear of
// `CAMERA_PITCH_MAX` (`80`), so the reading is the turn rather than the clamp.
//
// THE TOLERANCE IS ONE LOGICAL PIXEL of the drag, `ORBIT_PER_PX` degrees: a build
// is free to keep the pointer at whole logical pixels (`specs/state.md` fixes the
// units the position is in and not its precision). A build that turned by the
// whole `106` pixels instead misses by `1.5` degrees, six times that.
//
// The press goes down low on the stage so the whole gesture stays on it: a
// logical stage position is what the pointer operations take
// (`specs/instrumentation.md`), and this one never leaves the 1280 by 720 stage.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose } from "../assert";
import {
  CAMERA_START_PITCH,
  CLICK_SLOP,
  ORBIT_PER_PX,
  STAGE_W,
} from "../constants";
import { createHarness, openSite, type Harness } from "../harness";

/** Where the press goes down: low on the stage, with room to drag upward. */
const PRESS = { x: STAGE_W / 2, y: 500 } as const;

/** The movement toward the top of the stage made after the press is a drag. */
const DRAG_PX = 100;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises the pitch by ORBIT_PER_PX per pixel dragged toward the top", async () => {
  await openSite(h, 0);

  await h.pointerDown(PRESS.x, PRESS.y);
  await h.advance(1);
  // The move that carries the press across the boundary: it makes the press a
  // drag and turns nothing.
  await h.pointerMove(PRESS.x, PRESS.y - CLICK_SLOP);
  await h.advance(1);
  // The movement the drag turns by, toward the top of the stage.
  await h.pointerMove(PRESS.x, PRESS.y - CLICK_SLOP - DRAG_PX);
  await h.advance(1);
  await h.pointerUp();
  await h.advance(1);

  const { camera } = await h.snapshot();
  await h.advance(1);
  await h.capture("state", "the yard after an upward orbit drag");

  assertClose(
    camera.pitch,
    CAMERA_START_PITCH + ORBIT_PER_PX * DRAG_PX,
    ORBIT_PER_PX,
    `the camera pitch after a drag of ${DRAG_PX} logical pixels toward the ` +
      `top of the stage, which turns at ORBIT_PER_PX (${ORBIT_PER_PX}) ` +
      "degrees a pixel (specs/controls.md)",
  );
});
