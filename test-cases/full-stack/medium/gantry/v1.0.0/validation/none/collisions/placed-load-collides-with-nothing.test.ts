// collisions/placed-load-collides-with-nothing — a placed load is tested against
// nothing.
//
// specs/statics.md § Collisions, the body table: "The cable, the trolley, the
// slew ring, the counterweights, the anchor mounts, waiting loads, and placed
// loads" are tested against "Nothing"; the load rows above it test "An attached
// load" alone. specs/world.md § Loads says what a placed load then does: it "sits
// at exactly its target pose for the rest of the run and is solid to nothing".
//
// THE PAD IS PUT INSIDE THE BLOCK ON PURPOSE. The crate's target pose is
// `(10, 2, 0)`, so the box it sits in once placed (specs/world.md § Loads) fills
// `x 9..11`, `y 0..2`, `z -1..1`, and the block posed over it fills `x 9..11`,
// `y 0..4`, `z -1..1` — the crate's whole middle is strictly inside it. A load
// that were tested there would end the run at once; a placed one sits in it.
//
// THE LOAD IS SET DOWN THROUGH THE SURFACE rather than flown there, because what
// this check decides is what a PLACED load collides with and not how one is
// released: `setLoadPhase(0, "placed")` "sets the load down exactly as a
// successful `release` leaves it: it sits at exactly its target pose and stays
// there for the rest of the run" (specs/instrumentation.md § The run in
// progress). The crane stands at `x <= 4`, a clear five units from the block, and
// the tape turns the grip alone, so nothing else in the run goes near it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull, assertVec3Near } from "../assert";
import { GRIP_MAX_RATE, LOAD_CLASS_DIMENSIONS } from "../constants";
import {
  addOneLoad,
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

/** Where the crate waits, and the pad it is wanted on, inside the block. */
const START = { x: 8, y: LOAD_CLASS_DIMENSIONS.crate.y, z: 0, yaw: 0 } as const;
const TARGET = {
  x: 10,
  y: LOAD_CLASS_DIMENSIONS.crate.y,
  z: 0,
  yaw: 0,
} as const;

/** The block standing over the pad, well clear of the crane. */
const BLOCK_MIN = { x: 9, y: 0, z: -1 } as const;
const BLOCK_SIZE = { x: 2, y: 4, z: 2 } as const;

/** Ticks the placed crate is left sitting in the block: five seconds. */
const WINDOW = 300;

/** A tape that turns the grip and moves nothing near the block. */
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

it("runs on with a placed load sitting inside an obstacle", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", 40, START, TARGET);
  await addOneObstacle(h, BLOCK_MIN, BLOCK_SIZE);
  await poseTape(h, HOLD);
  await startRun(h);

  await h.debug.setLoadPhase(0, "placed");

  const s = await runTicks(h, WINDOW);
  await h.capture("placed", "The placed crate sitting inside the block");

  assertNull(
    s.run.cause,
    `the failure cause after ${WINDOW} ticks with a placed crate sitting ` +
      "strictly inside a block: a placed load is tested against nothing " +
      "(specs/statics.md, the body table)",
  );
  assertEqual(
    s.run.phase,
    "running",
    `the run after ${WINDOW} ticks with the placed crate inside the block`,
  );
  // The guard: the crate must still be sitting where this check put it, since a
  // load that had left the block would make the pass mean nothing.
  assertEqual(
    s.run.loads[0]?.phase,
    "placed",
    "the phase of the load set down on its pad (specs/world.md)",
  );
  assertVec3Near(
    s.run.loads[0]?.pos ?? { x: NaN, y: NaN, z: NaN },
    TARGET,
    1e-6,
    "the placed crate's lift point, which sits at exactly its target pose " +
      "for the rest of the run (specs/world.md)",
  );
});
