// instructions/past-end-cells-rest — a cell at or past a tape's own length is a
// blank.
//
// THE RULE. "The machine's period `P` is the largest tape length across its arms
// and wheels ... On cycle `c`, counted from `0`, each part executes the cell at
// index `c` modulo `P` of its own tape, blank cells included; a cell at or past
// the tape's own length is blank" (`specs/instructions.md`, Tapes and the
// period). A blank is a rest: "the part holds its pose for the cycle, keeping
// whatever grip it has."
//
// THE CONFIGURATION. Two arms, on an empty field:
//
//   * the SUBJECT at the origin, rest rotation `0`, length `1`, whose tape is
//     `rotate-cw`, `rotate-cw` — length `2`, and it holds one mote on its
//     gripper hex `(1, 0)`, given with `setGrip`, "which takes hold with no
//     `grab` ever running";
//   * a LONGER arm at `(0, 3)`, holding nothing, whose tape is four `rotate-cw`
//     — length `4`, which makes the machine's period `4`.
//
// The subject's two written cells turn it the SAME way twice on purpose. On
// cycles `2` and `3` the index `c mod P` is `2` and `3`, both at or past its own
// length of `2`, so both are blanks; a build that instead wrapped the index on
// the arm's OWN length would run `rotate-cw` twice more and end two steps
// further round, which is a different rotation and a different hex for the mote.
// Reading the pose back is therefore a reading about the rule rather than about
// a machine that happened to return to where it started.
//
// THE VERDICT. Cycles `0` and `1` turn the subject twice, carrying its mote from
// `(1, 0)` around to `(-1, 1)`. Cycles `2` and `3` then leave the subject at
// exactly the rotation, length and base cell it stood at, its gripper still
// holding the same mote on the same spoke, and the mote still on its hex — with
// the run still `running` and `sim.cycle` at `4`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { at } from "../field";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN, SOUTH } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  gripsOf,
  moteById,
  openBareRun,
  partIds,
  poseOf,
  spawnMote,
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

/** The subject's gripper hex at rest: `base + 1 * DIRS[0]`. */
const START = at(1, 0);

/** Where two clockwise steps about `(0, 0)` carry that mote. */
const AFTER_TWO = at(-1, 1);

it("rests through the cycles past its own tape's end, holding its pose and its grip", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, ["rotate-cw", "rotate-cw"]),
      armPart("arm", SOUTH.q, SOUTH.r, 0, 1, [
        "rotate-cw",
        "rotate-cw",
        "rotate-cw",
        "rotate-cw",
      ]),
    ]),
  });
  const subject = (await partIds(h))[0] ?? -1;
  const mote = await spawnMote(h, START, "dust");
  await takeGrip(h, subject, 0, mote);

  const opened = await h.snapshot();
  assertEqual(
    opened.editor.period,
    4,
    "the machine's period is the largest tape length across its arms and wheels",
  );

  await advanceCycles(h, 2);

  const before = await h.snapshot();
  assertNotNull(
    before.sim,
    "the run is live after the subject's own two cells",
  );
  assertEqual(
    before.sim?.status,
    "running",
    "the subject's two written cells run without faulting",
  );
  assertEqual(
    before.sim?.cycle,
    2,
    "two cycles of game time complete two cycles",
  );
  const was = poseOf(before, subject);
  assertNotNull(was, "the run carries a live pose for the subject");
  assertEqual(
    was?.rotation,
    2,
    "two clockwise steps from rotation 0 leave the subject at rotation 2",
  );
  assertEqual(
    `${moteById(before, mote)?.q},${moteById(before, mote)?.r}`,
    `${AFTER_TWO.q},${AFTER_TWO.r}`,
    "the held mote was carried two clockwise steps about the arm's base",
  );
  const held = gripsOf(before, subject);
  assertLength(held, 1, "the subject is still holding after its own two cells");

  await captureReplay(h, "short-tape", () => advanceCycles(h, 2));

  const after = await h.snapshot();
  assertNotNull(after.sim, "the run is live through cycles 2 and 3");
  assertEqual(
    after.sim?.status,
    "running",
    "a cell at or past a tape's own length is a blank, and a blank never faults",
  );
  assertNull(after.sim?.fault ?? null, "a rest raises no fault");
  assertEqual(
    after.sim?.cycle,
    4,
    "cycles 2 and 3 both reach their boundaries",
  );

  const now = poseOf(after, subject);
  assertNotNull(now, "the run still carries a live pose for the subject");
  assertEqual(
    now?.rotation,
    was?.rotation,
    "cycles 2 and 3 are at or past the subject's tape length of 2, so it rests at the rotation it stood at",
  );
  assertEqual(
    now?.length,
    was?.length,
    "a rest holds the part's length for the cycle",
  );
  assertEqual(
    `${now?.cell.q},${now?.cell.r}`,
    `${was?.cell.q},${was?.cell.r}`,
    "a rest holds the part's base cell for the cycle",
  );
  const still = gripsOf(after, subject);
  assertLength(still, 1, "a rest keeps whatever grip the part has");
  assertEqual(
    still[0]?.spoke,
    held[0]?.spoke,
    "the gripper is still on the spoke it was on",
  );
  assertEqual(
    still[0]?.mote,
    held[0]?.mote,
    "the gripper is still holding the same mote",
  );
  assertEqual(
    `${moteById(after, mote)?.q},${moteById(after, mote)?.r}`,
    `${AFTER_TWO.q},${AFTER_TWO.r}`,
    "a rest imposes no motion on what the part holds, so the mote is still on its hex",
  );
});
