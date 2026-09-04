// simulation/an-off-field-mote-collides — the collision rule reaches past the rim.
//
// THE RULE. "A mote may be carried over, dropped on, and rest on a hex off the
// field. Off the field IT COLLIDES, is grabbed, and is banked exactly as on it,
// and no sigil acts on it" (`specs/simulation.md`, Motion and carrying). The rule
// it collides by is unqualified by where the motes are: "Within the motion step,
// every mote's position is evaluated at the sample fractions `t = k / 8` for `k`
// from `1` to `8`, in order. If at any sample the distance between the centers of
// two motes is strictly less than `2 * MOTE_COLLIDE_R` (`38`), the run faults as
// `collision` at that sample, naming every pair within the threshold at that
// sample" (Collision).
//
// THE CONFIGURATION IS WORKED EXAMPLE A, MOVED OFF THE FIELD. The specification
// pins that configuration with its own figures — "An arm at `(0, 0)`, length 1,
// carries a mote from `(1, 0)` toward `(0, 1)` with `rotate-cw`. A mote rests on
// `(1, 1)`. First sample within `38`: `36.10` at `t = 3/8`. Nearest sampled
// approach: `35.14` at `t = 4/8`. Outcome: Faults" — and every distance in it is
// preserved by moving it, because `specs/field.md` places a hex at
// `hexX = FIELD_CX + HEX_PITCH * (q + r / 2)` and
// `hexY = FIELD_CY + HEX_PITCH * (sqrt(3) / 2) * r`, which are affine in `(q, r)`,
// and because rotating the whole configuration about its own base is one of the
// six symmetries `specs/field.md` fixes.
//
// So the arm is anchored on the rim hex `(5, 0)` — "Every hex of the part is on
// the field: an arm or wheel's ANCHOR" (`specs/parts.md`) leaves an anchor no
// choice but the field, while "a gripper and the drawn arm between base and
// gripper pass over any hex, on or off the field" frees everything else — and the
// configuration is turned five steps, so:
//
//   * the arm stands at rotation `5`, its gripper on `(5, 0) + DIRS[5]` = `(6, -1)`,
//     carrying the mote resting there;
//   * `rotate-cw` sweeps that gripper toward spoke `0`, `(6, 0)`;
//   * the resting mote is the example's `(1, 1)` under the same five steps, which
//     the clockwise formula `(q, r) -> (-r, q + r)` sends to the offset `(2, -1)`:
//     the hex `(7, -1)`.
//
// `onField` puts all three of `(6, -1)`, `(6, 0)` and `(7, -1)` outside the field
// of radius `FIELD_R` (`5`), so both motes and the whole sweep are off it.
//
// THE VERDICT. The run faults as `collision` at the sample the specification names
// for this configuration, `t = 3/8` — "a `collision` leaves the fraction at that
// sample's `k / 8`" — and the fault names both off-field motes. A build whose
// collision check only walks the field's own hexes finds nothing and runs on.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertNear,
  assertNotNull,
  assertTrue,
} from "../assert";
import { FRACTION_TOLERANCE, sampleFraction } from "../constants";
import { at, onField } from "../field";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  openBareRun,
  partIds,
  spawnMote,
  takeGrip,
  type Harness,
} from "../harness";

/** The arm's anchor, and the spoke its gripper starts on. */
const RIM = at(5, 0);
const SPOKE = 5;

/** Example A's three hexes, turned five steps onto the rim: all off the field. */
const CARRIED = at(6, -1);
const TOWARD = at(6, 0);
const RESTING = at(7, -1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("faults as collision when two motes off the field come within 38", async () => {
  assertTrue(
    onField(RIM),
    "the arm's anchor is on the field, as every placed part's anchor must be",
  );
  assertTrue(
    !onField(CARRIED) && !onField(TOWARD) && !onField(RESTING),
    "the carried mote, the hex it sweeps toward and the resting mote are all outside the field of radius FIELD_R (5)",
  );

  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("arm", RIM.q, RIM.r, SPOKE, 1, ["rotate-cw"])]),
  });
  const arm = (await partIds(h))[0] ?? -1;
  const carried = await spawnMote(h, CARRIED, "dust");
  await takeGrip(h, arm, SPOKE, carried);
  const resting = await spawnMote(h, RESTING, "dust");

  await advanceCycles(h, 1);
  await h.advance(1);
  await captureStill(h, "faulted");

  const sim = (await h.snapshot()).sim;
  assertNotNull(sim, "the run is still live after the cycle that faulted it");
  assertEqual(
    sim?.status,
    "faulted",
    "two motes off the field collide exactly as two on it would",
  );
  assertEqual(
    sim?.fault?.kind,
    "collision",
    "two mote centers strictly closer than 2 * MOTE_COLLIDE_R (38) fault as collision",
  );
  assertDeepEqual(
    sim?.fault?.motes,
    [carried, resting].sort((a, b) => a - b),
    "the fault names both off-field motes, in ascending mote id",
  );
  assertNear(
    sim?.fraction ?? -1,
    sampleFraction(3),
    FRACTION_TOLERANCE,
    "this is worked example A moved off the field, whose first sample within 38 is 36.10 at t = 3/8",
  );
});
