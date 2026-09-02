// simulation/grab-over-nothing-holds-nothing — a gripper closing over a vacant hex
// takes nothing, on the field or off it.
//
// THE RULE. "3. Grabs. Every gripper of every part whose instruction is `grab`
// closes ... A gripper over a fixture or over NOTHING closes on nothing"
// (`specs/simulation.md`). Off the field the same rule applies unchanged: "A mote
// may be carried over, dropped on, and rest on a hex off the field. Off the field
// it collides, is grabbed, and is banked exactly as on it" (Motion and carrying),
// so a vacant hex outside the rim is a vacant hex.
//
// WHERE A GRIPPER MAY STAND. "Every hex of the part is on the field: an arm or
// wheel's ANCHOR, every cell of a track, and every footprint hex of a sigil, rise,
// or set" (`specs/parts.md`, Placement rules) — the anchor, and not the gripper.
// "Only motes collide, so a gripper and the drawn arm between base and gripper
// pass over any hex, on or off the field." So an arm anchored on the rim hex
// `(5, 0)` at rotation `0` has its gripper on `(5, 0) + DIRS[0]` = `(6, 0)`, which
// `specs/field.md` puts outside the field: "hex `(q, r)` is on the field exactly
// when `max(|q|, |r|, |q + r|) <= FIELD_R`", and `max(6, 0, 6)` is `6`.
//
// THE CONFIGURATION. Two parts, both with `grab` on their tapes:
//
//   * a `triarm` on `(0, 0)` at rotation `0`, length `1`, whose three grippers
//     stand on `(1, 0)`, `(-1, 1)` and `(0, -1)` (`specs/parts.md`: the spokes
//     `rotation`, `rotation + 2`, `rotation + 4`, each at
//     `base + length * DIRS[d]`). ONE mote rests, on `(1, 0)`; the other two
//     gripper hexes are vacant field hexes.
//   * an `arm` on the rim hex `(5, 0)` at rotation `0`, length `1`, whose gripper
//     stands on the vacant OFF-FIELD hex `(6, 0)`.
//
// THE ONE MOTE IS THE CONTROL. It is under a gripper of the same part, closing in
// the same grab step, so a build whose grab step does nothing at all fails on it
// rather than passing on the two vacancies. And it is the whole of the field, so
// the collision rule has no pair and nothing can fault.
//
// THE VERDICT. The run reports exactly ONE grip in the world: the triarm's spoke
// over the mote. The two vacant field spokes report none, and the vacant off-field
// spoke reports none — a vacancy beyond the rim is refused exactly as a vacancy
// inside it is.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNull, assertTrue } from "../assert";
import { at, onField } from "../field";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import { gripperHex, spokesOf } from "../parts";
import {
  advanceCycles,
  captureStill,
  createHarness,
  gripsOf,
  heldBy,
  moteAt,
  openBareRun,
  partIds,
  spawnMote,
  type Harness,
} from "../harness";

/** The triarm's anchor, rotation and length. */
const HUB = at(0, 0);
const HUB_ROTATION = 0;
const LENGTH = 1;

/** The rim arm's anchor, and the off-field hex its one gripper stands on. */
const RIM = at(5, 0);
const BEYOND = at(6, 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("closes on nothing over a vacant hex, inside the rim and beyond it", async () => {
  assertTrue(
    onField(RIM),
    "the rim arm's anchor is on the field, as every placed part's anchor must be",
  );
  assertTrue(
    !onField(BEYOND),
    "the rim arm's gripper stands on a hex outside the field of radius FIELD_R (5)",
  );

  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("triarm", HUB.q, HUB.r, HUB_ROTATION, LENGTH, ["grab"]),
      armPart("arm", RIM.q, RIM.r, 0, LENGTH, ["grab"]),
    ]),
  });
  const placed = await partIds(h);
  const triarm = placed[0] ?? -1;
  const rimArm = placed[1] ?? -1;

  const spokes = spokesOf("triarm", HUB_ROTATION);
  const occupied = spokes[0] as number;
  const vacant = spokes.slice(1);
  const mote = await spawnMote(h, gripperHex(HUB, occupied, LENGTH), "dust");

  const posed = await h.snapshot();
  for (const spoke of vacant) {
    assertNull(
      moteAt(posed, gripperHex(HUB, spoke, LENGTH)),
      `the triarm's gripper on spoke ${spoke} stands on a vacant field hex`,
    );
  }
  assertNull(
    moteAt(posed, BEYOND),
    "the rim arm's gripper stands on a vacant hex beyond the field",
  );

  await advanceCycles(h, 1);
  await captureStill(h, "empty");

  const boundary = await h.snapshot();
  assertEqual(
    boundary.sim?.status,
    "running",
    "one mote alone on the field gives the collision rule no pair, so nothing faults",
  );
  assertEqual(
    heldBy(boundary, triarm, occupied),
    mote,
    "the gripper over a mote takes hold, so the grab step really ran",
  );
  for (const spoke of vacant) {
    assertNull(
      heldBy(boundary, triarm, spoke),
      `a gripper over a vacant field hex closes on nothing, so no grip appears for spoke ${spoke}`,
    );
  }
  assertLength(
    gripsOf(boundary, rimArm),
    0,
    "a gripper over a vacant hex OFF the field closes on nothing, exactly as one on it does",
  );
  assertLength(
    boundary.sim?.grips ?? [],
    1,
    "the one mote in the world is the one thing any gripper took hold of",
  );
});
