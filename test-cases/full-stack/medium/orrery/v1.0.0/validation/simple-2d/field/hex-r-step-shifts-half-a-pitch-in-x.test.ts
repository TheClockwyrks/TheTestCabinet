// field/hex-r-step-shifts-half-a-pitch-in-x — the rows shear rather than stacking
// square.
//
// THE RULE. "`hexX(q, r) = FIELD_CX + HEX_PITCH * (q + r / 2)`" (`specs/field.md`,
// Hexes and axial coordinates). `r` enters `hexX` halved, so stepping `r` by one
// moves a hex center exactly `HEX_PITCH / 2` (`24`) further east: successive rows
// of the field are offset by half a pitch rather than sitting one above the other.
// `specs/field.md` describes the same field as "a grid of pointy-top hexes", and
// `DIRS[1]`, `(0, +1)`, is "Southeast" — south AND east, which is that shear.
//
// WHAT IS READ. A mote's `x`, `y` is "the drawn position at the current fraction"
// (`specs/instrumentation.md`); "at rest a mote sits exactly on a hex center"
// (`specs/field.md`) and "a mote held by nothing rests on its hex for the whole
// cycle" (`specs/simulation.md`), so unheld motes over an empty machine report
// the centers themselves. How far a step of `r` moves a center in `y` is
// `hex-r-step-is-the-row-height`'s point; this check reads `x` alone.
//
// THE CONFIGURATION. Two whole columns of the field, `q = 0` and `q = 2`, each
// filled hex by hex in ascending `r`. Two columns because the claim is about a
// step of `r` at any `q`: the half-pitch is `r`'s own contribution, and it is the
// same at every `q`.
//
// THE WORLD IS POSED, NOT SEARCHED. The bare opener empties the field and the
// machine, so every mote read back is one this check put down and nothing on the
// field can impose a motion on any of them.
//
// WHY NOT BIT FOR BIT. A build may fold the constants in whatever order it likes,
// so two conformant evaluations of one center may differ in a double's last
// place. Every stage position here is read to within a millionth of a logical
// unit, finer than any distinction `specs/` draws.

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

it("puts (q, r + 1) exactly HEX_PITCH / 2 east of (q, r)", async () => {
  await openBareRun(h, { challenge: BARE });

  const columns: { hexes: Hex[]; ids: number[] }[] = [];
  for (const q of [0, 2]) {
    const hexes = column(q);
    const ids: number[] = [];
    for (const hex of hexes) ids.push(await spawnMote(h, hex, "dust"));
    columns.push({ hexes, ids });
  }

  await h.advance(1);
  await captureStill(h, "shear");

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
        (b?.x ?? Number.NaN) - (a?.x ?? Number.NaN),
        HEX_PITCH / 2,
        6,
        `${where}: hexX adds HEX_PITCH * r / 2, so one step of r shifts half a pitch east`,
      );
    }
  }
});
