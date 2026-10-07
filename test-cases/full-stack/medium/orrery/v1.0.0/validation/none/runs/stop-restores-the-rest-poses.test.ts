// runs/stop-restores-the-rest-poses — the run's poses are the run's, and they go
// when it does.
//
// THE RULE. "Stopping a run, from the `back` action in any sim status, discards
// the motes and EVERY RUNTIME POSE and returns to editing with the machine
// exactly as it was placed" (`specs/simulation.md`, The run). What a placed pose
// is comes from `specs/parts.md`: "An arm's placed rotation and length are its
// rest pose. Each run starts every arm at its rest pose" — and
// `specs/instrumentation.md` keeps the two apart in the snapshot, "A part's rest
// pose and its live pose are separate", the rest pose in `editor.parts` and the
// live one in `sim.poses`.
//
// THE CONFIGURATION is one part per kind of runtime pose there is, so no way of
// moving a part is left out: a `piston` whose tape runs it out to `ARM_MAX_LEN`
// (`3`) from a rest length of `1`, an `arm` its tape turns two steps clockwise
// from a rest rotation of `0`, and a second `arm` mounted on an open track whose
// tape advances it two cells from the first. Each tape ends in a `grab`, which is
// a rest for the motion step and finds nothing to hold on an empty field: the
// check runs exactly two cycles, and the third cell is there so that a build
// whose clock lands a hair past the second boundary fetches something harmless
// rather than an `extend` at the piston's bound.
//
// THE VERDICT is read in two halves, because the second is worthless without the
// first: the LIVE poses at the end of cycle `1` really are the moved ones
// (length `3`, rotation `2`, the track's third cell), and after `stopRun` the
// editor reports every part back at the pose it was placed at.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertNotNull,
  assertNull,
} from "../assert";
import { ARM_MAX_LEN } from "../constants";
import { at } from "../field";
import { armPart, solution, trackPart } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  openBareRun,
  partById,
  partIds,
  poseOf,
  stopRun,
  type Harness,
} from "../harness";

/** The piston's anchor, its rest length 1 and its rest rotation 0. */
const PISTON = at(0, -4);

/** The rotating arm's anchor, its rest rotation 0. */
const TURNER = at(0, 4);

/** The open track's three cells, west to east. */
const TRACK_FIRST = at(-4, 0);
const TRACK_MIDDLE = at(-3, 0);
const TRACK_LAST = at(-2, 0);
const TRACK = [TRACK_FIRST, TRACK_MIDDLE, TRACK_LAST];

/**
 * A piston that extends twice, an arm that turns twice, and a track arm that
 * advances twice — each with a third cell that rests (a `grab` on an empty
 * field), so the two cycles this check runs are bounded on both sides.
 */
const MACHINE = solution([
  armPart("piston", PISTON.q, PISTON.r, 0, 1, ["extend", "extend", "grab"]),
  armPart("arm", TURNER.q, TURNER.r, 0, 1, ["rotate-cw", "rotate-cw", "grab"]),
  trackPart(TRACK),
  armPart("arm", TRACK_FIRST.q, TRACK_FIRST.r, 0, 1, [
    "advance",
    "advance",
    "grab",
  ]),
]);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns a run-out piston, a turned arm and an advanced track arm to their placed poses", async () => {
  await openBareRun(h, { challenge: BARE, machine: MACHINE });
  const ids = await partIds(h);
  const piston = ids[0] as number;
  const turner = ids[1] as number;
  const rider = ids[3] as number;

  await advanceCycles(h, 2);

  const live = await h.snapshot();
  assertNotNull(live.sim, "the run is live after its two cycles");
  assertEqual(
    live.sim?.status,
    "running",
    "nothing in the configuration faults, so the poses below were reached by the tapes",
  );
  assertEqual(
    poseOf(live, piston)?.length,
    ARM_MAX_LEN,
    "the piston's tape ran it out to ARM_MAX_LEN",
  );
  assertEqual(
    poseOf(live, turner)?.rotation,
    2,
    "the arm's tape turned it two steps clockwise",
  );
  assertDeepEqual(
    poseOf(live, rider)?.cell,
    { q: TRACK_LAST.q, r: TRACK_LAST.r },
    "the track arm's tape advanced it two cells along the path",
  );

  await stopRun(h);
  await h.advance(1);
  await captureStill(h, "restored");

  const rested = await h.snapshot();
  assertNull(
    rested.sim,
    "the run is stopped, so no runtime pose is reported at all",
  );

  assertEqual(
    partById(rested, piston)?.length,
    1,
    "the piston stands at its placed length",
  );
  assertEqual(
    partById(rested, piston)?.rotation,
    0,
    "the piston stands at its placed rotation",
  );
  assertEqual(
    partById(rested, turner)?.rotation,
    0,
    "the turned arm stands at its placed rotation",
  );
  assertEqual(
    partById(rested, turner)?.length,
    1,
    "the turned arm stands at its placed length",
  );
  assertDeepEqual(
    { q: partById(rested, rider)?.q, r: partById(rested, rider)?.r },
    { q: TRACK_FIRST.q, r: TRACK_FIRST.r },
    "the track arm stands on the cell it was placed on",
  );
});
