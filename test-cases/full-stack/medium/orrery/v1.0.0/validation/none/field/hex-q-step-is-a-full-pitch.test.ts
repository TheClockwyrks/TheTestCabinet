// field/hex-q-step-is-a-full-pitch — one step of q is one whole pitch in x, and
// nothing in y.
//
// THE RULE. "`hexX(q, r) = FIELD_CX + HEX_PITCH * (q + r / 2)`" and
// "`hexY(q, r) = FIELD_CY + HEX_PITCH * (sqrt(3) / 2) * r`" (`specs/field.md`,
// Hexes and axial coordinates). `q` appears once, with coefficient `HEX_PITCH`,
// in `hexX` alone: stepping `q` by one moves a hex center exactly `HEX_PITCH`
// (`48`) in `x` and leaves `y` where it was. `HEX_PITCH` is the table's "Distance
// between adjacent hex centers", and `(+1, 0)` is `DIRS[0]`, "East".
//
// WHAT IS READ. A mote's `x`, `y` is "the drawn position at the current fraction"
// (`specs/instrumentation.md`); "at rest a mote sits exactly on a hex center"
// (`specs/field.md`) and "a mote held by nothing rests on its hex for the whole
// cycle" (`specs/simulation.md`), so a field of unheld motes over an empty
// machine reports the centers themselves.
//
// THE CONFIGURATION. Two whole rows of the field, `r = 0` and `r = -3`, each
// filled hex by hex in ascending `q`. Two rows rather than one because the claim
// is about a step of `q` at any `r`: a build that folded `r` into `hexX`'s `q`
// term would keep one row's spacing and lose the other's. Only the pairs
// `(q, r)`, `(q + 1, r)` are read; the relation between the two rows is
// `hex-r-step-shifts-half-a-pitch-in-x`'s point, not this one.
//
// THE WORLD IS POSED, NOT SEARCHED. The bare opener empties the field and the
// machine, so every mote read back is one this check put down and nothing on the
// field can impose a motion on any of them.
//
// WHY NOT BIT FOR BIT. A build may fold `HEX_PITCH` and `sqrt(3) / 2` in whatever
// order it likes, so two conformant evaluations of one center may differ in a
// double's last place. Every stage position here is read to within a millionth of
// a logical unit, finer than any distinction `specs/` draws.

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

/** Every field hex of row `r`, in ascending `q`. */
function row(r: number): Hex[] {
  const hexes: Hex[] = [];
  for (let q = -10; q <= 10; q += 1)
    if (onField(at(q, r))) hexes.push(at(q, r));
  return hexes;
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts (q + 1, r) exactly HEX_PITCH east of (q, r), at the same y", async () => {
  await openBareRun(h, { challenge: BARE });

  const rows: { hexes: Hex[]; ids: number[] }[] = [];
  for (const r of [0, -3]) {
    const hexes = row(r);
    const ids: number[] = [];
    for (const hex of hexes) ids.push(await spawnMote(h, hex, "dust"));
    rows.push({ hexes, ids });
  }

  await h.advance(1);
  await captureStill(h, "q-row");

  const snapshot = await h.snapshot();
  assertLength(
    snapshot.sim?.motes ?? [],
    rows.reduce((total, entry) => total + entry.ids.length, 0),
    "the field holds exactly the two rows this check laid down",
  );

  for (const { hexes, ids } of rows) {
    for (let i = 0; i + 1 < hexes.length; i += 1) {
      const west = hexes[i] as Hex;
      const east = hexes[i + 1] as Hex;
      const where = `(${west.q}, ${west.r}) to (${east.q}, ${east.r})`;
      const a = moteById(snapshot, ids[i] as number);
      const b = moteById(snapshot, ids[i + 1] as number);
      assertNotNull(
        a,
        `the mote resting on (${west.q}, ${west.r}) is reported`,
      );
      assertNotNull(
        b,
        `the mote resting on (${east.q}, ${east.r}) is reported`,
      );
      assertCloseTo(
        (b?.x ?? Number.NaN) - (a?.x ?? Number.NaN),
        HEX_PITCH,
        6,
        `${where}: one step of q adds HEX_PITCH to hexX`,
      );
      assertCloseTo(
        (b?.y ?? Number.NaN) - (a?.y ?? Number.NaN),
        0,
        6,
        `${where}: hexY reads r alone, so a step of q leaves y where it was`,
      );
    }
  }
});
