// collisions/counterweights-collide-with-nothing — a counterweight is tested
// against nothing.
//
// specs/statics.md § Collisions, the body table: "The cable, the trolley, the
// slew ring, the counterweights, the anchor mounts, waiting loads, and placed
// loads" are tested against "Nothing". So a counterweight standing inside an
// obstacle ends no run, however long it stands there.
//
// THE COUNTERWEIGHT STANDS ON A NODE NO MEMBER REACHES. A counterweight goes "on
// any node the structure uses, a node a member ends at or a flange node of the
// ring" (specs/structure.md § Counterweights), and the second of those is what
// this check needs: a block around a node a member ends at would swallow that
// member's segment and decide a different point. So the crane posed here is the
// minimal crane with the two members that end at the top-flange node `(2, 4, 2)`
// left out — the mast keeps three of the four top-flange nodes and the rail tip
// keeps three members, so the arm is still rigid and the crane still stands and
// is still ready — and the counterweight is placed on that bare flange node.
//
// THE BLOCK IS A `0.8`-UNIT CUBE CENTRED ON IT, `x 1.6..2.4`, `y 3.6..4.4`,
// `z 1.6..2.4`: the counterweight's node is strictly inside it on all three axes,
// and the nearest member — the tie from `(0, 4, 2)` to the rail tip — passes
// `x = 2` at `z = 1`, a clear half unit outside.
//
// THE ARM IS HELD STILL, so the counterweight stays inside the block for the
// whole window: the tape turns the grip, which moves no part of the structure
// (specs/rigging.md § The grip), and a slewing arm would carry the flange out of
// the block and members through it instead.
//
// A SECOND OF RUN CLOCK IS THE WINDOW. The collision stage runs on every tick of
// the pipeline (specs/program.md § The tick pipeline), and nothing about this
// scene changes from one tick to the next — the arm is still, the block is fixed,
// and the counterweight stands where it was posed — so sixty consecutive
// collision tests over an unchanging geometry is the whole of what there is to
// read. Driving longer re-runs the same test against the same arrangement.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNull } from "../assert";
import { GRIP_MAX_RATE } from "../constants";
import {
  MINIMAL_CRANE,
  addOneObstacle,
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
  startRun,
  type CraneDesign,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The top-flange node the counterweight stands on, alone. */
const FLANGE = { x: 2, y: 4, z: 2 } as const;

/** The minimal crane with no member ending at that flange node. */
const BARE_FLANGE: CraneDesign = {
  ...MINIMAL_CRANE,
  name: "Minimal, with a bare top-flange node",
  members: MINIMAL_CRANE.members.filter(
    ([a, b]) =>
      !(a[0] === FLANGE.x && a[1] === FLANGE.y && a[2] === FLANGE.z) &&
      !(b[0] === FLANGE.x && b[1] === FLANGE.y && b[2] === FLANGE.z),
  ),
  counterweights: [[FLANGE.x, FLANGE.y, FLANGE.z]],
};

/** The cube around that node: the counterweight inside, every member outside. */
const BLOCK_MIN = { x: FLANGE.x - 0.4, y: FLANGE.y - 0.4, z: FLANGE.z - 0.4 };
const BLOCK_SIZE = { x: 0.8, y: 0.8, z: 0.8 } as const;

/** Ticks the counterweight is held inside for: one second of run clock. */
const WINDOW = 60;

/** A tape that turns the grip, so the arm never carries the flange out. */
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

it("runs on with a counterweight standing inside an obstacle", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await poseCrane(h, BARE_FLANGE);
  // The guard: `poseCrane` reports a refused counterweight, and this reads back
  // that the block below really has one standing inside it.
  assertLength(
    (await h.snapshot()).structure.counterweights,
    1,
    `the counterweight standing on the flange node (${FLANGE.x}, ` +
      `${FLANGE.y}, ${FLANGE.z}) (specs/structure.md)`,
  );

  await addOneObstacle(h, BLOCK_MIN, BLOCK_SIZE);
  await poseTape(h, HOLD);
  await startRun(h);

  const s = await runTicks(h, WINDOW);
  await h.capture("weight", "The counterweight standing inside the obstacle");

  assertNull(
    s.run.cause,
    `the failure cause after ${WINDOW} ticks with a counterweight strictly ` +
      "inside a block that holds no member's segment: counterweights are " +
      "tested against nothing (specs/statics.md, the body table)",
  );
  assertEqual(
    s.run.phase,
    "running",
    `the run after ${WINDOW} ticks with the block around the counterweight`,
  );
});
