// field/hex-centers-hold-across-the-whole-field — the formulas hold out to the
// field's edge, with nothing clamped or wrapped.
//
// THE RULE. "The center of hex `(q, r)` on the stage is: `hexX(q, r) = FIELD_CX +
// HEX_PITCH * (q + r / 2)`; `hexY(q, r) = FIELD_CY + HEX_PITCH * (sqrt(3) / 2) *
// r`", and "the field is the hexagonal region of radius `FIELD_R` around
// `(0, 0)`: hex `(q, r)` is on the field exactly when
// `max(|q|, |r|, |q + r|) <= FIELD_R`. That is `91` hexes, spanning stage `x`
// `376` to `856` and `y` `96.15` to `511.85` from center to center"
// (`specs/field.md`, Hexes and axial coordinates). The two formulas are stated
// once, for every hex; the outer ring is where a build that clamped a coordinate,
// wrapped one, or laid the field out row by row from a running total would first
// disagree with them.
//
// THE CONFIGURATION. The thirty hexes with `max(|q|, |r|, |q + r|)` exactly
// `FIELD_R` (`5`) — the outermost ring of a radius-`5` hexagonal field, which is
// `6 * FIELD_R` hexes — each carrying one mote at rest. Those thirty are exactly
// the hexes that reach the extents the specification quotes: `x` `376` and `856`,
// `y` `96.15` and `511.85`.
//
// WHAT IS READ. A mote's `x`, `y` is "the drawn position at the current fraction"
// (`specs/instrumentation.md`); "at rest a mote sits exactly on a hex center"
// (`specs/field.md`) and "a mote held by nothing rests on its hex for the whole
// cycle" (`specs/simulation.md`), so each of the thirty reports the center the
// formulas compute for its own hex.
//
// THE WORLD IS POSED, NOT SEARCHED. The bare opener empties the field and the
// machine; the thirty motes are the whole of the world, and nothing is on the
// field that could impose a motion on any of them.
//
// WHY NOT BIT FOR BIT. A build may fold `HEX_PITCH` and `sqrt(3) / 2` in whatever
// order it likes, so two conformant evaluations of one center may differ in a
// double's last place. Every stage position here is read to within a millionth of
// a logical unit, finer than any distinction `specs/` draws.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertLength,
  assertNotNull,
} from "../assert";
import { FIELD_R } from "../constants";
import { fieldHexes, hexCenter, type Hex } from "../field";
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

/** The ring of hexes at exactly `FIELD_R` from the origin, in reading order. */
function outerRing(): Hex[] {
  return fieldHexes().filter(
    (hex) =>
      Math.max(Math.abs(hex.q), Math.abs(hex.r), Math.abs(hex.q + hex.r)) ===
      FIELD_R,
  );
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports every outer-ring hex at the center hexX and hexY compute for it", async () => {
  const ring = outerRing();
  assertLength(
    ring,
    6 * FIELD_R,
    "the outer ring of a radius-FIELD_R hexagonal field holds 6 * FIELD_R hexes",
  );

  await openBareRun(h, { challenge: BARE });
  const ids: number[] = [];
  for (const hex of ring) ids.push(await spawnMote(h, hex, "dust"));

  await h.advance(1);
  await captureStill(h, "all-hexes");

  const snapshot = await h.snapshot();
  assertLength(
    snapshot.sim?.motes ?? [],
    ring.length,
    "the field holds one mote per outer-ring hex and nothing else",
  );

  for (const [i, hex] of ring.entries()) {
    const where = `(${hex.q}, ${hex.r})`;
    const center = hexCenter(hex);
    const resting = moteById(snapshot, ids[i] as number);
    assertNotNull(resting, `the mote resting on ${where} is reported`);
    assertEqual(
      resting?.q,
      hex.q,
      `${where}: the mote rests on the hex it was spawned on, q`,
    );
    assertEqual(
      resting?.r,
      hex.r,
      `${where}: the mote rests on the hex it was spawned on, r`,
    );
    assertCloseTo(
      resting?.x ?? Number.NaN,
      center.x,
      6,
      `${where}: hexX(q, r) = FIELD_CX + HEX_PITCH * (q + r / 2)`,
    );
    assertCloseTo(
      resting?.y ?? Number.NaN,
      center.y,
      6,
      `${where}: hexY(q, r) = FIELD_CY + HEX_PITCH * (sqrt(3) / 2) * r`,
    );
  }
});
