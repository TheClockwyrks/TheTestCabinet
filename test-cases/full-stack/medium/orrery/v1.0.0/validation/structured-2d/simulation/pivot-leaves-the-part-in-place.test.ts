// simulation/pivot-leaves-the-part-in-place — a pivot does not move the part.
//
// THE RULE, from the motion table of `specs/simulation.md` (Motion and carrying):
// "`pivot-cw`, `pivot-ccw` — The part does not move. | Rotation about the holding
// gripper's hex, sweeping `60 * t` degrees." The part's own column is the whole of
// the requirement here: whatever the constellation does, the three figures a live
// pose carries — "poses: [{ part, rotation, length, cell: { q, r } }]"
// (`specs/instrumentation.md`, Snapshot shape) — end the cycle exactly as they
// began it.
//
// THE CONFIGURATION, posed twice, once per pivot direction. A `piston` mounted on
// an open track — "An arm or wheel whose anchor hex is a cell of a track is
// mounted on that track" (`specs/parts.md`) — anchored on the track's middle cell
// `(0, 0)` at rotation `0` and length `2`, so its gripper is `(2, 0)`. Each of the
// three figures is therefore something the run COULD have moved and did not: a
// piston's length changes at run time, a mounted part's cell changes at run time,
// and any arm's rotation does.
//
// The constellation is TWO motes, on `(2, 0)` and `(3, 0)`, joined by one
// filament, held by the gripper through the mote on its own hex. The pair stays one
// hex apart through the swing, so nothing comes within the `38` the collision rule
// watches, and the field holds these two motes alone.
//
// AND THE PIVOT REALLY RAN. The trailing mote is read back on the hex the pivot
// swings it to — `(2, 1)` clockwise, `(3, -1)` counterclockwise, each its start
// rotated about the gripper's hex `(2, 0)` by `specs/field.md`'s formulas. Without
// that reading a build whose pivots do nothing at all would pass an item about a
// part that does not move, on the strength of moving nothing.
//
// THE VERDICT. In both directions the run reports the piston at rotation `0`,
// length `2` and base cell `(0, 0)` after the cycle, while the constellation it
// holds has turned.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { at, rotateAbout, type Hex } from "../field";
import { armPart, solution, trackPart } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  moteById,
  openBareRun,
  partIds,
  poseOf,
  spawnConstellation,
  takeGrip,
  type Harness,
} from "../harness";

/** The track the piston is mounted on, so its base cell is something that could move. */
const TRACK: readonly Hex[] = [at(-1, 0), at(0, 0), at(1, 0)];

/** The piston's anchor, which is also its base cell for the whole run. */
const BASE: Hex = at(0, 0);

/** The gripper's hex, which the pivot turns the constellation about. */
const PIVOT: Hex = at(2, 0);

/** The constellation's two hexes when the cycle begins. */
const START: readonly Hex[] = [PIVOT, at(3, 0)];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * Pose the mounted piston and its constellation, run one pivot cycle, and read the
 * part's pose back beside the constellation the pivot turned.
 *
 * `turn` is `1` for `pivot-cw` and `-1` for `pivot-ccw`, which is the step
 * `specs/field.md`'s rotation formulas take.
 */
async function leavesThePistonWhereItStood(
  instruction: "pivot-cw" | "pivot-ccw",
  turn: 1 | -1,
  capture: string | null,
): Promise<void> {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      trackPart([...TRACK]),
      armPart("piston", BASE.q, BASE.r, 0, 2, [instruction]),
    ]),
  });
  const piston = (await partIds(h))[1] ?? -1;
  const motes = await spawnConstellation(
    h,
    START.map((hex) => ({ hex, type: "dust" as const })),
    [{ a: 0, b: 1 }],
  );
  await takeGrip(h, piston, 0, motes[0] ?? -1);

  const before = poseOf(await h.snapshot(), piston);
  assertNotNull(before, "the run reports a live pose for the mounted piston");

  await advanceCycles(h, 1);
  if (capture !== null) await captureStill(h, capture);

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    `${instruction} swings a rigid pair one hex apart, so nothing collides`,
  );
  assertEqual(
    after.sim?.cycle,
    1,
    "one cycle of game time completes the cycle it covered",
  );

  const pose = poseOf(after, piston);
  assertNotNull(
    pose,
    "the run reports a live pose for the piston after the cycle",
  );
  assertEqual(
    pose?.rotation,
    0,
    `${instruction} does not move the part, so its live rotation is as it began`,
  );
  assertEqual(
    pose?.length,
    2,
    `${instruction} does not move the part, so its live length is as it began`,
  );
  assertEqual(
    `${pose?.cell.q},${pose?.cell.r}`,
    `${BASE.q},${BASE.r}`,
    `${instruction} does not move the part, so its live base cell is as it began`,
  );

  const trailing = START[1] as Hex;
  const to = rotateAbout(trailing, PIVOT, turn);
  const swung = moteById(after, motes[1] ?? -1);
  assertNotNull(
    swung,
    "the trailing mote of the constellation is still reported",
  );
  assertEqual(
    `${swung?.q},${swung?.r}`,
    `${to.q},${to.r}`,
    `${instruction} turned the held constellation about the gripper's hex: only what the part holds has moved`,
  );
}

it("ends a pivot cycle with the part's rotation, length and base cell exactly as they began", async () => {
  await leavesThePistonWhereItStood("pivot-cw", 1, "still");
  await leavesThePistonWhereItStood("pivot-ccw", -1, null);
});
