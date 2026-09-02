// instrumentation/set-grip-throws-on-a-mote-elsewhere — a gripper takes hold of
// what is under it and nothing else.
//
// THE RULE. "`setGrip(part, spoke, mote)` | That part's gripper on spoke
// direction `spoke`, `0` to `5`, takes hold of `mote`'s constellation. THE SPOKES
// AND THE HEXES ARE THE PART'S AS ITS LIVE POSE STANDS. A part with no gripper on
// that spoke, A MOTE RESTING ANYWHERE BUT THAT GRIPPER'S HEX, and a fixture each
// throw." (`specs/instrumentation.md`, The run). Where a gripper stands: "one
// gripper per spoke at `base + length * DIRS[d]`" (`specs/parts.md`).
//
// THE WORLD IS POSED, NOT SEARCHED. A bare run with one arm at the middle, its
// rest rotation `0` and its length `1`, so its gripper stands on `(1, 0)`. One
// `dust` is spawned on `(0, 1)`, a hex the arm's gripper does NOT stand on. The
// arm's tape is empty, so no `grab` can close anything, and nothing else is on the
// field.
//
// THE VERDICT. The call throws an `Error` and `sim.grips` is empty: no grip was
// added, and the mote is still resting where it stood. Then the arm's LIVE
// rotation alone is posed to `1` with `setPoseRotation`, which puts its gripper on
// `(0, 1)` — the very hex the mote rests on — and the same mote is taken up
// without complaint. So the refusal was the mote's hex against the gripper's, read
// from the live pose, rather than a call that refuses everything.

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
  captureStill,
  createHarness,
  heldBy,
  moteById,
  openBareRun,
  partIds,
  posePart,
  spawnMote,
  type Harness,
} from "../harness";

/** Where the mote rests: not the gripper's hex at the arm's rest rotation. */
const ELSEWHERE = at(0, 1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("throws on a mote resting off the gripper's hex, and adds no grip", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, [])]),
  });
  const arm = (await partIds(h))[0] ?? -1;
  const mote = await spawnMote(h, ELSEWHERE, "dust");

  const refusal = await refusalOf(() => h.debug.setGrip(arm, 0, mote));
  const refused = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "refused");

  await posePart(h, arm, { rotation: 1 });
  await h.debug.setGrip(arm, 1, mote);
  const taken = await h.snapshot();

  assertNotNull(refused.sim, "the run is live at the refused call");
  assertTrue(
    refusal instanceof Error,
    "setGrip naming a mote resting off that gripper's hex throws an Error",
  );
  assertLength(refused.sim?.grips ?? [], 0, "the refused call added no grip");
  assertEqual(
    `${moteById(refused, mote)?.q},${moteById(refused, mote)?.r}`,
    `${ELSEWHERE.q},${ELSEWHERE.r}`,
    "the mote is left resting where it stood",
  );
  assertEqual(
    heldBy(taken, arm, 1),
    mote,
    "the same mote is taken up once the live pose puts a gripper on its hex, so the refusal was the hex rather than the call",
  );
});

/**
 * What `call` threw, or `null` when it returned.
 *
 * Every member of the surface answers a promise (`validation/README.md`), so a
 * refusal arrives as a rejection and is read back here rather than through
 * `assert.ts`'s synchronous throw helper.
 */
async function refusalOf(call: () => Promise<unknown>): Promise<unknown> {
  try {
    await call();
    return null;
  } catch (error) {
    return error;
  }
}
