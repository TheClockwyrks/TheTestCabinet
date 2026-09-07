// instrumentation/site-poses-do-nothing-during-a-run — a site pose made while a run
// is in progress does nothing.
//
// `specs/instrumentation.md` § The site: "The site poses apply on the build and
// program screens, with no run in progress." The second half of that precondition is
// what this decides: `clearLoads`, `addLoad`, `setLoadTarget`, `clearObstacles` and
// `addObstacle` change nothing once a run has begun. The rule is what keeps a run
// on its authored yard — "The loads a run carries are the ones standing when it starts" — so a
// build that let the yard be edited mid-run would let a scenario change the world out
// from under the simulation it is measuring.
//
// THE READING IS TAKEN AFTER EVERY ONE OF THE FIVE, because they fail differently: a
// build that gated on the screen alone would refuse the two that clear and accept the
// three that add, and one that gated on nothing would take all five. Nothing is
// advanced between them, so the only thing that could have moved the yard is the call
// just made.
//
// THE RUN IS TEN TICKS IN, not at its first tick, so the run is unambiguously under
// way; the tape is one slow trolley move, long enough that the run cannot end while
// the five calls are made and gentle enough that the crane just stands there and
// carries the hook.

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

/** What the yard and the run's loads read as, as one comparable string. */
function yard(s: GantrySnapshot): string {
  return JSON.stringify([s.site.loads, s.site.obstacles, s.run.loads]);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the yard and the run's loads alone when a site pose is made mid-run", async () => {
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
  const before = yard(running);

  const poses: readonly [string, () => Promise<void>][] = [
    ["clearLoads", () => h.debug.clearLoads()],
    ["addLoad", () => h.debug.addLoad("drum", 120, 0, 3, -8, 0)],
    ["setLoadTarget", () => h.debug.setLoadTarget(0, 0, 2, -8, 45)],
    ["clearObstacles", () => h.debug.clearObstacles()],
    ["addObstacle", () => h.debug.addObstacle(-4, 0, -4, 2, 2, 2)],
  ];

  try {
    for (const [name, pose] of poses) {
      await pose();
      const after = await h.snapshot();
      assertEqual(
        yard(after),
        before,
        `the site's loads, its obstacles and the run's load entries across a ` +
          `${name} made while a run is in progress (specs/instrumentation.md)`,
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
    await h.capture("state", "the yard a mid-run site pose could not touch");
  }
});
