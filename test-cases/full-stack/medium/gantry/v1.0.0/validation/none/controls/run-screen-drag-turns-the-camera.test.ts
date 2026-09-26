// controls/run-screen-drag-turns-the-camera — a pointer drag on the run screen
// turns the camera.
//
// `specs/controls.md` § The run screen: "The run screen takes the camera actions,
// a pointer drag on the camera, `speed`, `mute`, and `back` alone", and § Clicks
// and drags says the same from the pointer's side: "a press on the run screen
// turns the camera and nothing else." What that turn is worth is § The camera:
// "Dragging the pointer turns the camera the same way: rightward movement moves
// the yaw as `right` does ... and each turns by `ORBIT_PER_PX` per logical pixel
// of that movement", `ORBIT_PER_PX` being `0.25`.
//
// THE GESTURE IS THREE ACTS, because § Clicks and drags fixes which movement
// counts: "A drag turns the camera by the movement it makes after it becomes one;
// the movement that carried it across the boundary turns nothing." The press goes
// down; one move of exactly `CLICK_SLOP` (`6`) pixels makes it a drag and turns
// nothing; one move of `DRAG_PX` (`100`) pixels rightward is the whole of the
// movement that counts. So the yaw rises by `ORBIT_PER_PX * DRAG_PX` (`25`)
// degrees from wherever the run left it — read first rather than assumed, since a
// run does not reset the camera — and `25` degrees off the start pose's `45` is
// short of the wrap, so the reading is the turn rather than the fold.
//
// THE TOLERANCE IS ONE LOGICAL PIXEL of the drag, `ORBIT_PER_PX` degrees: a build
// is free to keep the pointer at whole logical pixels (`specs/state.md` fixes the
// units the position is in and not its precision). A build that turned by the
// whole `106` pixels instead misses by `1.5` degrees, six times that.
//
// A REAL RUN, AND ONE THAT CANNOT END UNDER THE DRAG. The tape is one long grip
// turn — `grip` is the hook's yaw, so it asks nothing of the structure, and `360`
// degrees at `GRIP_MAX_RATE` (`45`) is eight seconds of run clock against the
// four ticks this gesture rides on. The world is emptied first, so no load and no
// obstacle can end the run instead.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertEqual } from "../assert";
import {
  CLICK_SLOP,
  GRIP_MAX_RATE,
  ORBIT_PER_PX,
  STAGE_H,
  STAGE_W,
} from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** Where the press goes down: the middle of the stage. */
const PRESS = { x: STAGE_W / 2, y: STAGE_H / 2 } as const;

/** The rightward movement made after the press has become a drag. */
const DRAG_PX = 100;

/** A tape that keeps a run in progress and asks nothing of the structure. */
const HOLD_TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 360, rate: GRIP_MAX_RATE }],
  },
];

/** Ticks driven first, so the drag lands on a run under way. */
const TICKS = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises the yaw by ORBIT_PER_PX per pixel dragged on the run screen", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, HOLD_TAPE);
  await startRun(h);
  const running = await runTicks(h, TICKS);
  assertEqual(running.screen, "run", "the screen the drag is made on");
  assertEqual(running.run.phase, "running", "the run the drag is made during");
  const before = running.camera.yaw;

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

  const after = await h.snapshot();

  await h.capture("state", "the run screen after a rightward orbit drag");

  assertClose(
    after.camera.yaw,
    before + ORBIT_PER_PX * DRAG_PX,
    ORBIT_PER_PX,
    `the camera yaw after a drag of ${DRAG_PX} logical pixels rightward on ` +
      `the run screen, which takes a pointer drag on the camera and turns at ` +
      `ORBIT_PER_PX (${ORBIT_PER_PX}) degrees a pixel ` +
      "(specs/controls.md § The run screen, § The camera)",
  );
});
