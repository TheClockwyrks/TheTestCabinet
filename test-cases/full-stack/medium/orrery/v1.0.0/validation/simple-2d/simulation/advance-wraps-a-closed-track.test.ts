// simulation/advance-wraps-a-closed-track — `advance` wraps from a closed track's
// last cell to its first.
//
// THE RULE, from the motion table of `specs/simulation.md` (Motion and carrying):
// "`advance`, `recede` — The base translates to the adjacent track cell, WRAPPING
// ON A CLOSED TRACK. | Translation by the same vector, linearly in `t`."
// `specs/parts.md` states the same and its converse together: "on a closed track
// both wrap between the ends, and on an open track moving past either end faults".
// So the last cell is not an end for a closed track: `advance` there is an
// ordinary step to the first cell, and NOT the `track-end` fault of
// `specs/simulation.md`'s Faults table, which names "`advance` at the last cell...
// of an OPEN track".
//
// WHAT MAKES A TRACK CLOSED. "A track is `closed` when its last cell is adjacent
// to its first and the editor has joined them into a loop" (`specs/parts.md`), and
// a closed path "holds at least three cells" (Placement rules). The shortest such
// loop is the three-cell triangle `(0, 0)`, `(1, 0)`, `(0, 1)`: consecutive cells
// adjacent by `DIRS[0]` and `DIRS[2]`, and the last adjacent to the first by
// `DIRS[4]`, which `specs/field.md` gives as `(0, -1)`.
//
// THE CONFIGURATION. That closed track, with one `arm` anchored on its LAST cell
// `(0, 1)` — "An arm or wheel whose anchor hex is a cell of a track is mounted on
// that track" — at rotation `1`, so its gripper is `(0, 2)` ("one gripper per spoke
// at `base + length * DIRS[d]`", with `DIRS[1]` of `(0, +1)`). Its tape cell for
// the cycle is `advance`, and it holds the one mote resting on that gripper hex.
// The hold is given with `setGrip`, "which takes hold with no `grab` ever running"
// (`specs/instrumentation.md`), and the field holds that one mote alone.
//
// THE VERDICT. The cycle reaches its boundary rather than faulting: the pose ends
// based on `(0, 0)`, the track's FIRST cell, and the mote it holds has travelled
// by that same `(0, -1)` to `(0, 1)`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { at, translate, type Hex } from "../field";
import { armPart, solution, trackPart } from "../formats";
import { BARE } from "../fixtures";
import { gripperHex } from "../parts";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  moteById,
  openBareRun,
  partIds,
  poseOf,
  spawnMote,
  takeGrip,
  type Harness,
} from "../harness";

/** The shortest closed track there is: three cells, its last adjacent to its first. */
const LOOP: readonly Hex[] = [at(0, 0), at(1, 0), at(0, 1)];

/** The spoke the arm carries, whose `DIRS` offset is `(0, +1)`. */
const SPOKE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("steps from the closed track's last cell round to its first, carrying what it holds", async () => {
  const last = LOOP[LOOP.length - 1] as Hex;
  const first = LOOP[0] as Hex;
  const vector: Hex = { q: first.q - last.q, r: first.r - last.r };
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      trackPart([...LOOP], true),
      armPart("arm", last.q, last.r, SPOKE, 1, ["advance"]),
    ]),
  });
  const arm = (await partIds(h))[1] ?? -1;
  const began = gripperHex(last, SPOKE, 1);
  const carried = await spawnMote(h, began, "dust");
  await takeGrip(h, arm, SPOKE, carried);

  await captureReplay(h, "wrapped", () => advanceCycles(h, 1));

  const after = await h.snapshot();
  assertNotNull(after.sim, "the run is live through the cycle");
  assertEqual(
    after.sim?.status,
    "running",
    "a closed track wraps rather than faulting, so the cycle reaches its boundary",
  );
  assertNull(
    after.sim?.fault ?? null,
    "advance at the last cell of a CLOSED track is not track-end",
  );
  assertEqual(
    after.sim?.cycle,
    1,
    "one cycle of game time completes the cycle it covered",
  );

  const pose = poseOf(after, arm);
  assertNotNull(
    pose,
    "the run reports a live pose for the arm after the cycle",
  );
  assertEqual(
    `${pose?.cell.q},${pose?.cell.r}`,
    `${first.q},${first.r}`,
    "advance on a closed track's last cell ends the cycle based on that track's first cell",
  );

  const landed = translate(began, vector);
  const held = moteById(after, carried);
  assertNotNull(held, "the carried mote is still reported after the wrap");
  assertEqual(
    `${held?.q},${held?.r}`,
    `${landed.q},${landed.r}`,
    "what the part holds translates by the same vector the base travelled between the two cells",
  );
});
