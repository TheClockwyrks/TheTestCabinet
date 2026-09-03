// collisions/member-flush-along-a-face-is-clear — a member lying flush along an
// obstacle's face never strikes it.
//
// specs/statics.md § Collisions: "A body meets an obstacle only where it reaches
// inside the box, as `specs/world.md` states, so a member lying flush along an
// obstacle's face and a load set down flush on its top are both clear of it."
// specs/world.md § Obstacles fixes the rule the sentence rests on: a body meets
// an obstacle only "strictly between the box's minimum and its maximum on all
// three axes", so "a segment grazing a face, a segment lying flush along one, and
// a box resting flush against one are all clear of it".
//
// THE BLOCK IS BUILT AGAINST THE ARM'S OWN PLANE. Every node of the minimal crane
// stands at `z >= 0`, so the plane `z = 0` carries whole members and nothing of
// the crane lies beyond it. The block spans `x 0..4`, `y 3..7`, `z -3..0`: its
// `z = 0` face is that plane, and lying flush along it, well inside the face's
// span, are the rail from `(0, 4, 0)` to `(4, 4, 0)` and the mast strut from
// `(2, 4, 0)` to `(0, 8, 0)` — while not one point of the crane is strictly
// inside the block, since that would take a point with `z < 0`. Every one of
// those segments touches the face and none reaches through it, which is exactly
// the case the specification calls clear.
//
// THE ARM IS HELD STILL, so the flush contact is the same on every tick of the
// window rather than a moment the run sweeps through: the tape turns the grip,
// which moves no member (specs/rigging.md § The grip), and the five seconds
// driven here sit well inside the eight the tape runs for.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { GRIP_MAX_RATE } from "../constants";
import {
  addOneObstacle,
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

/** The block whose `z = 0` face carries the rail and a mast strut flush. */
const BLOCK_MIN = { x: 0, y: 3, z: -3 } as const;
const BLOCK_SIZE = { x: 4, y: 4, z: 3 } as const;

/** Ticks the contact is held for: five seconds of run clock. */
const WINDOW = 300;

/** A tape that turns the grip, so no member moves for the whole window. */
const HOLD: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 360, rate: GRIP_MAX_RATE }],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("runs on with members lying flush along an obstacle's face", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneObstacle(h, BLOCK_MIN, BLOCK_SIZE);
  await poseTape(h, HOLD);
  await startRun(h);

  const s = await runTicks(h, WINDOW);
  await h.capture("flush", "The rail lying flush along the block's face");

  assertNull(
    s.run.cause,
    `the failure cause after ${WINDOW} ticks with the rail and a mast strut ` +
      "lying flush in the block's z = 0 face and no point of the crane " +
      "strictly inside it: contact is not collision (specs/statics.md, " +
      "specs/world.md)",
  );
  assertEqual(
    s.run.phase,
    "running",
    `the run after ${WINDOW} ticks with members flush along the block's face`,
  );
});
