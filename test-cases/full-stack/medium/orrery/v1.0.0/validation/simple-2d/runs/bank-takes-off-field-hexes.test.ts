// runs/bank-takes-off-field-hexes — a hex off the field enters the bank exactly
// as a hex on it does.
//
// THE RULE. "A hex off the field is banked like any other"
// (`specs/simulation.md`, Completion and metrics), which the motion rules say
// again from the mote's side: "A mote may be carried over, dropped on, and rest
// on a hex off the field. Off the field it collides, is grabbed, and is banked
// exactly as on it" (Motion and carrying). The field is the hexagonal region of
// radius `FIELD_R` (`5`) around `(0, 0)` (`specs/field.md`), and only a PART is
// required to stand on it: "Every hex of the part is on the field"
// (`specs/parts.md`, placement rule 1), while "a gripper and the drawn arm
// between base and gripper pass over any hex, on or off the field".
//
// THE CONFIGURATION. A `piston` anchored on `(4, 0)`, on the field, rotation `0`,
// at `ARM_MIN_LEN` (`1`), so its gripper rests on `(5, 0)` — the last hex of the
// field along that spoke. One `sol` is spawned there and held through the gate
// `specs/instrumentation.md` names, "`setGrip`, which takes hold with no `grab`
// ever running". The tape is a single `extend`, which "translates the gripper one
// hex along its spoke" and imposes the same translation on what it carries, so
// the cycle lands the mote on `(6, 0)` — one step past the field's edge, and a
// hex nothing has banked.
//
// THE VERDICT. The mote comes to rest on a hex that is genuinely off the field,
// and the bank grows by exactly that one hex: from the two the run opened with —
// the anchor and the resting gripper hex — to three.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertTrue } from "../assert";
import { ARM_MIN_LEN } from "../constants";
import { at, onField, type Hex } from "../field";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  moteAt,
  openBareRun,
  partIds,
  spawnMote,
  takeGrip,
  type Harness,
} from "../harness";

/** The piston's anchor, its resting gripper hex, and where `extend` lands. */
const ANCHOR = at(4, 0);
const RESTING_HEX = at(5, 0);
const OFF_FIELD_HEX = at(6, 0);
const SPOKE = 0;

/** One piston whose single cycle extends one hex along its spoke. */
const MACHINE = solution([
  armPart("piston", ANCHOR.q, ANCHOR.r, 0, ARM_MIN_LEN, ["extend"]),
]);

/** What the bank opens holding: the anchor and the resting gripper hex. */
const OPENED = new Set(
  [ANCHOR, RESTING_HEX].map((hex: Hex) => `${hex.q},${hex.r}`),
);

/** Everything the bank holds once the mote has come to rest off the field. */
const AFTER = new Set(
  [ANCHOR, RESTING_HEX, OFF_FIELD_HEX].map((hex: Hex) => `${hex.q},${hex.r}`),
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("counts the off-field hex a carried mote comes to rest on", async () => {
  await openBareRun(h, { challenge: BARE, machine: MACHINE });
  const piston = (await partIds(h))[0] ?? -1;
  const mote = await spawnMote(h, RESTING_HEX, "sol");
  await takeGrip(h, piston, SPOKE, mote);

  const opened = await h.snapshot();

  await captureReplay(h, "off-field", () => advanceCycles(h, 1));

  const carried = await h.snapshot();
  assertTrue(
    onField(ANCHOR) && onField(RESTING_HEX) && !onField(OFF_FIELD_HEX),
    "the scenario is posed across the field's edge: the piston stands on it and the cycle carries the mote past it",
  );
  assertNotNull(opened.sim, "the run is live once it has been started");
  assertEqual(
    opened.sim?.area,
    OPENED.size,
    "the bank opens holding the piston's anchor and its one resting gripper hex",
  );
  assertNotNull(carried.sim, "the run is still live after the cycle");
  assertEqual(
    carried.sim?.status,
    "running",
    "nothing faults: only motes collide, and this is the only mote on the field",
  );
  assertEqual(
    moteAt(carried, OFF_FIELD_HEX)?.id,
    mote,
    "extend carries the held mote one hex along the spoke, onto a hex off the field",
  );
  assertEqual(
    carried.sim?.area,
    AFTER.size,
    "a hex off the field is banked like any other, so area counts it exactly as it counts a hex on the field",
  );
});
