// field/hex-origin-at-field-center — hex (0, 0) sits at the field's center.
//
// THE RULE. "The center of hex `(q, r)` on the stage is: `hexX(q, r) = FIELD_CX +
// HEX_PITCH * (q + r / 2)`; `hexY(q, r) = FIELD_CY + HEX_PITCH * (sqrt(3) / 2) *
// r`" (`specs/field.md`, Hexes and axial coordinates), where the table names
// `FIELD_CX` (`616`) "Stage `x` of hex `(0, 0)`" and `FIELD_CY` (`304`) "Stage
// `y` of hex `(0, 0)`". At `(0, 0)` both formulas collapse onto the constant, so
// the whole field is anchored exactly where the pair of formulas anchors it.
//
// WHAT IS READ. A mote's `x`, `y` is "the drawn position at the current fraction"
// (`specs/instrumentation.md`), derived from "its hex, its motion, and
// `sim.fraction`, by the formulas of `specs/field.md` and `specs/simulation.md`".
// "At rest a mote sits exactly on a hex center" (`specs/field.md`), and "a mote
// held by nothing rests on its hex for the whole cycle"
// (`specs/simulation.md`) — so one unheld mote, with no part on the field that
// could impose a motion on it, reports the anchor itself whatever the fraction.
//
// THE WORLD IS POSED, NOT SEARCHED. The bare opener resets, poses a challenge,
// clears the machine, holds completion off, starts the run and empties the field;
// what goes back on is one mote and nothing else, so the reading cannot be some
// other mote's, and the machine is empty, so nothing carries it.
//
// WHY NOT BIT FOR BIT. `hexY` carries the irrational factor `sqrt(3) / 2`, and a
// build is free to fold the constants in whichever order it likes, so the two
// evaluations may differ in the last place of a double. Every stage position here
// is read to within a millionth of a logical unit, which is finer than any
// distinction `specs/` draws and far coarser than that drift.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertLength,
  assertNotNull,
} from "../assert";
import { FIELD_CX, FIELD_CY } from "../constants";
import { hexCenter } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  moteById,
  openBareRun,
  spawnMote,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports a mote resting on (0, 0) at (FIELD_CX, FIELD_CY)", async () => {
  await openBareRun(h, { challenge: BARE });
  const mote = await spawnMote(h, ORIGIN, "dust");

  await h.advance(1);
  await captureStill(h, "origin");

  const snapshot = await h.snapshot();
  assertLength(
    snapshot.sim?.motes ?? [],
    1,
    "the bare opener emptied the field, so the one mote spawned back is the whole of it",
  );

  const resting = moteById(snapshot, mote);
  assertNotNull(resting, "the mote spawned on (0, 0) is reported in sim.motes");
  assertEqual(resting?.q, ORIGIN.q, "the mote rests on hex (0, 0): q");
  assertEqual(resting?.r, ORIGIN.r, "the mote rests on hex (0, 0): r");

  const anchor = hexCenter(ORIGIN);
  assertCloseTo(
    anchor.x,
    FIELD_CX,
    6,
    "hexX(0, 0) is FIELD_CX + HEX_PITCH * (0 + 0 / 2), which is FIELD_CX",
  );
  assertCloseTo(
    anchor.y,
    FIELD_CY,
    6,
    "hexY(0, 0) is FIELD_CY + HEX_PITCH * (sqrt(3) / 2) * 0, which is FIELD_CY",
  );
  assertCloseTo(
    resting?.x ?? Number.NaN,
    FIELD_CX,
    6,
    "a mote at rest on (0, 0) is drawn at the stage x FIELD_CX",
  );
  assertCloseTo(
    resting?.y ?? Number.NaN,
    FIELD_CY,
    6,
    "a mote at rest on (0, 0) is drawn at the stage y FIELD_CY",
  );
});
