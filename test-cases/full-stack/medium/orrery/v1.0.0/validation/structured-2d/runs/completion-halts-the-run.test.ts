// runs/completion-halts-the-run — a completed run is over, and time cannot
// reopen it.
//
// THE RULE. "The fraction advances only while the status is `running`, so pausing
// holds it where it is" (`specs/simulation.md`, Cycles and the clock) — and
// `complete` is not `running`. "A completing or faulting boundary leaves
// `sim.cycle` at the cycle just run", and a completion "leaves the fraction at
// `0`". So once the status is `complete` there is nothing left for a frame to
// integrate: no cycle runs, no tape is fetched, no carried mote moves.
//
// THE CONFIGURATION is a run that completes with a MACHINE STILL IN MOTION, which
// is the state most at risk of drifting on. An arm on `(0, 3)` holds a `sol` on
// its gripper and its tape turns it one step clockwise every cycle, so if a
// single further cycle ran, that mote would leave the hex it is standing on and
// the arm's live rotation would change. Beside it, and far enough away to reach
// nothing, a `set` at the origin with one `sol` on its footprint and the tally
// posed at `CONSTELLATION_TARGET - 1`, so the boundary of cycle `0` completes the
// run while the arm is mid-tape.
//
// THE VERDICT. Everything the snapshot reports of the run is identical before and
// after a further span of game time twelve cycles long: `sim.cycle`,
// `sim.fraction`, every mote's hex and drawn position, every live pose, every
// grip, the tallies and the recorded metrics. The drawn positions are in the
// reading because a mote's `x`, `y` are "derived from ... `sim.fraction`"
// (`specs/instrumentation.md`), so a build that kept integrating would show it
// there first.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertNotNull,
} from "../assert";
import { CONSTELLATION_TARGET } from "../constants";
import { at } from "../field";
import { armPart, setPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  gripsOf,
  moteAt,
  openRun,
  partIds,
  spawnMote,
  takeGrip,
  tallyOf,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

/** The turning arm's anchor, well clear of the set. */
const ARM = at(0, 3);

/** Its gripper hex at rest: length 1 along spoke 0, which is east. */
const HELD_AT = at(1, 3);

/** One set at the origin, and one arm that turns clockwise every cycle. */
const MACHINE = solution([
  setPart(0, ORIGIN.q, ORIGIN.r),
  armPart("arm", ARM.q, ARM.r, 0, 1, ["rotate-cw"]),
]);

/** How long a span of game time the completed run is held under. */
const FURTHER_CYCLES = 12;

/** Everything of the completed run a further span of game time must leave alone. */
function halted(snapshot: OrrerySnapshot): unknown {
  const sim = snapshot.sim;
  return {
    status: sim?.status,
    cycle: sim?.cycle,
    fraction: sim?.fraction,
    motes: sim?.motes.map((mote) => ({
      id: mote.id,
      q: mote.q,
      r: mote.r,
      x: mote.x,
      y: mote.y,
    })),
    poses: sim?.poses,
    grips: sim?.grips,
    tallies: sim?.tallies,
    metrics: sim?.metrics,
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("runs no cycle, moves no mote and holds the clock once the run has completed", async () => {
  await openRun(h, { challenge: BARE, machine: MACHINE });
  const ids = await partIds(h);
  const arm = ids[1] as number;

  const carried = await spawnMote(h, HELD_AT, "sol");
  await takeGrip(h, arm, 0, carried);
  await spawnMote(h, ORIGIN, "sol");
  await h.debug.setTally(0, CONSTELLATION_TARGET - 1);

  await advanceCycles(h, 1);

  const completed = await h.snapshot();
  assertNotNull(
    completed.sim,
    "the run is still reported once it has completed",
  );
  assertEqual(
    completed.sim?.status,
    "complete",
    "the delivery brought the tally to the target, which is the state this check freezes",
  );
  assertEqual(
    tallyOf(completed, 0),
    CONSTELLATION_TARGET,
    "the tally reached the target at that boundary",
  );
  assertLength(
    gripsOf(completed, arm),
    1,
    "the arm is still holding, so a further cycle would have something to move",
  );
  assertNotNull(
    moteAt(completed, at(0, 4)),
    "the arm's first turn carried the mote one step clockwise, so its tape really runs",
  );

  await captureReplay(h, "halted", () => advanceCycles(h, FURTHER_CYCLES));

  const later = await h.snapshot();
  assertDeepEqual(
    halted(later),
    halted(completed),
    "a completed run advances no cycle, no fraction, no mote, no pose and no grip",
  );
});
