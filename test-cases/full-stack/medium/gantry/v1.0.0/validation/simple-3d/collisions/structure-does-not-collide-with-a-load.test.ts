// collisions/structure-does-not-collide-with-a-load — the structure never
// collides with a load.
//
// specs/statics.md § Collisions: "The structure never collides with itself or
// with a load", and the body table above it tests a member against obstacles
// alone. So a member standing inside the attached load's box raises nothing,
// however long it stands there.
//
// THE ARM IS GIVEN A MEMBER THE HANGING LOAD CAN SWALLOW. Every arm member of the
// minimal crane stands at `y >= 4`, and a load hangs BELOW the pivot, which is on
// the track at `y = 4`, so the minimal crane alone can never put an arm member
// inside a carried box. This crane adds a bracket hanging off the arm: a strut
// straight down from the rail tip `(4, 4, 0)` to `(4, 2, 0)`, tied back to two
// top-flange nodes so the new node is held in three independent directions and
// the arm solve is regular. The bracket belongs to the arm — its node reaches no
// anchor and no bottom-flange node — and the crane still stands and is still
// ready.
//
// THE CRATE IS THEN HUNG AROUND IT. With the trolley at the end of the track the
// pivot is `(4, 4, 0)`, and a cable of `1` puts the crate's lift point at
// `(4, 3, 0)`, so its `2 x 2 x 2` box (specs/world.md § Loads) fills `x 3..5`,
// `y 1..3`, `z -1..1` — and the bracket runs straight down the box's own vertical
// centre line, its stretch from `y = 2` to `y = 3` strictly inside on all three
// axes. That the grip turns the box as the run goes on changes nothing: the
// member lies on the axis the yaw turns about.
//
// AND NOTHING ELSE CAN END THE RUN: the yard holds no obstacle, so no member and
// no load has one to strike, and the crate's bottom face rests at `y = 1`, a
// clear unit above the ground.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull, assertVec3Near } from "../assert";
import { GRIP_MAX_RATE } from "../constants";
import {
  MINIMAL_CRANE,
  addOneLoad,
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

/** The minimal crane's track: from `(0, 4, 0)` out to `(4, 4, 0)`. */
const TRACK_LENGTH = 4;

/** The cable length that hangs the crate around the bracket. */
const CABLE = 1;

/** Where the crate's lift point hangs. */
const LIFT = { x: TRACK_LENGTH, y: 4 - CABLE, z: 0 } as const;

/** The minimal crane, with a braced bracket hanging under its rail tip. */
const BRACKETED: CraneDesign = {
  ...MINIMAL_CRANE,
  name: "Minimal, with a bracket under the rail tip",
  members: [
    ...MINIMAL_CRANE.members,
    [[4, 4, 0], [4, 2, 0], "strut"],
    [[0, 4, 0], [4, 2, 0], "strut"],
    [[0, 4, 2], [4, 2, 0], "strut"],
  ],
};

/**
 * Ticks the member is held inside the box for: one second of run clock.
 *
 * A WHOLE SWING, and that is why it is not shortened. The bob is posed at rest
 * straight below the pivot and the pendulum carries it out and back over about
 * this many ticks, so the guard below — that the crate really stood where this
 * check says it stood — reads a lift point the swing has returned to rather than
 * one part way through its excursion. The ticks are driven as one batch, so the
 * window costs one crossing into the page whatever its length.
 */
const WINDOW = 60;

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

it("runs on with an arm member standing inside the attached load's box", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await poseCrane(h, BRACKETED);
  await addOneLoad(
    h,
    "crate",
    40,
    { x: LIFT.x, y: LIFT.y, z: LIFT.z, yaw: 0 },
    { x: LIFT.x, y: LIFT.y, z: LIFT.z, yaw: 0 },
  );
  await poseTape(h, HOLD);
  await startRun(h);

  await h.debug.setLoadPhase(0, "attached");
  await h.debug.setAxis("trolley", TRACK_LENGTH);
  await h.debug.setAxis("hoist", CABLE);
  await h.debug.setBob(LIFT.x, LIFT.y, LIFT.z);
  await h.debug.setBobVelocity(0, 0, 0);

  const s = await runTicks(h, WINDOW);
  await h.capture(
    "through-the-load",
    "The bracket standing inside the carried crate",
  );

  assertNull(
    s.run.cause,
    `the failure cause after ${WINDOW} ticks with the arm's bracket strut ` +
      "standing inside the carried crate's box: the structure never collides " +
      "with a load (specs/statics.md)",
  );
  assertEqual(
    s.run.phase,
    "running",
    `the run after ${WINDOW} ticks with a member inside the carried crate`,
  );
  // The guard: the box and the member must really have been where this check
  // says. The arm stands at its lattice positions while `slew` is `0`.
  assertEqual(
    s.run.axes.slew.value,
    0,
    "the slew the run held, so the bracket stood at its lattice position " +
      "(specs/statics.md § Geometry at a tick)",
  );
  assertVec3Near(
    s.run.bob.pos,
    LIFT,
    0.05,
    "the lift point the rigging held, with the bracket down the box's own " +
      "centre line (specs/rigging.md)",
  );
});
