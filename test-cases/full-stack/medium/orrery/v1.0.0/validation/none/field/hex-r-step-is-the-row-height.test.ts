// field/hex-r-step-is-the-row-height — one step of r is one pointy-top row height.
//
// THE RULE. "`hexY(q, r) = FIELD_CY + HEX_PITCH * (sqrt(3) / 2) * r`"
// (`specs/field.md`, Hexes and axial coordinates). `r` enters `hexY` with the
// coefficient `HEX_PITCH * sqrt(3) / 2` (`41.57`), which is the row height of a
// pointy-top grid of pitch `HEX_PITCH` (`48`): stepping `r` by one moves a hex
// center exactly that far south. `q` does not appear on `hexY`'s right-hand side
// at all, so the row height is the same in every column.
//
// WHAT IS READ. A mote's `x`, `y` is "the drawn position at the current fraction"
// (`specs/instrumentation.md`); "at rest a mote sits exactly on a hex center"
// (`specs/field.md`) and "a mote held by nothing rests on its hex for the whole
// cycle" (`specs/simulation.md`), so unheld motes over an empty machine report
// the centers themselves. How far a step of `r` shifts a center in `x` is
// `hex-r-step-shifts-half-a-pitch-in-x`'s point; this check reads `y` alone.
//
// THE CONFIGURATION. Two whole columns of the field, `q = 0` and `q = 2`, each
// filled hex by hex in ascending `r`. Two columns because `hexY` names `q` in its
// signature and uses it nowhere: a build that let `q` reach the row height would
// keep one column's spacing and lose the other's.
//
// THE WORLD IS POSED, NOT SEARCHED. The bare opener empties the field and the
// machine, so every mote read back is one this check put down and nothing on the
// field can impose a motion on any of them.
//
// WHY NOT BIT FOR BIT. `sqrt(3) / 2` is irrational and a build may fold it into
// `HEX_PITCH` and into `r` in whichever order it likes, so two conformant
// evaluations of one center differ in a double's last place. Every stage position
// here is read to within a millionth of a logical unit, finer than any
// distinction `specs/` draws and far coarser than that drift.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertLength, assertNotNull } from "../assert";
import { HEX_PITCH } from "../constants";
import { at, onField, type Hex } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  moteById,
  openBareRun,
  spawnMote,
  type Harness,
} from "../harness";

let h: Harness;

/** The pointy-top row height `specs/field.md` gives `r` in `hexY`. */
const ROW_HEIGHT = HEX_PITCH * (Math.sqrt(3) / 2);

/** Every field hex of column `q`, in ascending `r`. */
function column(q: number): Hex[] {
  const hexes: Hex[] = [];
  for (let r = -10; r <= 10; r += 1)
    if (onField(at(q, r))) hexes.push(at(q, r));
  return hexes;
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts (q, r + 1) exactly one row height south of (q, r)", async () => {
  await openBareRun(h, { challenge: BARE });

  const columns: { hexes: Hex[]; ids: number[] }[] = [];
  for (const q of [0, 2]) {
    const hexes = column(q);
    const ids: number[] = [];
    for (const hex of hexes) ids.push(await spawnMote(h, hex, "dust"));
    columns.push({ hexes, ids });
  }

  await h.advance(1);
  await captureStill(h, "rows");

  const snapshot = await h.snapshot();
  assertLength(
    snapshot.sim?.motes ?? [],
    columns.reduce((total, entry) => total + entry.ids.length, 0),
    "the field holds exactly the two columns this check laid down",
  );

  for (const { hexes, ids } of columns) {
    for (let i = 0; i + 1 < hexes.length; i += 1) {
      const north = hexes[i] as Hex;
      const south = hexes[i + 1] as Hex;
      const where = `(${north.q}, ${north.r}) to (${south.q}, ${south.r})`;
      const a = moteById(snapshot, ids[i] as number);
      const b = moteById(snapshot, ids[i + 1] as number);
      assertNotNull(
        a,
        `the mote resting on (${north.q}, ${north.r}) is reported`,
      );
      assertNotNull(
        b,
        `the mote resting on (${south.q}, ${south.r}) is reported`,
      );
      assertCloseTo(
        (b?.y ?? Number.NaN) - (a?.y ?? Number.NaN),
        ROW_HEIGHT,
        6,
        `${where}: one step of r adds HEX_PITCH * sqrt(3) / 2 to hexY`,
      );
    }
  }
});
