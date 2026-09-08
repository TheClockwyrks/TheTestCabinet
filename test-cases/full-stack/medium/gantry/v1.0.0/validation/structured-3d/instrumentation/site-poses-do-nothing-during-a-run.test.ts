// instrumentation/site-poses-do-nothing-during-a-run — a site pose made while a
// run is in progress reaches the yard and leaves the run alone.
//
// `specs/instrumentation.md` § The site: "The site poses apply wherever the game
// stands, run or no run: the yard is the open site's and the screen is the
// player's route to it." The rule above the tables is what puts them there: "No
// operation asks which screen is showing, whether a run is in progress, or which
// tool is selected."
//
// WHAT KEEPS A RUN ON ITS AUTHORED YARD IS NOT THE GATE, and this is what decides
// that. "The loads a run carries are the ones standing when it starts",
// index-aligned with them: `run.loads` is the RUN'S copy, taken at the start, so
// editing the site mid-run moves `site.loads` and `site.obstacles` and moves
// nothing the running simulation is reading. A build that shares one list
// between the two would show the edit in `run.loads` and fail here.
//
// THE READING IS TAKEN AFTER EVERY ONE OF THE FIVE, because they land differently:
// a build that gated on the run would refuse all five, and one that shared the
// list would show two of them in the run. Nothing is advanced between them, so
// the only thing that could have moved either list is the call just made.
//
// THE RUN IS TEN TICKS IN, not at its first tick, so the run is unambiguously
// under way; the tape is one slow trolley move, long enough that the run cannot
// end while the five calls are made and gentle enough that the crane just stands
// there and carries the hook. No pose reaches a verdict, so the run is still
// running after each.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  addOneLoad,
  addOneObstacle,
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type GantrySnapshot,
} from "../harness";

/** The yard the run starts with: one load, and one obstacle well clear of it. */
const FROM = { x: 8, y: 2, z: 0, yaw: 0 } as const;
const PAD = { x: -6, y: 2, z: 0, yaw: 0 } as const;
const OBSTACLE_MIN = { x: 10, y: 0, z: 10 } as const;
const OBSTACLE_SIZE = { x: 2, y: 2, z: 2 } as const;

/** The run's own load entries, as one comparable string. */
function runLoads(s: GantrySnapshot): string {
  return JSON.stringify(s.run.loads);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reaches the yard mid-run and leaves the run's own loads alone", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", 40, FROM, PAD);
  await addOneObstacle(h, OBSTACLE_MIN, OBSTACLE_SIZE);
  // The track is four units long, so this runs for about four and a half seconds:
  // far longer than the five calls below, which take no tick at all.
  await poseTape(h, [
    { kind: "move", commands: [{ axis: "trolley", target: 4, rate: 1 }] },
  ]);

  await startRun(h);
  const running = await runTicks(h, 10);
  const carried = runLoads(running);

  /** Each pose, and what the yard must read after it. */
  const poses: readonly [string, () => Promise<void>, () => Promise<void>][] = [
    [
      "clearLoads",
      () => h.debug.clearLoads(),
      async () => {
        assertEqual(
          (await h.snapshot()).site.loads.length,
          0,
          "the site's loads clearLoads emptied mid-run " +
            "(specs/instrumentation.md)",
        );
      },
    ],
    [
      "addLoad",
      () => h.debug.addLoad("drum", 120, 0, 3, -8, 0),
      async () => {
        assertEqual(
          (await h.snapshot()).site.loads.length,
          1,
          "the load addLoad appended mid-run (specs/instrumentation.md)",
        );
      },
    ],
    [
      "setLoadTarget",
      () => h.debug.setLoadTarget(0, 0, 2, -8, 45),
      async () => {
        assertEqual(
          (await h.snapshot()).site.loads[0]?.to.yaw,
          45,
          "the pad setLoadTarget set mid-run (specs/instrumentation.md)",
        );
      },
    ],
    [
      "clearObstacles",
      () => h.debug.clearObstacles(),
      async () => {
        assertEqual(
          (await h.snapshot()).site.obstacles.length,
          0,
          "the obstacles clearObstacles emptied mid-run " +
            "(specs/instrumentation.md)",
        );
      },
    ],
    [
      "addObstacle",
      () => h.debug.addObstacle(-4, 0, -4, 2, 2, 2),
      async () => {
        assertEqual(
          (await h.snapshot()).site.obstacles.length,
          1,
          "the obstacle addObstacle appended mid-run " +
            "(specs/instrumentation.md)",
        );
      },
    ],
  ];

  try {
    for (const [name, pose, reads] of poses) {
      await pose();
      await h.debug.reconcile();
      await reads();
      const after = await h.snapshot();
      assertEqual(
        runLoads(after),
        carried,
        `the run's own load entries across a ${name} made while a run is in ` +
          'progress: "The loads a run carries are the ones standing when it ' +
          'starts" (specs/instrumentation.md)',
      );
      assertEqual(
        after.run.phase,
        "running",
        `the run across that ${name}: a pose reaches no verdict`,
      );
    }
  } finally {
    // In a `finally`, so a check that fails inside the sweep still leaves
    // the picture that shows why.
    await h.capture("state", "the yard a mid-run site pose reached");
  }
});
