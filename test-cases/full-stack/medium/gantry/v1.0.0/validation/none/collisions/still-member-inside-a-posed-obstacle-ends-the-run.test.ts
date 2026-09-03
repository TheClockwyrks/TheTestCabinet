// collisions/still-member-inside-a-posed-obstacle-ends-the-run — a member
// standing inside an obstacle ends the run though nothing moves.
//
// specs/statics.md § Collisions: "Collisions are tested once per tick, at the
// prescribed geometry", and "A member whose segment reaches inside an obstacle
// ends the run as `structure-struck-obstacle`." The test is on each tick's
// geometry rather than on any motion, and specs/instrumentation.md § The site
// puts the case beyond doubt: "a member standing where an obstacle is posed stays
// where it is, and the run that follows ends as `structure-struck-obstacle` on
// the tick the collision test reaches it."
//
// THE MEMBER UNDER THE BLOCK IS A TOWER LEG, which "stands at its lattice
// position whatever the slew" (specs/statics.md § Geometry at a tick): the
// minimal crane's leg from the anchor `(0, 0, 0)` up to the bottom-flange node
// `(0, 2, 0)`. The block is a unit cube centred on that leg's midpoint,
// `x -0.5..0.5`, `y 0.5..1.5`, `z -0.5..0.5`, so the leg's middle unit is
// strictly inside it — and nothing else is: the crane's other members leaving
// `(0, 0, 0)` climb a unit of `x` or of `z` for every unit of `y`, so by the time
// they are above `y = 0.5` they are already past the cube's half-unit walls.
//
// AND THE TAPE COMMANDS AN AXIS NOWHERE NEAR IT: the hoist, lowering the bare
// hook by one unit at a rate of one, which moves no member at all. The run is
// advanced one tick — enough for the collision stage to run once
// (specs/program.md § The tick pipeline) — and the slew is read back at `0`,
// which is what makes this a verdict about the geometry standing still rather
// than about a sweep.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOIST_START } from "../constants";
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

/** The unit cube around the midpoint of the leg `(0, 0, 0)`–`(0, 2, 0)`. */
const BLOCK_MIN = { x: -0.5, y: 0.5, z: -0.5 } as const;
const BLOCK_SIZE = { x: 1, y: 1, z: 1 } as const;

/** A tape on an axis that moves no member: the hoist, down one unit. */
const LOWER: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "hoist", target: HOIST_START + 1, rate: 1 }],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ends the run as structure-struck-obstacle with a member standing inside a posed block", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneObstacle(h, BLOCK_MIN, BLOCK_SIZE);
  await poseTape(h, LOWER);
  await startRun(h);

  const s = await runTicks(h, 1);
  await h.capture(
    "standing",
    "The tower member standing inside the posed block",
  );

  assertEqual(
    s.run.phase,
    "failed",
    "the run after one tick with the tower leg (0, 0, 0)-(0, 2, 0) standing " +
      "strictly inside the posed block (specs/statics.md)",
  );
  assertEqual(
    s.run.cause,
    "structure-struck-obstacle",
    "the cause of a run ended by a member whose segment reaches inside an " +
      "obstacle (specs/statics.md)",
  );
  assertEqual(
    s.run.axes.slew.value,
    0,
    "the slew across the tick that ended the run: nothing swept anywhere, and " +
      "the test is on the tick's geometry (specs/statics.md)",
  );
});
