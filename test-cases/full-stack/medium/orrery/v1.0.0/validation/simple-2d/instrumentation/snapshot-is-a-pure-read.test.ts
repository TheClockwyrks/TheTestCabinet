// instrumentation/snapshot-is-a-pure-read — reading the game does not move it.
//
// THE RULE. "`snapshot()` | A pure read of the state, returned as the plain
// object under Snapshot shape below. It changes nothing"
// (`specs/instrumentation.md`, Session). The same file says it again from the
// other side, of every reading: a reading "returns plain data built at the call
// and changes nothing", and "Every field is read straight off the game's state,
// so what the snapshot reports is what the game holds."
//
// HOW A PURE READ IS DECIDED, TWICE OVER. First, two reads with no frame between
// them report the same value, field for field: a read that moved anything the
// second read can see has been caught by it. Second, a run read after every one
// of thirty frames still stands exactly where the specification says thirty
// frames put it, so a read that cost a frame, dropped one, or nudged the fraction
// has been caught by the figures the rules fix.
//
// THE CONFIGURATION. A posed challenge, one arm at `(0, 0)` whose tape turns it
// clockwise and back, and one mote posed into its gripper's hold with `setGrip`,
// so every frame has motion, a live pose, a grip and a drawn position to get
// wrong. Thirty frames of a sixtieth at the default speed are two and a half
// cycles, so the pass ends MID-CYCLE with a fraction, an interpolated position
// and a part part way through a sweep, rather than on a boundary where a build
// that lost frames could still look tidy.
//
// WHAT THIRTY FRAMES FIX. Cycle `0` runs `rotate-cw` and cycle `1` runs
// `rotate-ccw`, so at the boundary ending cycle `1` the mote is back on `(1, 0)`,
// "the hex at the last boundary" the snapshot reports it under. Cycle `2` is
// `rotate-cw` again, half done: `sim.cycle` is `2`, `sim.fraction` is `0.5`, the
// grip still holds, and the mote is drawn on its arc — "The same rotation about
// the base ... sweeping `60 * t` degrees" (`specs/simulation.md`, Motion and
// carrying) — thirty degrees around from `(1, 0)` toward `(0, 1)`: still one
// `HEX_PITCH` from the base, and the same chord from either hex's center.
//
// THE VERDICT holds the build to its own reading only where the specification
// fixes nothing: the two consecutive reads are compared as whole values, so a
// field the specification does not fix appears identically on both sides and
// nothing here holds a build to a shape beyond the one it chose.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertNear,
  assertNotNull,
} from "../assert";
import {
  DEFAULT_SPEED_INDEX,
  FRACTION_TOLERANCE,
  FRAMES_PER_CYCLE,
  HEX_PITCH,
} from "../constants";
import { at, distance, hexCenter } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import { armPart, solution } from "../formats";
import {
  captureReplay,
  createHarness,
  heldBy,
  moteById,
  partIds,
  secondsPerCycle,
  spawnMote,
  takeGrip,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

/** See `frame-division-independent`: the drawn positions follow `sim.fraction`. */
const POSITION_TOLERANCE = 2 * Math.PI * HEX_PITCH * FRACTION_TOLERANCE;

/** Two and a half cycles at `FRAMES_PER_CYCLE` frames apiece. */
const FRAMES = FRAMES_PER_CYCLE * 2 + FRAMES_PER_CYCLE / 2;

/** Where the thirty frames leave the run: half way through its third cycle. */
const CYCLE = 2;
const FRACTION = 0.5;

/** The hex the gripper holds the mote over at the boundary ending cycle 1. */
const GRIPPED = at(1, 0);

/** Where the half-run `rotate-cw` is carrying it. */
const CARRYING_TO = at(0, 1);

/** The chord thirty degrees of a `HEX_PITCH` arc subtends. */
const HALF_STEP_CHORD = 2 * HEX_PITCH * Math.sin(Math.PI / 12);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** What the pass hands back: the part and mote it posed, and the state it ended in. */
interface Pass {
  arm: number;
  carried: number;
  last: OrrerySnapshot;
  again: OrrerySnapshot;
}

/**
 * Drive the scenario, reading the game after every frame, and read it twice
 * more at the end with no frame between.
 */
async function pass(): Promise<Pass> {
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
  const carried = await spawnMote(h, GRIPPED, "dust");
  await takeGrip(h, arm, 0, carried);

  const frame = secondsPerCycle(DEFAULT_SPEED_INDEX) / FRAMES_PER_CYCLE;
  for (let i = 0; i < FRAMES; i += 1) {
    await h.advanceSeconds(frame, 1);
    await h.snapshot();
  }
  const last = await h.snapshot();
  const again = await h.snapshot();
  return { arm, carried, last, again };
}

it("changes nothing when it is read, frame after frame or twice in a row", async () => {
  const read = await captureReplay(h, "watched", () => pass());

  assertDeepEqual(
    read.again,
    read.last,
    "two reads with no frame between them report the same state, field for field",
  );

  const sim = read.last.sim;
  assertNotNull(sim, "the run is live after two and a half cycles");
  assertEqual(
    sim?.status,
    "running",
    "and still running, so there was a moving state to read",
  );
  assertEqual(
    sim?.cycle,
    CYCLE,
    "thirty frames of a sixtieth at the default speed complete two cycles",
  );
  assertNear(
    sim?.fraction ?? -1,
    FRACTION,
    FRACTION_TOLERANCE,
    "and leave the third half done, to the rounding of the fraction's sum",
  );
  assertLength(sim?.poses ?? [], 1, "the arm carries a live pose");
  assertEqual(
    heldBy(read.last, read.arm, 0),
    read.carried,
    "the gripper still holds the mote it was posed with",
  );
  assertLength(sim?.motes ?? [], 1, "and it is the one mote on the field");

  const mote = moteById(read.last, read.carried);
  assertNotNull(mote, "the carried mote is reported");
  assertEqual(
    mote?.q,
    GRIPPED.q,
    "rotate-cw and rotate-ccw brought it back to (1, 0) at the last boundary: q",
  );
  assertEqual(mote?.r, GRIPPED.r, "and r");
  const drawn = { x: mote?.x ?? NaN, y: mote?.y ?? NaN };
  assertNear(
    distance(drawn, hexCenter(ORIGIN)),
    HEX_PITCH,
    POSITION_TOLERANCE,
    "half way through rotate-cw it is drawn one HEX_PITCH from the arm's base",
  );
  assertNear(
    distance(drawn, hexCenter(GRIPPED)),
    HALF_STEP_CHORD,
    POSITION_TOLERANCE,
    "thirty degrees around from the hex it left",
  );
  assertNear(
    distance(drawn, hexCenter(CARRYING_TO)),
    HALF_STEP_CHORD,
    POSITION_TOLERANCE,
    "and thirty degrees short of the hex it is heading for",
  );
});
