// collision/an-empty-gripper-may-stop-on-an-occupied-hex — only motes collide, so
// an EMPTY gripper may come to rest on a hex a mote rests on.
//
// THE RULE. "Only motes collide, so a gripper and the drawn arm between base and
// gripper pass over any hex, on or off the field, and over any part"
// (`specs/parts.md`, Arms). The collision rule agrees from its own side: what it
// samples is "the distance between the centers of two motes"
// (`specs/simulation.md`, Collision), and a gripper is not a mote.
//
// THE CONFIGURATION. An arm at `(0, 0)`, length 1, rotation `0`, holding NOTHING,
// whose tape cell for the cycle is `rotate-cw`: "The part turns one 60 degree step
// clockwise about its base" (`specs/instructions.md`), which carries its gripper
// from `(1, 0)` to `(0, 1)` by the clockwise formula of `specs/field.md`. One mote
// rests on `(0, 1)`, the hex the gripper lands on. The gripper is left empty by
// giving it no grip at all — the gate `specs/instrumentation.md` names,
// "`releaseGrip`, and leaving `grab` off the tape" — so nothing is carried.
//
// THE VERDICT. The cycle reaches its boundary with `sim.status` still `running`
// and no fault, the arm really did turn (its live rotation is `1`, so the gripper
// really is on the occupied hex), and the mote is still resting on `(0, 1)`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { at } from "../field";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  moteById,
  openBareRun,
  partIds,
  poseOf,
  spawnMote,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("turns an empty gripper onto an occupied hex and keeps running", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("arm", 0, 0, 0, 1, ["rotate-cw"])]),
  });
  const arm = (await partIds(h))[0] ?? -1;
  const resting = await spawnMote(h, at(0, 1), "dust");

  await captureReplay(h, "gripper-lands", () => advanceCycles(h, 1));

  const snapshot = await h.snapshot();
  const sim = snapshot.sim;
  assertNotNull(sim, "the run is live through the cycle");
  assertEqual(
    sim?.status,
    "running",
    "only motes collide, so a gripper landing on an occupied hex faults nothing",
  );
  assertNull(sim?.fault ?? null, "no fault is raised by an empty gripper");
  assertEqual(
    sim?.cycle,
    1,
    "the cycle reached its boundary rather than freezing part way",
  );
  assertEqual(
    poseOf(snapshot, arm)?.rotation,
    1,
    "rotate-cw turned the arm one step, so its gripper is on (0, 1)",
  );
  const mote = moteById(snapshot, resting);
  assertEqual(
    `${mote?.q},${mote?.r}`,
    "0,1",
    "the mote the gripper stopped over is still resting where it was",
  );
  assertEqual(
    sim?.grips.length,
    0,
    "the gripper is still holding nothing: no grab ran, and none was posed",
  );
});
