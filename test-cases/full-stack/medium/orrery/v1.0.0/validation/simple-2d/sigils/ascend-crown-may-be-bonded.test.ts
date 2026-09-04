// sigils/ascend-crown-may-be-bonded — the crown's planet rises while it carries
// filaments. Only the prime's `mercury` has to be unbonded.
//
// THE RULE. "When the prime holds an unbonded, unheld `mercury` and the crown
// holds a planet below `sol`, the `mercury` is consumed and the planet rises one
// rung of `PLANETS`. The planet may be bonded and held" (`specs/sigils.md`,
// Transmuting sigils). The two qualifiers sit on the `mercury` alone, and the
// last sentence says the other side outright. "Unbonded" is the same file's:
// "the mote carries no filament".
//
// THE CONFIGURATION. An `ascend` anchored at `(0, 0)` at rotation `0`, so its
// prime is `(0, 0)` and its crown is `(1, 0)`. A loose, unbonded, unheld
// `mercury` on the prime. On the crown a `saturn` — the first rung, well below
// `sol` — bonded to a `dust` on `(2, 0)`, which is adjacent to the crown and on
// no footprint hex. So the crown's planet carries a filament and the prime's
// `mercury` carries none, which is exactly the arrangement the rule permits.
//
// THE VERDICT. After one cycle the crown carries `jupiter`, one rung above where
// it started, and the `mercury` is gone. The filament is read back as present
// BEFORE the boundary, because a check that could not show the crown was bonded
// would be deciding a different item.
//
// THE WORLD IS POSED, NOT SEARCHED. The bare opener empties the field, the one
// part is a sigil, and a sigil carries no tape — so nothing moves.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { at, neighbor } from "../field";
import { sigilPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  filamentBetween,
  moteAt,
  moteById,
  openBareRun,
  spawnConstellation,
  spawnMote,
  type Harness,
} from "../harness";

let h: Harness;

/** The ascend's prime, its crown, and the hex the crown's bond runs to. */
const PRIME = ORIGIN;
const CROWN = neighbor(ORIGIN, 0);
const BONDED_TO = at(2, 0);

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises a bonded planet on the crown and spends the unbonded mercury", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([sigilPart("ascend", PRIME.q, PRIME.r, 0)]),
  });

  const mercury = await spawnMote(h, PRIME, "mercury");
  const bonded = await spawnConstellation(
    h,
    [
      { hex: CROWN, type: "saturn" },
      { hex: BONDED_TO, type: "dust" },
    ],
    [{ a: 0, b: 1, weight: 1 }],
  );
  const crown = bonded[0] as number;
  const neighbourMote = bonded[1] as number;

  const before = await h.snapshot();

  await advanceCycles(h, 1);
  await captureStill(h, "bonded-crown");

  assertNotNull(
    filamentBetween(before, crown, neighbourMote),
    "the crown's planet starts carrying a filament, so it is bonded",
  );
  assertNull(
    filamentBetween(before, mercury, crown),
    "while the mercury on the prime carries none, so it is unbonded",
  );

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "nothing on the field moves, so the cycle reaches its boundary",
  );
  const risen = moteAt(after, CROWN);
  assertNotNull(risen, "a mote is still resting on the crown hex");
  assertEqual(
    risen?.type,
    "jupiter",
    "a bonded planet on the crown rises one rung like any other",
  );
  assertNull(
    moteById(after, mercury),
    "and the unbonded mercury on the prime was spent raising it",
  );
});
