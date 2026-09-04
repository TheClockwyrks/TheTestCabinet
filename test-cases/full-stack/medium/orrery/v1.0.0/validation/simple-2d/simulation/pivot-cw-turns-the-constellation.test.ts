// simulation/pivot-cw-turns-the-constellation — `pivot-cw` turns the constellation
// about the HOLDING GRIPPER's hex.
//
// THE RULE, from the motion table of `specs/simulation.md` (Motion and carrying):
// "`pivot-cw`, `pivot-ccw` — The part does not move. | Rotation about the holding
// gripper's hex, sweeping `60 * t` degrees." `specs/instructions.md` says the same:
// "`pivot-cw` — Each held constellation turns one 60 degree step clockwise about
// the gripper holding it." The center is the GRIPPER's hex, not the part's base,
// and the clockwise step is `specs/field.md`'s: "`(q, r) -> (-r, q + r)`", applied
// "to the offset from that hex".
//
// A constellation carried through it "moves as one rigid body: every mote of it
// follows the motion, and at `t = 1` every mote lands exactly on a hex center".
//
// THE CONFIGURATION. An `arm` on `(0, 0)` at rotation `0`, length `1`, so its
// gripper is `(1, 0)` ("one gripper per spoke at `base + length * DIRS[d]`",
// `specs/parts.md`), with `pivot-cw` in cell `0`. The constellation is TWO motes,
// on `(1, 0)` and `(2, 0)`, joined by one filament, held by that gripper through
// the mote on its own hex.
//
// The base and the gripper are DIFFERENT hexes, which is what makes the center a
// reading: about the gripper `(1, 0)` the trailing mote goes to `(1, 1)`, while
// about the base `(0, 0)` it would go to `(0, 2)`.
//
// The pair stays one hex apart the whole sweep — a rigid body turning about a
// point ON it — so `HEX_PITCH` (`48`) is their separation throughout and nothing
// comes within the `38` the collision rule watches. The hold is given with
// `setGrip`, "which takes hold with no `grab` ever running"
// (`specs/instrumentation.md`), and the field holds these two motes alone.
//
// THE VERDICT. After one cycle the held mote is still on `(1, 0)` — it stands on
// the center of the rotation — and its partner has swung round to `(1, 1)`, with
// the filament still joining them.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { at, rotateAbout } from "../field";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  filamentBetween,
  moteById,
  openBareRun,
  partIds,
  spawnConstellation,
  takeGrip,
  type Harness,
} from "../harness";

/** The gripper's hex, which the pivot turns the constellation about. */
const PIVOT = at(1, 0);

/** The constellation's two hexes when the cycle begins. */
const START = [PIVOT, at(2, 0)] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("swings the constellation one clockwise step about the gripper holding it", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("arm", 0, 0, 0, 1, ["pivot-cw"])]),
  });
  const arm = (await partIds(h))[0] ?? -1;
  const motes = await spawnConstellation(
    h,
    START.map((hex) => ({ hex, type: "dust" as const })),
    [{ a: 0, b: 1 }],
  );
  const held = motes[0] ?? -1;
  const trailing = motes[1] ?? -1;
  await takeGrip(h, arm, 0, held);

  await captureReplay(h, "pivot", () => advanceCycles(h, 1));

  const after = await h.snapshot();
  assertNotNull(after.sim, "the run is live through the cycle");
  assertEqual(
    after.sim?.status,
    "running",
    "a rigid pair one hex apart stays 48 apart through the pivot, so nothing collides",
  );
  assertEqual(
    after.sim?.cycle,
    1,
    "one cycle of game time completes the cycle it covered",
  );

  for (const [index, mote] of motes.entries()) {
    const from = START[index] as { q: number; r: number };
    const to = rotateAbout(from, PIVOT, 1);
    const landed = moteById(after, mote);
    assertNotNull(
      landed,
      `mote ${index} of the constellation is still reported`,
    );
    assertEqual(
      `${landed?.q},${landed?.r}`,
      `${to.q},${to.r}`,
      `pivot-cw turns the held constellation one clockwise step about the holding gripper's hex (${PIVOT.q}, ${PIVOT.r}): (${from.q}, ${from.r}) lands on (${to.q}, ${to.r})`,
    );
  }

  assertNotNull(
    filamentBetween(after, held, trailing),
    "a constellation moves as one rigid body, so the filament still joins the pair",
  );
});
