// collisions/member-strike-precedes-a-load-strike — a member strike is reported
// before a load strike on the same tick.
//
// specs/program.md § The tick pipeline: the collisions stage is "members, the
// load, and the ground", and "the first failure a tick reaches ends the run with
// that cause". specs/statics.md § The failure causes: "Every failed run carries
// exactly one cause, the first the tick pipeline reached". So a tick on which a
// member's segment and the carried load's box both reach inside an obstacle is a
// `structure-struck-obstacle` and not a `load-struck-obstacle`.
//
// ONE BLOCK HOLDS BOTH BODIES. The trolley is put at the end of the minimal
// crane's four-unit track, so the pivot stands at `(4, 4, 0)` and the crate hangs
// from it on the run's own starting cable of `2`, its lift point at `(4, 2, 0)`
// and its `2 x 2 x 2` box (specs/world.md § Loads) filling `x 3..5`, `y 0..2`,
// `z -1..1`. The block fills `x 3..5`, `y 0.5..4.5`, `z -1..1`, so:
//
//   - the rail from `(0, 4, 0)` to `(4, 4, 0)` runs through it at `y = 4`,
//     `z = 0`, its stretch over `x 3..4` strictly inside on all three axes — as
//     do the two ties that reach the tip; and
//   - the middle of the crate's box is strictly inside it too.
//
// AND THE GROUND CANNOT ENTER INTO IT: the crate's bottom face rests at exactly
// `y = 0`, which specs/statics.md calls on the ground rather than through it, so
// the two causes in play are the two this check is about. A block raised clear of
// the rail with the crate hung the same way is what a `load-struck-obstacle`
// looks like; this one only adds the member.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertVec3Near } from "../assert";
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

/** The minimal crane's track: from `(0, 4, 0)` out to `(4, 4, 0)`. */
const TRACK_LENGTH = 4;

/** Where the crate hangs: below the trolley, its bottom face on the ground. */
const LIFT = {
  x: TRACK_LENGTH,
  y: LOAD_CLASS_DIMENSIONS.crate.y,
  z: 0,
} as const;

/** The block: over the crate's middle and around the rail at `y = 4`. */
const BLOCK_MIN = { x: 3, y: 0.5, z: -1 } as const;
const BLOCK_SIZE = { x: 2, y: 4, z: 2 } as const;

/** A tape that turns the grip and moves nothing that carries the load. */
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

it("names the member when a member and the carried load are inside one obstacle", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(
    h,
    "crate",
    40,
    { x: LIFT.x, y: LIFT.y, z: LIFT.z, yaw: 0 },
    { x: LIFT.x, y: LIFT.y, z: LIFT.z, yaw: 0 },
  );
  await addOneObstacle(h, BLOCK_MIN, BLOCK_SIZE);
  await poseTape(h, HOLD);
  await startRun(h);

  await h.debug.setLoadPhase(0, "attached");
  await h.debug.setAxis("trolley", TRACK_LENGTH);
  await h.debug.setBob(LIFT.x, LIFT.y, LIFT.z);
  await h.debug.setBobVelocity(0, 0, 0);

  const s = await runTicks(h, 1);
  await h.capture("both", "The member and the load both inside the one block");

  // The guard: the load must really have been in the block on that tick, or the
  // ordering this check is about was never in question.
  assertVec3Near(
    s.run.bob.pos,
    LIFT,
    0.05,
    "the lift point the tick's rigging left, with the crate's box inside the " +
      "block (specs/rigging.md)",
  );
  assertEqual(
    s.run.phase,
    "failed",
    "the run after one tick with the rail and the carried crate both inside " +
      "the block (specs/statics.md)",
  );
  assertEqual(
    s.run.cause,
    "structure-struck-obstacle",
    "the cause a tick reaches first when a member and the carried load are " +
      "both inside an obstacle: members are tested before the load " +
      "(specs/program.md, specs/statics.md)",
  );
});
