// simulation/an-off-field-mote-is-grabbed — a gripper beyond the rim closes on
// what rests there.
//
// THE RULE. "A mote may be carried over, dropped on, and rest on a hex off the
// field. Off the field it collides, IS GRABBED, and is banked exactly as on it,
// and no sigil acts on it" (`specs/simulation.md`, Motion and carrying). What
// grabbing does is the cycle's third step, unqualified by where the hex is: "Every
// gripper of every part whose instruction is `grab` closes; a gripper over a mote
// that is not a fixture takes hold of that mote's CONSTELLATION".
//
// WHERE THE FIELD ENDS, and where a gripper may stand. "hex `(q, r)` is on the
// field exactly when `max(|q|, |r|, |q + r|) <= FIELD_R`" (`specs/field.md`),
// `FIELD_R` `5`, read here out of `field.ts`'s `onField`; and "Every hex of the
// part is on the field: an arm or wheel's ANCHOR ..." (`specs/parts.md`) — the
// anchor alone, since "a gripper and the drawn arm between base and gripper pass
// over any hex, on or off the field".
//
// THE CONFIGURATION. An arm anchored on the rim hex `(5, 0)` at rotation `5`,
// length `1`, so its one gripper stands on `(5, 0) + DIRS[5]` = `(6, -1)`
// (`specs/parts.md`, with `DIRS[5]` = `(+1, -1)` from `specs/field.md`) — a hex
// `onField` puts OUTSIDE the field. Two motes rest off the field, on `(6, -1)` and
// `(7, -1)`, joined by a filament into one constellation ("A constellation is a
// maximal group of motes connected by filaments", `specs/field.md`); `spawnMote`
// "poses a hex off the field like any other" (`specs/instrumentation.md`). Only
// the mote under the gripper is what the grab closes over.
//
// The tape is `grab`, then `rotate-ccw`, so the two cycles separate the two
// questions: the first takes the hold, the second proves it is a hold on the
// CONSTELLATION by carrying both motes. `rotate-ccw` turns the gripper back to
// spoke `4`, and imposes "The same rotation about the base" on what it holds, so
// the near mote lands on `(5, -1)` and the far one on `(6, -2)` — the
// counterclockwise step `(q, r) -> (q + r, -q)` of `specs/field.md`, applied to
// each mote's offset from `(5, 0)`.
//
// The two motes are the whole of the field, and a rigid rotation holds the
// `HEX_PITCH` (`48`) between them at every sample, outside the `38` the collision
// rule watches.
//
// THE VERDICT. After the grab the run reports one grip for the arm, holding the
// mote its gripper stood over — outside the rim. After the sweep BOTH motes have
// moved, so what the gripper took beyond the rim was the whole constellation,
// exactly as it would have been on the field.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import { at, onField, rotateAbout } from "../field";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  gripsOf,
  heldBy,
  moteById,
  openBareRun,
  partIds,
  spawnConstellation,
  type Harness,
} from "../harness";

/** The arm's anchor, and the spoke its one gripper stands on. */
const RIM = at(5, 0);
const SPOKE = 5;

/** The constellation's two hexes, both outside the rim. */
const NEAR = at(6, -1);
const FAR = at(7, -1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes hold of a constellation resting outside the rim", async () => {
  assertTrue(
    onField(RIM),
    "the arm's anchor is on the field, as every placed part's anchor must be",
  );
  assertTrue(
    !onField(NEAR) && !onField(FAR),
    "both motes rest on hexes outside the field of radius FIELD_R (5)",
  );

  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", RIM.q, RIM.r, SPOKE, 1, ["grab", "rotate-ccw"]),
    ]),
  });
  const arm = (await partIds(h))[0] ?? -1;
  const ids = await spawnConstellation(
    h,
    [
      { hex: NEAR, type: "dust" },
      { hex: FAR, type: "dust" },
    ],
    [{ a: 0, b: 1 }],
  );

  await advanceCycles(h, 1);
  await captureStill(h, "held");

  const grabbed = await h.snapshot();
  assertEqual(
    grabbed.sim?.status,
    "running",
    "two motes resting 48 apart never come within 38, so the grab cycle reaches its boundary",
  );
  assertLength(
    gripsOf(grabbed, arm),
    1,
    "the arm's one gripper closed over the mote on its hex, beyond the rim",
  );
  assertEqual(
    heldBy(grabbed, arm, SPOKE),
    ids[0] ?? -1,
    "a gripper over a mote off the field closes on it exactly as one on the field does",
  );

  await advanceCycles(h, 1);

  const carried = await h.snapshot();
  assertEqual(
    carried.sim?.status,
    "running",
    "a rigid rotation holds the distance between the two motes, so nothing collides",
  );
  for (const [index, hex] of [NEAR, FAR].entries()) {
    const landed = rotateAbout(hex, RIM, -1);
    assertEqual(
      `${moteById(carried, ids[index] ?? -1)?.q},${moteById(carried, ids[index] ?? -1)?.r}`,
      `${landed.q},${landed.r}`,
      `mote ${index} of the off-field constellation rode the counterclockwise step about the arm's base`,
    );
  }
});
