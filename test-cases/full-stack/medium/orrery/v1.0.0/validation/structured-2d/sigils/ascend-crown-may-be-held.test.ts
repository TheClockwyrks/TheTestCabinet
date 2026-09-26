// sigils/ascend-crown-may-be-held — the crown's planet rises while a gripper
// holds its constellation. Only the prime's `mercury` has to be unheld.
//
// THE RULE. "When the prime holds an unbonded, unheld `mercury` and the crown
// holds a planet below `sol`, the `mercury` is consumed and the planet rises one
// rung of `PLANETS`. The planet may be bonded and held" (`specs/sigils.md`,
// Transmuting sigils). The two qualifiers sit on the `mercury` alone, and the
// last sentence says the other side outright. "Unheld" is the same file's: "no
// gripper holds any mote of the mote's constellation".
//
// THE CONFIGURATION. An arm at `(2, 0)`, rotation `3`, length `1`, so its one
// spoke points west — `specs/parts.md` gives an `arm` a single gripper on its
// rotation's spoke, at `base + length * DIRS[d]` — and its gripper stands on
// `(1, 0)`. An `ascend` anchored at `(0, 0)` at rotation `0`, so its prime is
// `(0, 0)` and its crown is that same `(1, 0)`. A loose, unbonded, unheld
// `mercury` on the prime, a `saturn` — the first rung, well below `sol` — on the
// crown, and the gripper given that `saturn` with `setGrip`, "which takes hold
// with no `grab` ever running" (`specs/instrumentation.md`). The arm's tape is
// empty, so it rests and nothing on the field moves: "a blank cell is a rest on
// every part, a wheel included, and never faults" (`specs/simulation.md`).
//
// THE VERDICT. After one cycle the crown carries `jupiter`, one rung above where
// it started, and the `mercury` is gone. The hold is read back on both sides of
// the boundary — a check that could not show the crown was held would be deciding
// a different item — and it survives, because "grips persist across cycles until
// dropped".

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { at, neighbor } from "../field";
import { armPart, sigilPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  gripsOf,
  heldBy,
  moteAt,
  moteById,
  openBareRun,
  partIds,
  spawnMote,
  takeGrip,
  type Harness,
} from "../harness";

let h: Harness;

/** The arm's base and the spoke direction its one gripper stands on. */
const BASE = at(2, 0);
const SPOKE = 3;

/** The ascend's prime, and the crown that is also the arm's gripper hex. */
const PRIME = ORIGIN;
const CROWN = neighbor(ORIGIN, 0);

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises a held planet on the crown and spends the unheld mercury", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", BASE.q, BASE.r, SPOKE, 1, []),
      sigilPart("ascend", PRIME.q, PRIME.r, 0),
    ]),
  });
  const arm = (await partIds(h))[0] ?? -1;

  const mercury = await spawnMote(h, PRIME, "mercury");
  const crown = await spawnMote(h, CROWN, "saturn");
  await takeGrip(h, arm, SPOKE, crown);

  const before = await h.snapshot();

  await captureReplay(h, "held-crown-rises", () => advanceCycles(h, 1));

  assertEqual(
    heldBy(before, arm, SPOKE),
    crown,
    "a gripper holds the planet on the crown, so the crown's constellation is held",
  );
  assertLength(
    gripsOf(before, arm),
    1,
    "and it is the only gripper holding anything",
  );

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "the arm rests on its blank tape, so the cycle reaches its boundary",
  );
  const risen = moteAt(after, CROWN);
  assertNotNull(risen, "a mote is still resting on the crown hex");
  assertEqual(
    risen?.type,
    "jupiter",
    "a held planet on the crown rises one rung like any other",
  );
  assertNull(
    moteById(after, mercury),
    "and the unheld mercury on the prime was spent raising it",
  );
  assertEqual(
    heldBy(after, arm, SPOKE),
    risen?.id,
    "the gripper still holds the planet on the crown: a grip persists across cycles until dropped",
  );
});
