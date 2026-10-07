// instrumentation/release-grip — `releaseGrip` opens a gripper and leaves what it
// held where it stands.
//
// THE RULE. "`releaseGrip(part, spoke)` | That gripper opens, leaving what it held
// resting where it stands." (`specs/instrumentation.md`, The run). It is the gate
// the same file names for holding a gripper's hold still: "`releaseGrip`, and
// leaving `grab` off the tape". What an unheld mote then does: "A mote held by
// nothing rests on its hex for the whole cycle" (`specs/simulation.md`).
//
// THE WORLD IS POSED, NOT SEARCHED. A bare run with one arm at the middle,
// rotation `0`, length `1` — its gripper on `(1, 0)` — and a tape of one cell,
// `rotate-cw`, with no `grab` anywhere on it. One `dust` is spawned under the
// gripper and the hold is posed with `setGrip`, so there IS a hold to open; the
// check reads it back before opening it. Nothing else is on the field, so the one
// mote is the only thing the cycle could carry.
//
// THE VERDICT. The entry is out of `sim.grips` at the call and the mote is still
// on `(1, 0)`. Then a whole cycle runs: the arm really turns — its live rotation
// is `1`, so the gripper swept from `(1, 0)` to `(0, 1)` — and the mote is STILL
// on `(1, 0)`, carried by nothing. An opened gripper carries nothing on the next
// motion.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import { at } from "../field";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  gripsOf,
  heldBy,
  holdGrip,
  moteById,
  openBareRun,
  partIds,
  poseOf,
  spawnMote,
  takeGrip,
  type Harness,
} from "../harness";

/** The arm's gripper hex at its rest pose, where the mote is spawned and left. */
const UNDER = at(1, 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the gripper, leaves what it held, and carries nothing on the next motion", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, ["rotate-cw"]),
    ]),
  });
  const arm = (await partIds(h))[0] ?? -1;
  const mote = await spawnMote(h, UNDER, "dust");
  await takeGrip(h, arm, 0, mote);
  const held = await h.snapshot();

  await holdGrip(h, arm, 0);
  const opened = await h.snapshot();

  await captureReplay(h, "released", () => advanceCycles(h, 1));
  const after = await h.snapshot();

  assertNotNull(held.sim, "the run is live while the gripper holds");
  assertEqual(
    heldBy(held, arm, 0),
    mote,
    "the gripper is holding before it is opened, so there is a hold for the call to open",
  );
  assertLength(
    gripsOf(opened, arm),
    0,
    "the gripper's entry is out of sim.grips",
  );
  assertEqual(
    `${moteById(opened, mote)?.q},${moteById(opened, mote)?.r}`,
    `${UNDER.q},${UNDER.r}`,
    "what it held is left resting where it stands",
  );
  assertEqual(
    poseOf(after, arm)?.rotation,
    1,
    "the arm really turned, so its gripper swept away from the mote's hex",
  );
  assertEqual(
    `${moteById(after, mote)?.q},${moteById(after, mote)?.r}`,
    `${UNDER.q},${UNDER.r}`,
    "the next motion of that part carried nothing: the mote rests on its hex for the whole cycle",
  );
  assertLength(
    gripsOf(after, arm),
    0,
    "and nothing closed the gripper again: no grab is on the tape",
  );
});
