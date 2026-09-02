// instrumentation/overlay-read-only — watching the overlay leaves the game exactly
// where an unwatched session leaves it.
//
// THE RULE, from Diagnostics in `specs/instrumentation.md`: "keep every source a
// pure read, so watching the overlay leaves the game as it is." Under either
// engine the same sentence is the game's whole obligation — "Drawing the panel,
// toggling it with the backtick key ... and keeping it read-only are the
// engine's" — and under the engineless runtime the panel is the build's own layer
// and "reads the game without changing it". The surface's own rule says the same
// of a reading: it "returns plain data built at the call and changes nothing".
//
// THE CHECK IS TWO IDENTICAL SESSIONS, DIFFERING ONLY IN THE KEY THAT WAS PRESSED.
// Each opens the same bare run on the same machine with the same mote, presses one
// key, and advances the same three cycles. The watched session presses the
// backtick key, which shows the panel and has it read every source on every one of
// those frames; the unwatched session presses `KeyO`, which `specs/controls.md`
// binds to nothing on any screen under any focus, so the two sessions differ in
// the panel and in nothing else — the same number of frames pass, the same key
// events are delivered, and the same simulated time elapses.
//
// THE VERDICT IS THE WHOLE SNAPSHOT, deep-equalled between the two sessions: the
// build's own reading of itself against itself, so a source that advanced a cursor,
// consumed a queue, memoised into the state or nudged a figure it was only meant to
// read is caught wherever it put the change. Nothing is excluded, because nothing
// in it is allowed to differ: `simTime` accumulates the same frames in both, and
// the pointer is never moved in either.
//
// THE SESSIONS MUST HAVE SOMETHING TO GET WRONG, so the run is not a still one: an
// arm grabs a mote, carries it a step and drops it over three cycles, which leaves
// a cycle count, a fraction, a live pose, a grip and a moved mote in the snapshot
// for the comparison to bite on. The check reads back that the run really advanced
// before it compares the two.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertNotNull,
} from "../assert";
import { ARM_MIN_LEN, INERT_KEY, OVERLAY_KEY } from "../constants";
import { BARE, CARRY_MACHINE, ORIGIN } from "../fixtures";
import { gripperHex } from "../parts";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  openBareRun,
  spawnMote,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** How many cycles each session runs with the panel deciding nothing. */
const CYCLES = 3;

/**
 * One session: the same world, the same frames, and one key press whose only
 * difference is whether the panel is open across them.
 */
async function session(watching: boolean): Promise<OrrerySnapshot> {
  await openBareRun(h, { challenge: BARE, machine: CARRY_MACHINE });
  await spawnMote(h, gripperHex(ORIGIN, 0, ARM_MIN_LEN), "sol");
  await h.tap(watching ? OVERLAY_KEY : INERT_KEY);
  await advanceCycles(h, CYCLES);
  return h.snapshot();
}

it("reaches the same state watched as unwatched", async () => {
  const unwatched = await session(false);
  const watched = await captureReplay(h, "watched", () => session(true));

  assertNotNull(unwatched.sim, "the unwatched session ran a live run");
  assertNotNull(watched.sim, "and so did the watched one");
  assertEqual(
    unwatched.sim?.cycle,
    CYCLES,
    "each session advanced the run it opened, so there is a moving game to compare",
  );
  assertGreaterThan(
    unwatched.sim?.poses.length ?? 0,
    0,
    "with a part on the field carrying a live pose",
  );
  assertEqual(
    unwatched.sim?.motes.length,
    1,
    "and the mote it was given still on it",
  );

  assertDeepEqual(
    watched,
    unwatched,
    "showing the overlay and letting it report across every frame changes nothing: every source is a pure read",
  );
});
