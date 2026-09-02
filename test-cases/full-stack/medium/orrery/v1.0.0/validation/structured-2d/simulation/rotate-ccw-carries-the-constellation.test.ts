// simulation/rotate-ccw-carries-the-constellation — `rotate-ccw` turns the held
// constellation about the same base.
//
// THE RULE, from the motion table of `specs/simulation.md` (Motion and carrying).
// The `rotate-ccw` row imposes on each held constellation "The same rotation about
// the base" the part turns about, and the paragraph under the table fixes what
// "the constellation" covers: "A carried constellation moves as one rigid body:
// every mote of it follows the motion, and at `t = 1` every mote lands exactly on
// a hex center." `specs/field.md` fixes the formula — "Counterclockwise:
// `(q, r) -> (q + r, -q)`", applied "to the offset from that hex" when the center
// is not the origin — and fixes the constellation itself: "A constellation is a
// maximal group of motes connected by filaments", and "Constellations are rigid:
// when any mote of one is carried, the whole group moves as a body and every
// filament keeps its length and relative direction."
//
// THE CONFIGURATION. An `arm` on `(0, 0)` at rotation `0`, length `1`, so its
// gripper is `(1, 0)` ("one gripper per spoke at `base + length * DIRS[d]`",
// `specs/parts.md`), with `rotate-ccw` in cell `0`. The constellation is TWO
// motes, on `(1, 0)` and `(2, 0)`, joined by one filament — adjacent hexes, as
// `specs/field.md` requires of a filament — and the gripper holds it by the mote
// on its own hex. Only one of the two motes is on a gripper, which is what makes
// "every mote of it follows the motion" a reading rather than a restatement.
//
// Counterclockwise about `(0, 0)`, the offset `(1, 0)` becomes `(1, -1)` and
// `(2, 0)` becomes `(2, -2)`. The two motes stay one hex apart the whole sweep — a
// rigid body turning about a point outside it — so `HEX_PITCH` (`48`) is their
// closest approach and nothing comes within the `38` the collision rule watches.
//
// The hold is given with `setGrip`, "which takes hold with no `grab` ever running"
// (`specs/instrumentation.md`), and the field holds these two motes alone.
//
// THE VERDICT. After one cycle the held mote rests on `(1, -1)` and its partner on
// `(2, -2)` — each its cycle-start hex rotated one counterclockwise step about the
// arm's base — and the filament still joins them.

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

/** The constellation's two hexes when the cycle begins. */
const START = [at(1, 0), at(2, 0)] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("rotates every mote of the held constellation one counterclockwise step about the base", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("arm", 0, 0, 0, 1, ["rotate-ccw"])]),
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

  await captureReplay(h, "carry", () => advanceCycles(h, 1));

  const after = await h.snapshot();
  assertNotNull(after.sim, "the run is live through the cycle");
  assertEqual(
    after.sim?.status,
    "running",
    "a rigid pair one hex apart stays 48 apart through the sweep, so nothing collides",
  );
  assertEqual(
    after.sim?.cycle,
    1,
    "one cycle of game time completes the cycle it covered",
  );

  for (const [index, mote] of motes.entries()) {
    const from = START[index] as { q: number; r: number };
    const to = rotateAbout(from, at(0, 0), -1);
    const landed = moteById(after, mote);
    assertNotNull(
      landed,
      `mote ${index} of the constellation is still reported`,
    );
    assertEqual(
      `${landed?.q},${landed?.r}`,
      `${to.q},${to.r}`,
      `every mote of a held constellation is rotated one counterclockwise step about the rotating part's base: (${from.q}, ${from.r}) lands on (${to.q}, ${to.r})`,
    );
  }

  assertNotNull(
    filamentBetween(after, held, trailing),
    "a constellation moves as one rigid body, so the filament still joins the pair",
  );
});
