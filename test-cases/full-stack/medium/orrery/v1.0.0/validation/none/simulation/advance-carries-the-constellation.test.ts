// simulation/advance-carries-the-constellation — `advance` translates the held
// constellation with the base.
//
// THE RULE, from the motion table of `specs/simulation.md` (Motion and carrying):
// "`advance`, `recede` — The base translates to the adjacent track cell, wrapping
// on a closed track. | Translation by the same vector, linearly in `t`." "The same
// vector" is the base's own step between the two track cells, and what it applies
// to is the whole group: "A carried constellation moves as one rigid body: every
// mote of it follows the motion, and at `t = 1` every mote lands exactly on a hex
// center", with `specs/field.md` fixing rigidity — "when any mote of one is
// carried, the whole group moves as a body and every filament keeps its length and
// relative direction".
//
// THE OFFSET IS KEPT because the gripper rides the base: `specs/parts.md` puts
// "one gripper per spoke at `base + length * DIRS[d]`", so a base translated by a
// vector carries its grippers by that vector too, and the constellation moving by
// the same vector ends where it began relative to the gripper holding it.
//
// THE CONFIGURATION. An open three-cell track `(0, 1)`, `(1, 1)`, `(2, 1)` — its
// cells adjacent in order, as `specs/parts.md` requires — with one `arm` anchored
// on its first cell `(0, 1)` at rotation `4`. `specs/field.md` gives `DIRS[4]` as
// `(0, -1)`, so at length `1` the arm's gripper is `(0, 0)`. Its tape cell for the
// cycle is `advance`, which carries the base to `(1, 1)`: a translation by
// `(+1, 0)`.
//
// The constellation is TWO motes, on `(0, 0)` and `(1, 0)`, joined by one filament
// — adjacent hexes, as `specs/field.md` requires — held by the gripper through the
// mote on its own hex. Only one of the two is on a gripper, which is what makes
// "every mote of a constellation" a reading rather than a restatement, and the
// leading mote ends on the hex the trailing one vacated, which a build that moved
// them one at a time could not manage without colliding.
//
// A translation carries both motes by the same vector, so they stay one hex apart
// the whole slide and nothing comes within the `38` the collision rule watches.
// The hold is given with `setGrip`, "which takes hold with no `grab` ever running"
// (`specs/instrumentation.md`), and the field holds these two motes alone.
//
// THE VERDICT. After one cycle the held mote rests on `(1, 0)` and its partner on
// `(2, 0)` — each translated by the `(+1, 0)` the base travelled — the filament
// still joins them, and the held mote is still on the arm's gripper hex.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { at, translate, type Hex } from "../field";
import { armPart, solution, trackPart } from "../formats";
import { BARE } from "../fixtures";
import { gripperHex } from "../parts";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  filamentBetween,
  moteById,
  openBareRun,
  partIds,
  poseOf,
  spawnConstellation,
  takeGrip,
  type Harness,
} from "../harness";

/** The track's path, in order: the arm starts on its first cell. */
const TRACK: readonly Hex[] = [at(0, 1), at(1, 1), at(2, 1)];

/** The spoke the arm carries, whose `DIRS` offset is `(0, -1)`. */
const SPOKE = 4;

/** The constellation's two hexes when the cycle begins. */
const START: readonly Hex[] = [at(0, 0), at(1, 0)];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("translates every mote of the held constellation by the vector the base travelled", async () => {
  const from = TRACK[0] as Hex;
  const to = TRACK[1] as Hex;
  const vector: Hex = { q: to.q - from.q, r: to.r - from.r };
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      trackPart([...TRACK]),
      armPart("arm", from.q, from.r, SPOKE, 1, ["advance"]),
    ]),
  });
  const arm = (await partIds(h))[1] ?? -1;
  const motes = await spawnConstellation(
    h,
    START.map((hex) => ({ hex, type: "dust" as const })),
    [{ a: 0, b: 1 }],
  );
  const held = motes[0] ?? -1;
  const trailing = motes[1] ?? -1;
  await takeGrip(h, arm, SPOKE, held);

  await captureReplay(h, "carry", () => advanceCycles(h, 1));

  const after = await h.snapshot();
  assertNotNull(after.sim, "the run is live through the cycle");
  assertEqual(
    after.sim?.status,
    "running",
    "a rigid pair translated by one vector stays 48 apart, so nothing collides",
  );
  assertEqual(
    after.sim?.cycle,
    1,
    "one cycle of game time completes the cycle it covered",
  );
  assertEqual(
    `${poseOf(after, arm)?.cell.q},${poseOf(after, arm)?.cell.r}`,
    `${to.q},${to.r}`,
    "the base really advanced to the track's next cell",
  );

  for (const [index, mote] of motes.entries()) {
    const began = START[index] as Hex;
    const landed = translate(began, vector);
    const reported = moteById(after, mote);
    assertNotNull(
      reported,
      `mote ${index} of the constellation is still reported`,
    );
    assertEqual(
      `${reported?.q},${reported?.r}`,
      `${landed.q},${landed.r}`,
      `every mote of the held constellation translates by the same vector the base travelled: (${began.q}, ${began.r}) lands on (${landed.q}, ${landed.r})`,
    );
  }

  const gripper = gripperHex(to, SPOKE, 1);
  assertEqual(
    `${moteById(after, held)?.q},${moteById(after, held)?.r}`,
    `${gripper.q},${gripper.r}`,
    "the constellation keeps its offset from the gripper, which rode the base with it",
  );
  assertNotNull(
    filamentBetween(after, held, trailing),
    "a constellation moves as one rigid body, so the filament still joins the pair",
  );
});
