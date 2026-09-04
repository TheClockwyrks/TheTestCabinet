// parts/piston-rest-length-is-its-chosen-length — a piston that has extended
// reports its CHOSEN length as the machine's and its changed length as the run's.
//
// THE RULE. "For a `piston` the chosen length is its rest length, and the `extend`
// and `retract` instructions change it at run time" (`specs/parts.md`, Arms). What
// changes is the live pose, not the placement: `specs/instrumentation.md` keeps
// them in different fields — `editor.parts` carries each placed part's `rotation`
// and `length`, `sim.poses` carries the live `{ part, rotation, length, cell }` —
// and states outright that "A part's rest pose and its live pose are separate."
// The instruction acts on the live one: "`extend` — A piston's length rises by
// one" (`specs/instructions.md`), sweeping "The piston's length changes by one,
// its gripper translating one hex along its spoke" (`specs/simulation.md`).
//
// THE CONFIGURATION. One `piston` at `(0, 0)`, rotation `0`, placed at length
// `ARM_MIN_LEN` (`1`), with `extend` in tape cell `0`, on an emptied field. It is
// the only part placed and it holds nothing, so the cycle can neither collide nor
// tear, and at `ARM_MIN_LEN` there is room to rise — `extend` at `ARM_MAX_LEN`
// (`3`) would be `overextended`, which is a different point.
//
// THE VERDICT. After the cycle the run reports the piston at live length `2` — it
// really did extend — while the machine still reports the length it was placed at.
// Both readings are taken from one snapshot, so the difference between them is the
// build's, not the moment's.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { ARM_MIN_LEN } from "../constants";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  openBareRun,
  partById,
  partIds,
  poseOf,
  type Harness,
} from "../harness";

/** The length the piston is PLACED at, and the length one `extend` reaches. */
const REST_LENGTH = ARM_MIN_LEN;
const EXTENDED_LENGTH = ARM_MIN_LEN + 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the placed length in editor.parts and the extended length in sim.poses", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("piston", ORIGIN.q, ORIGIN.r, 0, REST_LENGTH, ["extend"]),
    ]),
  });
  const piston = (await partIds(h))[0] ?? -1;

  const placed = await h.snapshot();
  assertEqual(
    poseOf(placed, piston)?.length,
    REST_LENGTH,
    "the run began with the piston at the length it was placed at",
  );

  const snapshot = await captureReplay(h, "piston", async () => {
    await advanceCycles(h, 1);
    return h.snapshot();
  });

  const sim = snapshot.sim;
  assertNotNull(sim, "the run is live through the cycle that extended");
  assertEqual(sim?.status, "running", "the extend cycle reaches its boundary");
  assertNull(sim?.fault ?? null, "extend below ARM_MAX_LEN raises no fault");
  assertEqual(sim?.cycle, 1, "the cycle ran to its boundary rather than freezing");

  const pose = poseOf(snapshot, piston);
  assertNotNull(pose, "the run still reports a live pose for the piston");
  assertEqual(
    pose?.length,
    EXTENDED_LENGTH,
    "sim.poses reports the changed live length: extend raised it by one",
  );
  assertEqual(
    partById(snapshot, piston)?.length,
    REST_LENGTH,
    "editor.parts still reports the placed length: the chosen length is the REST length, which the run does not edit",
  );
});
