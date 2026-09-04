// instrumentation/set-grip — `setGrip` closes a gripper on a mote's whole
// constellation, with no `grab` ever running.
//
// THE RULE. "`setGrip(part, spoke, mote)` | That part's gripper on spoke
// direction `spoke`, `0` to `5`, takes hold of `mote`'s constellation. The spokes
// and the hexes are the part's as its live pose stands."
// (`specs/instrumentation.md`, The run). It is the gate the same file names for a
// gripper's hold: "`setGrip`, which takes hold with no `grab` ever running". What
// a hold then does: "A carried constellation moves as one rigid body: every mote
// of it follows the motion, and at `t = 1` every mote lands exactly on a hex
// center", and "Grips persist across cycles until dropped"
// (`specs/simulation.md`).
//
// THE WORLD IS POSED, NOT SEARCHED. A bare run with one arm at the middle,
// rotation `0` and length `1`, so its one gripper stands on `(1, 0)`
// (`specs/parts.md`: a gripper sits at `base + length * DIRS[d]`). Its tape is
// one cell, `rotate-cw`, AND NO CELL OF IT IS `grab` — so if the hold is not the
// one this check posed, there is no hold at all. Two motes are spawned on `(1, 0)`
// and `(1, 1)` and joined, so the constellation the gripper closes on has a mote
// that is not under the gripper: a build that took hold of the ONE mote would
// leave that one behind.
//
// THE VERDICT. `sim.grips` reports one entry, the arm's spoke `0` holding the
// named mote. Then one cycle turns the arm 60 degrees clockwise about its base,
// and BOTH motes land on the hexes that rotation carries them to — `(1, 0)` to
// `(0, 1)` and `(1, 1)` to `(-1, 2)` by the clockwise formula `(q, r) -> (-r, q +
// r)` of `specs/field.md` — with the filament between them still there and the
// grip still held.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertTrue,
} from "../assert";
import { at } from "../field";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  filamentBetween,
  gripsOf,
  heldBy,
  moteById,
  openBareRun,
  partById,
  partIds,
  spawnConstellation,
  takeGrip,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes hold of the whole constellation with no grab running, and carries it", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, ["rotate-cw"]),
    ]),
  });
  const arm = (await partIds(h))[0] ?? -1;
  const pair = await spawnConstellation(
    h,
    [
      { hex: at(1, 0), type: "dust" },
      { hex: at(1, 1), type: "dust" },
    ],
    [{ a: 0, b: 1 }],
  );
  const [under, beyond] = [pair[0] ?? -1, pair[1] ?? -1];

  await takeGrip(h, arm, 0, under);
  const posed = await h.snapshot();

  await captureReplay(h, "held", () => advanceCycles(h, 1));
  const after = await h.snapshot();

  assertNotNull(posed.sim, "the run is live at the pose");
  assertTrue(
    !(partById(posed, arm)?.tape ?? []).includes("grab"),
    "no cell of the arm's tape is grab, so the hold can only be the posed one",
  );
  assertLength(gripsOf(posed, arm), 1, "one call closes one gripper");
  assertEqual(
    heldBy(posed, arm, 0),
    under,
    "the arm's gripper on the spoke the call named holds the mote it named",
  );
  assertEqual(
    after.sim?.status,
    "running",
    "the cycle reached its boundary rather than faulting",
  );
  assertEqual(
    `${moteById(after, under)?.q},${moteById(after, under)?.r}`,
    "0,1",
    "the held mote was carried by the arm's rotation about its base",
  );
  assertEqual(
    `${moteById(after, beyond)?.q},${moteById(after, beyond)?.r}`,
    "-1,2",
    "the rest of the constellation was carried too: the hold is on the whole of it",
  );
  assertNotNull(
    filamentBetween(after, under, beyond),
    "the constellation moved as one rigid body, so the filament joining it stands",
  );
  assertLength(
    gripsOf(after, arm),
    1,
    "the grip persists across the cycle: nothing dropped it",
  );
  assertEqual(
    gripsOf(after, arm)[0]?.mote,
    under,
    "and it is still the same mote's constellation the gripper holds; the spoke it is reported on is the one the turned gripper now sits on",
  );
});
