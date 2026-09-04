// screens/fail-copy-load-struck-obstacle — a carried load driven into an obstacle
// is read out as THE LOAD STRUCK AN OBSTACLE.
//
// specs/ui.md § The failure copy fixes the words every cause is read out in:
// "Each failure cause (`specs/statics.md`) is shown as the fixed copy `FAIL_TEXT`
// gives it", and its table gives `load-struck-obstacle` the copy `THE LOAD STRUCK
// AN OBSTACLE`. This check decides that one row of that table, and no other.
//
// THE TROLLEY CARRIES THE CRATE INTO A BOX NOTHING ELSE CAN REACH.
// specs/statics.md § Collisions: "An attached load whose box, at its current
// position and yaw, reaches inside an obstacle ends the run as
// `load-struck-obstacle`." The crate hangs on the hook and the tape runs the
// trolley outward along the track, which carries it into the box.
//
// THE CARRY IS POSED UP TO THE EDGE OF THE BOX AND NO FURTHER. The crate is hung
// with `setLoadPhase(0, "attached")`, which "hangs that load on the hook exactly
// as a successful `attach` leaves it, without the candidate search"
// (`specs/instrumentation.md`) — the candidate search is another point's, and
// reaching this one through the tape's `attach` would put a second verdict on the
// way to it. The trolley is then posed `CARRY_AT` along its track with the bob
// and the crate under it, at rest: the crate's box reaches to `x` of `2.2` there,
// clear of the box's `2.6` face, so what is posed is a carry in progress and the
// strike itself is still the simulation's. The ticks that follow are the ones
// that drive the trolley the rest of the way and put the crate inside.
//
// THE BOX IS PLACED WHERE ONLY THE CRATE CAN GO. Every node of the minimal crane
// below `y = 3` stands at `x` of `2` or less — the tower, the ring, and its two
// flanges — and every member of the arm lies at `y = 4` or above, so a box that
// begins at `x` `2.6` and stops at `y` `3` is out of reach of every member both at
// build time and as the run goes on (specs/world.md § Obstacles: a body meets an
// obstacle only "strictly between the box's minimum and its maximum on all three
// axes"). The crate's box, `2` wide about its lift point, is the one body that
// reaches inside it. The cable and the trolley are tested against nothing, and the
// hook is tested against the ground only while no load is attached.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import { HOIST_START, FAIL_TEXT } from "../constants";
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
import { drawnText, toDrawCall, type RecordedOp } from "../case-harness/index";

/** The cause this check drives the run to. */
const CAUSE = "load-struck-obstacle" as const;

/** Site 1. Which site it is decides nothing here; its yard is emptied. */
const SITE = 0;

/** The minimal crane's pivot at the run-start posture: the track origin. */
const PIVOT = { x: 0, y: 4, z: 0 };

/** Where the run hangs the bob, and so where a load is taken with no motion. */
const HOOK = { x: PIVOT.x, y: PIVOT.y - HOIST_START, z: PIVOT.z, yaw: 0 };

/** Light: this check is about the obstacle, not about what the crane carries. */
const LOAD_MASS = 40;

/**
 * A box out along the track, clear of every member and of the crate at rest.
 *
 * It begins past the tower's `x` of `2` and stops below the arm's `y` of `4`, and
 * the crate begins `1` short of its near face.
 */
const WALL_MIN = { x: 2.6, y: 0, z: -1 };
const WALL_SIZE = { x: 2, y: 3, z: 2 };

/**
 * The trolley run out to the track's far end, slowly.
 *
 * A rate well under the axis's maximum keeps the swing the acceleration starts
 * small, so the crate travels under the trolley rather than being thrown around
 * it: what reaches the box is the load being carried into it.
 */
const TRAVEL: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "trolley", target: 4, rate: 1 }],
};

/** How far along the track the carry is posed: a crate's half-width short. */
const CARRY_AT = 1.2;

/** Where the crate rides at that trolley position: under the pivot, at rest. */
const CARRY = { x: CARRY_AT, y: HOOK.y, z: HOOK.z, yaw: 0 } as const;

/** Ticks driven between readings while the crate is carried the last stretch. */
const STRIDE = 10;

/** Readings the run is given: many times the travel the strike needs. */
const READINGS = 30;

/**
 * Every run of text the last frame drew on the screen layer.
 *
 * specs/overview.md fixes where a readout lives — "over it the screen-space
 * readouts are drawn on a 2D layer composited on top of the picture, laid out in
 * logical stage units" — so the words a screen shows are the runs of text that
 * layer's frame issued, whatever font, colour, or arrangement a build chose for
 * them.
 */
async function screenText(harness: Harness): Promise<string[]> {
  const ops = (await harness.page.evaluate(() =>
    (window as unknown as Record<string, { last(): unknown[] }>)[
      "__tcabRec"
    ]!.last(),
  )) as RecordedOp[];
  return drawnText(ops.map(toDrawCall));
}

/** The copy this check is about. */
const COPY = FAIL_TEXT[CAUSE];

/** The nine it must not be confused with. */
const OTHER_COPY = Object.entries(FAIL_TEXT).filter(
  ([cause]) => cause !== CAUSE,
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads a carried load driven into an obstacle out as THE LOAD STRUCK AN OBSTACLE", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", LOAD_MASS, CARRY, CARRY);
  await addOneObstacle(h, WALL_MIN, WALL_SIZE);
  await poseTape(h, [TRAVEL]);

  await startRun(h);
  // The carry, posed before the first tick: the trolley part way along its track,
  // the bob at rest under it, and the crate on the hook there.
  await h.debug.setAxis("trolley", CARRY_AT);
  await h.debug.setBob(CARRY.x, CARRY.y, CARRY.z);
  await h.debug.setBobVelocity(0, 0, 0);
  await h.debug.setLoadPhase(0, "attached");
  await h.debug.setLoadPose(0, CARRY.x, CARRY.y, CARRY.z, CARRY.yaw);

  let ended = await runTicks(h, STRIDE);
  for (let i = 1; i < READINGS && ended.run.phase === "running"; i += 1) {
    ended = await runTicks(h, STRIDE);
  }
  // The frame that FOLLOWS the tick that ended it: a failed run "stays here, the
  // scene as it stood, with the failure copy below shown plainly"
  // (specs/ui.md § Run), and nothing ticks under the reading.
  await h.advance(1);
  await h.capture(
    "fail-copy",
    "the run screen after the carried load struck an obstacle",
  );

  if (ended.run.phase === "running") {
    fail(
      `the run to end within ${STRIDE * READINGS} ticks, the trolley carrying ` +
        "the crate into the box (specs/statics.md § Collisions)",
      `it is still running at tick ${ended.run.tick}`,
    );
  }

  assertEqual(
    ended.run.cause,
    CAUSE,
    "the cause the scenario failed the run with (specs/statics.md)",
  );

  const shown = (await screenText(h)).join(" | ");
  if (!shown.toUpperCase().includes(COPY)) {
    fail(
      `the copy \`FAIL_TEXT\` gives \`${CAUSE}\`, "${COPY}" ` +
        "(specs/ui.md § The failure copy)",
      shown,
    );
  }
  const confused = OTHER_COPY.filter(([, copy]) =>
    shown.toUpperCase().includes(copy),
  );
  if (confused.length > 0) {
    fail(
      `"${COPY}" and no other cause's copy (specs/ui.md § The failure copy)`,
      `it also shows the copy of ${confused.map(([cause]) => cause).join(", ")}`,
    );
  }
});
