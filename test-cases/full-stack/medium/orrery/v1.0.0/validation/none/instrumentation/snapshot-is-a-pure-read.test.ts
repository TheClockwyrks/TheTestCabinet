// instrumentation/snapshot-is-a-pure-read — reading the game does not move it.
//
// THE RULE. "`snapshot()` | A pure read of the state, returned as the plain
// object under Snapshot shape below. It changes nothing"
// (`specs/instrumentation.md`, Session). The same file says it again from the
// other side, of every reading: a reading "returns plain data built at the call
// and changes nothing", and "Every field is read straight off the game's state,
// so what the snapshot reports is what the game holds."
//
// HOW A PURE READ IS DECIDED. Not by inspecting one snapshot — nothing about one
// value says whether taking it cost anything — but by running the SAME scenario
// twice and reading only at the end. One pass is snapshotted after every single
// frame; the other is driven frame for frame with no read between them at all.
// Both passes drive identical frames of identical length, because
// `specs/instrumentation.md`'s deterministic core makes "an interval of game time
// reach the same state however it was divided into frames" — so if the two end
// anywhere but the same place, the reads are what moved one of them.
//
// THE CONFIGURATION. A posed challenge, one arm at `(0, 0)` whose tape turns it
// clockwise and back, and one mote posed into its gripper's hold with `setGrip`,
// so every frame has motion, a live pose, a grip and a drawn position to get
// wrong. Thirty frames, two and a half cycles, so the pass ends MID-CYCLE with a
// fraction, an interpolated position and a part part way through a sweep, rather
// than on a boundary where a build that lost frames could still look tidy.
//
// THE VERDICT. The two final snapshots are the same value, field for field. The
// comparison is between two reads of ONE build, so a field the specification does
// not fix appears identically on both sides and nothing here holds a build to a
// shape beyond the one it chose.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { DEFAULT_SPEED_INDEX, FRAMES_PER_CYCLE } from "../constants";
import { at } from "../field";
import { BARE } from "../fixtures";
import { armPart, solution } from "../formats";
import {
  captureReplay,
  createHarness,
  partIds,
  secondsPerCycle,
  spawnMote,
  takeGrip,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

/** Two and a half cycles at `FRAMES_PER_CYCLE` frames apiece. */
const FRAMES = FRAMES_PER_CYCLE * 2 + FRAMES_PER_CYCLE / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * Drive one pass of the scenario and answer the state it ended in, reading the
 * game after every frame when `watching` and not at all when it is not.
 */
async function pass(watching: boolean): Promise<OrrerySnapshot> {
  await h.debug.reset();
  await h.debug.loadChallenge(BARE);
  await h.debug.clearMachine();
  await h.debug.loadSolution(
    solution([armPart("arm", 0, 0, 0, 1, ["rotate-cw", "rotate-ccw"])]),
  );
  await h.debug.setCompletion(false);
  await h.debug.startRun();
  await h.debug.clearMotes();

  const arm = (await partIds(h))[0] ?? -1;
  const carried = await spawnMote(h, at(1, 0), "dust");
  await takeGrip(h, arm, 0, carried);

  const frame = secondsPerCycle(DEFAULT_SPEED_INDEX) / FRAMES_PER_CYCLE;
  for (let i = 0; i < FRAMES; i += 1) {
    await h.advanceSeconds(frame, 1);
    if (watching) await h.snapshot();
  }
  return h.snapshot();
}

it("reaches the same state whether every frame is read or none is", async () => {
  const measured = await captureReplay(h, "watched", async () => {
    const unwatched = await pass(false);
    const watched = await pass(true);
    return { unwatched, watched };
  });

  assertEqual(
    measured.watched.sim?.status,
    "running",
    "the watched pass is still running after two and a half cycles, so there was a state to compare",
  );
  assertNotNull(
    measured.watched.sim?.grips[0] ?? null,
    "the watched pass is still carrying the mote it was posed with",
  );
  assertDeepEqual(
    measured.watched,
    measured.unwatched,
    "a session snapshotted every frame reaches exactly the state of one never snapshotted",
  );
});
