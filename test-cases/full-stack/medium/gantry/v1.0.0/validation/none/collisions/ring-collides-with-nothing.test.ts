// collisions/ring-collides-with-nothing — the slew ring is tested against
// nothing.
//
// specs/statics.md § Collisions, the body table: "The cable, the trolley, the
// slew ring, the counterweights, the anchor mounts, waiting loads, and placed
// loads" are tested against "Nothing", and the three tests above it "are the
// whole of it". So an obstacle posed around the ring itself ends no run.
//
// THE BLOCK IS PUT AROUND A FLANGE NODE NOTHING ELSE REACHES. The ring occupies
// eight flange nodes (specs/structure.md § The slew ring), and a block around one
// a member ends at would swallow that member's segment and decide a different
// point. So the crane posed here is the minimal crane with the two members that
// end at the top-flange node `(2, 4, 2)` left out — the mast keeps three of the
// four top-flange nodes and the rail tip keeps three members, so the arm is still
// rigid and the crane still stands and is still ready. The block is then a
// `0.8`-unit cube centred on that bare flange node, `x 1.6..2.4`, `y 3.6..4.4`,
// `z 1.6..2.4`: the ring's corner is strictly inside it on all three axes, and
// the nearest member — the tie from `(0, 4, 2)` to the rail tip — passes `x = 2`
// at `z = 1`, a clear half unit outside.
//
// THE ARM IS HELD STILL, so the ring's corner stays inside the block for the
// whole window: the tape turns the grip, which moves no part of the structure
// (specs/rigging.md § The grip), and a slewing arm would carry the top flange out
// of the block and members through it instead.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
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

/** The top-flange node this check leaves bare, and puts a block around. */
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
};

/** The cube around that node: the ring inside it, every member outside. */
const BLOCK_MIN = { x: FLANGE.x - 0.4, y: FLANGE.y - 0.4, z: FLANGE.z - 0.4 };
const BLOCK_SIZE = { x: 0.8, y: 0.8, z: 0.8 } as const;

/** Ticks the ring is held inside the block for: half a second of run clock. */
const WINDOW = 30;

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

it("runs on with an obstacle posed around a flange node of the slew ring", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await poseCrane(h, BARE_FLANGE);
  await addOneObstacle(h, BLOCK_MIN, BLOCK_SIZE);
  await poseTape(h, HOLD);
  await startRun(h);

  const s = await runTicks(h, WINDOW);
  await h.capture(
    "ring-in-the-block",
    "The block around the ring's bare flange corner",
  );

  assertNull(
    s.run.cause,
    `the failure cause after ${WINDOW} ticks with the ring's flange node ` +
      `(${FLANGE.x}, ${FLANGE.y}, ${FLANGE.z}) strictly inside a block that ` +
      "holds no member's segment: the ring is tested against nothing " +
      "(specs/statics.md, the body table)",
  );
  assertEqual(
    s.run.phase,
    "running",
    `the run after ${WINDOW} ticks with the block around the ring`,
  );
});
