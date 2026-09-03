// controls/drag-pitch-held-inside-its-limits — a drag cannot carry the pitch past
// `CAMERA_PITCH_MAX`.
//
// `specs/controls.md` § The camera: "Pitch is held inside its limits and distance
// inside its", with the limits `CAMERA_PITCH_MIN` (`10`) to `CAMERA_PITCH_MAX`
// (`80`). The sentence is about the pitch whatever moves it, and the drag is one
// of the two things that move it: "movement toward the top of the stage moves the
// pitch as `up` does, and each turns by `ORBIT_PER_PX` per logical pixel of that
// movement."
//
// THE DRAG ASKS FOR FAR MORE THAN THE LIMIT ALLOWS. From `CAMERA_START_PITCH`
// (`30`), a drag of `DRAG_PX` (`600`) logical pixels toward the top of the stage
// asks for `ORBIT_PER_PX * 600` (`150`) degrees more, which is `180` — a pitch
// past the vertical and more than twice the limit. A build that holds the pitch
// inside its limits reads exactly `CAMERA_PITCH_MAX`, because the limit is where
// a demand that overshoots it stops; a build that lets the drag run reads
// something above it.
//
// THE READING IS THE LIMIT ITSELF rather than a range, so a build that quietly
// stopped short — refusing the whole move, or turning at some other rate — fails
// beside one that ran past. The tolerance is nothing but floating-point slack.
//
// The press goes down near the bottom of the stage and the drag ends near the
// top, so the whole gesture stays on the 1280 by 720 stage
// (`specs/instrumentation.md` takes logical stage positions). The move of exactly
// `CLICK_SLOP` (`6`) that comes first is the one that makes the press a drag, and
// it turns nothing.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose } from "../assert";
import {
  CAMERA_PITCH_MAX,
  CLICK_SLOP,
  ORBIT_PER_PX,
  STAGE_W,
} from "../constants";
import { createHarness, openSite, type Harness } from "../harness";

/** Where the press goes down: near the bottom of the stage. */
const PRESS = { x: STAGE_W / 2, y: 700 } as const;

/** The movement toward the top made after the press has become a drag. */
const DRAG_PX = 600;

/** Floating-point slack, and nothing else: the limit is an exact figure. */
const TOLERANCE = 1e-9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stops the pitch at CAMERA_PITCH_MAX however far the drag asks", async () => {
  await openSite(h, 0);

  await h.pointerDown(PRESS.x, PRESS.y);
  await h.advance(1);
  // The move that carries the press across the boundary: it turns nothing.
  await h.pointerMove(PRESS.x, PRESS.y - CLICK_SLOP);
  await h.advance(1);
  // A drag asking for 150 degrees of pitch, from a pose 50 short of the limit.
  await h.pointerMove(PRESS.x, PRESS.y - CLICK_SLOP - DRAG_PX);
  await h.advance(1);
  await h.pointerUp();
  await h.advance(1);

  const { camera } = await h.snapshot();
  assertClose(
    camera.pitch,
    CAMERA_PITCH_MAX,
    TOLERANCE,
    `the camera pitch after a drag asking for ${ORBIT_PER_PX * DRAG_PX} ` +
      "degrees more, which is held inside CAMERA_PITCH_MAX " +
      `(${CAMERA_PITCH_MAX}) (specs/controls.md)`,
  );

  await h.advance(1);
  await h.capture("state", "the yard with the pitch stopped at its limit");
});
