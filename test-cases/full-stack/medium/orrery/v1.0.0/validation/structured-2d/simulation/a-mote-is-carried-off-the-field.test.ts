// simulation/a-mote-is-carried-off-the-field — an arm at the rim may sweep its
// load out past the field's edge.
//
// THE RULE. "A mote may be carried over, dropped on, and rest on a hex off the
// field. Off the field it collides, is grabbed, and is banked exactly as on it,
// and no sigil acts on it" (`specs/simulation.md`, Motion and carrying). Nothing
// in the fault table names leaving the field, so a carry that ends outside the rim
// is a carry like any other.
//
// WHERE THE FIELD ENDS. "The field is the hexagonal region of radius `FIELD_R`
// around `(0, 0)`: hex `(q, r)` is on the field exactly when
// `max(|q|, |r|, |q + r|) <= FIELD_R`" (`specs/field.md`), with `FIELD_R` `5`. The
// suite reads that predicate out of `field.ts`'s `onField`, which carries it
// verbatim, rather than writing a rim hex down and hoping.
//
// WHERE A GRIPPER MAY STAND. "Every hex of the part is on the field: an arm or
// wheel's ANCHOR, every cell of a track, and every footprint hex of a sigil, rise,
// or set" (`specs/parts.md`, Placement rules) — the anchor, and not the gripper —
// and "Only motes collide, so a gripper and the drawn arm between base and gripper
// pass over any hex, ON OR OFF THE FIELD, and over any part."
//
// THE CONFIGURATION. An arm anchored on the rim hex `(5, 0)` at rotation `4`,
// length `1`, so its gripper stands on `(5, 0) + DIRS[4]` = `(5, -1)`
// (`specs/parts.md`, with `DIRS[4]` = `(0, -1)` from `specs/field.md`) — a hex the
// predicate above puts ON the field. One mote rests there, held. Its tape is
// `rotate-cw`, whose row of the motion table turns "the part's direction ... 60
// degrees about its base, clockwise" and imposes "The same rotation about the
// base" on what it holds, so the gripper swings to spoke `5` and its load with it,
// onto `(5, 0) + DIRS[5]` = `(6, -1)` — a hex the predicate puts OUTSIDE the
// field, since `max(6, 1, 5)` is `6`.
//
// The one mote is the whole of the field, so no pair exists for the collision rule
// and nothing but this rule can decide the cycle. The hold is given with
// `setGrip`, "which takes hold with no `grab` ever running".
//
// THE VERDICT. The cycle reaches its boundary with no fault, and the snapshot
// reports the mote's off-field `q` and `r` — `(6, -1)` — with its `x` and `y` on
// that hex's center by the formulas of `specs/field.md`. A build that clamps a
// carry to the rim, or that faults on leaving the field, fails here.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertNear,
  assertNotNull,
  assertNull,
  assertTrue,
} from "../assert";
import { FRACTION_TOLERANCE, HEX_PITCH } from "../constants";
import { at, hexCenter, onField } from "../field";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  moteById,
  openBareRun,
  partIds,
  spawnMote,
  takeGrip,
  type Harness,
} from "../harness";

/** How near a drawn position must land: one fraction's worth of a hex step. */
const DRAWN_TOLERANCE = HEX_PITCH * FRACTION_TOLERANCE;

/** The arm's anchor: a rim hex, which is where a part may still be placed. */
const RIM = at(5, 0);

/** Its gripper's hex before the sweep, and after it. */
const INSIDE = at(5, -1);
const OUTSIDE = at(6, -1);

/** The arm's rest rotation: `DIRS[4]` is `(0, -1)`. */
const ROTATION = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sweeps a held mote onto a hex outside the rim without faulting", async () => {
  assertTrue(
    onField(RIM) && onField(INSIDE),
    "the arm's anchor and its starting gripper hex are both on the field of radius FIELD_R (5)",
  );
  assertTrue(
    !onField(OUTSIDE),
    "the hex the sweep carries the mote onto is outside the field of radius FIELD_R (5)",
  );

  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", RIM.q, RIM.r, ROTATION, 1, ["rotate-cw"]),
    ]),
  });
  const arm = (await partIds(h))[0] ?? -1;
  const mote = await spawnMote(h, INSIDE, "dust");
  await takeGrip(h, arm, ROTATION, mote);

  await captureReplay(h, "outside", () => advanceCycles(h, 1));

  const boundary = await h.snapshot();
  assertEqual(
    boundary.sim?.status,
    "running",
    "carrying a mote off the field raises no fault: no rule of the fault table names leaving it",
  );
  assertNull(
    boundary.sim?.fault ?? null,
    "one mote alone on the field gives the collision rule no pair, and nothing else can fault",
  );
  assertEqual(
    boundary.sim?.cycle,
    1,
    "one cycle of game time completes the cycle it covered",
  );
  const carried = moteById(boundary, mote);
  assertNotNull(carried, "the run still reports the mote it carried out");
  assertEqual(
    `${carried?.q},${carried?.r}`,
    `${OUTSIDE.q},${OUTSIDE.r}`,
    "the snapshot reports the off-field q and r the sweep carried the mote to",
  );
  assertNear(
    carried?.x ?? Number.NaN,
    hexCenter(OUTSIDE).x,
    DRAWN_TOLERANCE,
    "a mote off the field lands on its hex center like any other",
  );
  assertNear(
    carried?.y ?? Number.NaN,
    hexCenter(OUTSIDE).y,
    DRAWN_TOLERANCE,
    "a mote off the field lands on its hex center like any other",
  );
});
