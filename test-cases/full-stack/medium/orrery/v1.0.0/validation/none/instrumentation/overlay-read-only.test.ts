// instrumentation/overlay-read-only — watching the overlay leaves the game where
// the frames put it.
//
// THE RULE, from Diagnostics in `specs/instrumentation.md`: "keep every source a
// pure read, so watching the overlay leaves the game as it is." Under either
// engine the same sentence is the game's whole obligation — "Drawing the panel,
// toggling it with the backtick key ... and keeping it read-only are the
// engine's" — and under the engineless runtime the panel is the build's own layer
// and "reads the game without changing it". The surface's own rule says the same
// of a reading: it "returns plain data built at the call and changes nothing".
//
// THE CHECK IS ONE SESSION, WATCHED, HELD TO THE FIGURES THE RULES FIX. The
// panel is shown with the backtick key while the challenge is open in the
// editor, where a frame advances nothing, so the run that then starts opens on a
// clock at zero with the panel already reading every source on every frame. It
// runs the carrying machine three cycles, and what three cycles of `grab`,
// `rotate-cw`, `drop` leave is stated outright: the mote carried from `(1, 0)` to
// `(0, 1)` and let go there, the gripper open, `sim.cycle` at `3`, the fraction
// back at `0`, and the mote drawn on its hex's center, where "at `t = 1` every
// mote lands exactly" (`specs/simulation.md`, Motion and carrying). A source that
// advanced a cursor, consumed a queue, or nudged a figure it was only meant to
// read leaves the run somewhere else.
//
// THE SESSION MUST HAVE SOMETHING TO GET WRONG, so the run is not a still one: an
// arm grabs a mote, carries it a step and drops it over three cycles, which leaves
// a cycle count, a fraction, a live pose, a grip and a moved mote for the sources
// to report. The backtick key is the documented toggle, and that it shows the
// panel is `overlay-shows-on-the-backtick-key`'s point rather than this one's.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNear,
  assertNotNull,
  assertNull,
} from "../assert";
import { ARM_MIN_LEN, FRACTION_TOLERANCE, HEX_PITCH } from "../constants";
import { at, hexCenter } from "../field";
import { BARE, CARRY_MACHINE, ORIGIN } from "../fixtures";
import { gripperHex } from "../parts";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  heldBy,
  moteAt,
  partIds,
  spawnMote,
  toggleOverlay,
  type Harness,
} from "../harness";

/** See `frame-division-independent`: the drawn positions follow `sim.fraction`. */
const POSITION_TOLERANCE = 2 * Math.PI * HEX_PITCH * FRACTION_TOLERANCE;

/** How many cycles the session runs with the panel reading every frame. */
const CYCLES = 3;

/** Where `rotate-cw` about ORIGIN carries the mote the gripper starts over. */
const CARRIED_TO = at(0, 1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the run where three cycles put it while the overlay reads every frame", async () => {
  await h.debug.reset();
  await h.debug.loadChallenge(BARE);
  await h.debug.clearMachine();
  await h.debug.loadSolution(CARRY_MACHINE);
  await h.debug.setCompletion(false);
  await toggleOverlay(h);
  await h.debug.startRun();
  await h.debug.clearMotes();
  const started = gripperHex(ORIGIN, 0, ARM_MIN_LEN);
  await spawnMote(h, started, "sol");
  const [arm] = await partIds(h);

  await captureReplay(h, "watched", () => advanceCycles(h, CYCLES));
  const watched = await h.snapshot();

  assertNotNull(watched.sim, "the run is live after the three cycles");
  assertEqual(
    watched.sim?.cycle,
    CYCLES,
    "the run advanced exactly the cycles it was given",
  );
  assertNear(
    watched.sim?.fraction ?? -1,
    0,
    FRACTION_TOLERANCE,
    "and stands on the boundary, to the rounding of the fraction's sum",
  );
  assertLength(watched.sim?.poses ?? [], 1, "the arm carries a live pose");
  assertLength(
    watched.sim?.motes ?? [],
    1,
    "the mote it was given is on the field",
  );
  assertEqual(
    moteAt(watched, CARRIED_TO)?.type,
    "sol",
    "grab, rotate-cw and drop carried it from (1, 0) to (0, 1) and let it go",
  );
  assertNull(
    moteAt(watched, started),
    "so nothing rests on the hex it started on",
  );
  assertNull(
    heldBy(watched, arm ?? -1, 0),
    "and the gripper that carried it is open again",
  );
  const drawn = moteAt(watched, CARRIED_TO) ?? { x: NaN, y: NaN };
  const center = hexCenter(CARRIED_TO);
  assertNear(
    drawn.x,
    center.x,
    POSITION_TOLERANCE,
    "at the boundary the mote is drawn at its hex's center: x",
  );
  assertNear(drawn.y, center.y, POSITION_TOLERANCE, "and y");
});
