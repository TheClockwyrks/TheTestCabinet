// collisions/member-sweeps-into-an-obstacle — a member that sweeps into an
// obstacle ends the run.
//
// specs/statics.md § Collisions: "A member whose segment reaches inside an
// obstacle ends the run as `structure-struck-obstacle`. Members standing clear at
// build time can sweep into an obstacle as the arm turns; the test catches them
// tick by tick."
//
// THE BLOCK STANDS WHERE THE ARM IS GOING AND NOT WHERE IT IS, and it stands
// JUST outside the arm's resting reach so the sweep that carries a member inside
// it is a short one. No node of the minimal crane stands further than `x = 4`
// from the origin, and the block spans `x 4.05..5.05`, `y 3.5..4.5`, `z
// 0.05..1.05`, so at the run's starting `slew` of `0` (specs/program.md) no
// member's segment is inside it — which the first tick of the run is read to
// confirm, because a member already inside at build time would decide a different
// point.
//
// The arm turns about the slew axis through `(1, ., 1)` (specs/structure.md § The
// slew ring), so the rail tip at `(4, 4, 0)` — `sqrt(10)` from that axis and the
// furthest point of the crane from it — swings along an arc that carries it OUT
// to `x = 1 + sqrt(10)` before it comes back in. A few degrees of turn is enough
// to put it, and the rail and ties that reach it, strictly inside the block on all
// three axes.
//
// THE TAPE IS ONE SLEW COMMAND, which is the whole of what this needs, and the
// sweep is driven in batches rather than a tick at a time: nothing here is about
// the tick the strike lands on, only about the run ending with the cause a strike
// ends it with. A build that never notices runs its tape out and ends with no
// cause at all — which is the failure this check wants to report, rather than a
// timeout.
//
// AND THE YARD CARRIES NOTHING ELSE: no load to strike anything, and the bare
// hook stays two units below a pivot that never drops below `y = 4`, so the only
// body that can reach the block is a member.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SLEW_MAX_RATE } from "../constants";
import {
  addOneObstacle,
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type GantrySnapshot,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The block just beyond the arm's resting reach, in the path it swings out on. */
const BLOCK_MIN = { x: 4.05, y: 3.5, z: 0.05 } as const;
const BLOCK_SIZE = { x: 1, y: 1, z: 1 } as const;

/** A quarter turn: the tip is inside the block within the first few degrees. */
const SWEEP: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "slew", target: 90, rate: SLEW_MAX_RATE }],
  },
];

/** Ticks per batch, and the ceiling on them: two seconds of slewing. */
const BATCH = 15;
const CAP = 2 * 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ends the run as structure-struck-obstacle when a slewing member reaches inside one", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await standMinimalCrane(h);
  await addOneObstacle(h, BLOCK_MIN, BLOCK_SIZE);
  await poseTape(h, SWEEP);
  await startRun(h);

  // The guard: the crane stands CLEAR of the block at the posture the run starts
  // from, so what ends the run below is the sweep and not the build.
  let s: GantrySnapshot = await runTicks(h, 1);
  assertEqual(
    s.run.phase,
    "running",
    `the run on its first tick, with no member reaching past x 4 and the ` +
      `block at x ${BLOCK_MIN.x}..${BLOCK_MIN.x + BLOCK_SIZE.x} ` +
      "(specs/statics.md)",
  );

  for (
    let driven = 1;
    s.run.phase === "running" && driven < CAP;
    driven += BATCH
  ) {
    s = await runTicks(h, BATCH);
  }
  await h.capture("swept", "The arm swept into the block");

  assertEqual(
    s.run.cause,
    "structure-struck-obstacle",
    "the cause of a run ended by a member sweeping inside an obstacle, at " +
      `slew ${s.run.axes.slew.value.toFixed(2)} degrees (specs/statics.md)`,
  );
  assertEqual(
    s.run.phase,
    "failed",
    "the run once a member has swept inside the block",
  );
});
