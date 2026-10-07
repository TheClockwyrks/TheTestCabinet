// runs/stop-discards-the-motes — the second run of a machine opens on the field
// its own start sequence built, not on the wreckage of the first.
//
// THE RULE. "Stopping a run, from the `back` action in any sim status, DISCARDS
// THE MOTES and every runtime pose and returns to editing with the machine
// exactly as it was placed" (`specs/simulation.md`, The run). And what the next
// run opens holding is fixed by the start sequence in the same section: "Every
// arm and wheel takes its rest pose, HOLDING NOTHING, and every wheel's six
// fixtures appear on its spoke hexes", then the settle, then cycle `0`. A
// filament joins motes and a grip holds one, so motes discarded take both with
// them.
//
// THE CONFIGURATION. A machine of one wheel and one arm. The wheel is what makes
// the check say something: its six fixtures are exactly what the start sequence
// is supposed to put back, so "the second run's field is empty" and "the second
// run's field holds only what it placed" are told apart. Into the first run go
// two loose motes, a filament joining them, and a grip of the arm on one of them
// — one of each thing a run accumulates — posed through the gates
// `specs/instrumentation.md` names, so no cycle has to be run to arrange them.
//
// THE VERDICT is read off the SECOND run: no loose mote, no filament, no grip,
// and the wheel's six fixtures present. The reading is by membership rather than
// by mote id, because no sentence of `specs/` fixes what ids a fresh run hands
// out — a build that numbers the second run's fixtures from where the first run
// stopped and one that starts over are both conformant.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import { at } from "../field";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  fixturesOf,
  gripsOf,
  looseMotes,
  openBareRun,
  partIds,
  spawnConstellation,
  stopRun,
  takeGrip,
  type Harness,
} from "../harness";

/** The arm's anchor, far from the wheel's ring so nothing of the two meets. */
const ARM = at(-4, 0);

/** The arm's gripper hex at rest: length 1 along spoke 0, which is east. */
const GRIP = at(-3, 0);

/** A second hex for the mote the first one is joined to. */
const BESIDE = at(-2, 0);

/** One wheel at the origin and one arm to the west, both resting on blank tapes. */
const MACHINE = solution([
  armPart("wheel", ORIGIN.q, ORIGIN.r, 0, 1, []),
  armPart("arm", ARM.q, ARM.r, 0, 1, []),
]);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the second run holding only what its own start sequence placed", async () => {
  await openBareRun(h, { challenge: BARE, machine: MACHINE });
  const ids = await partIds(h);
  const wheel = ids[0];
  const arm = ids[1];
  assertNotNull(wheel ?? null, "the wheel is the first part of the machine");
  assertNotNull(arm ?? null, "the arm is the second part of the machine");

  // Into the first run: two motes, a filament between them, and a grip on one.
  const motes = await spawnConstellation(
    h,
    [
      { hex: GRIP, type: "sol" },
      { hex: BESIDE, type: "sol" },
    ],
    [{ a: 0, b: 1 }],
  );
  await takeGrip(h, arm as number, 0, motes[0] as number);

  const first = await h.snapshot();
  assertLength(
    looseMotes(first),
    2,
    "the first run really holds two motes of its own",
  );
  assertLength(
    first.sim?.filaments ?? [],
    1,
    "the first run really holds a filament of its own",
  );
  assertLength(
    gripsOf(first, arm as number),
    1,
    "the first run really holds a grip of its own",
  );

  await stopRun(h);
  await h.debug.startRun();
  await h.advance(1);
  await captureStill(h, "cleared");

  const second = await h.snapshot();
  assertNotNull(second.sim, "the second run is live");
  assertEqual(
    second.sim?.status,
    "running",
    "the second run opened the way the start sequence leaves one",
  );
  assertLength(
    looseMotes(second),
    0,
    "a mote spawned into the first run is absent from the second run's sim.motes",
  );
  assertLength(
    second.sim?.filaments ?? [],
    0,
    "sim.filaments carries nothing the first run left",
  );
  assertLength(
    second.sim?.grips ?? [],
    0,
    "sim.grips carries nothing the first run left: every arm opens holding nothing",
  );
  assertLength(
    fixturesOf(second, wheel as number),
    6,
    "what the second run does hold is what its own start sequence placed: the wheel's six fixtures",
  );
});
