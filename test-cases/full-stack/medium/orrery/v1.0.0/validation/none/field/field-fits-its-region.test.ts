// field/field-fits-its-region — the field and its motes stay inside the field
// region.
//
// THE RULE. `specs/editor.md` gives the editor's five regions fixed extents, and
// the field's is "`x` `TRAY_REGION_W` (`224`) to `READOUT_X0` (`1008`), `y`
// `HEADING_H` (`48`) to `TAPE_Y0` (`560`)", holding "the hex field of
// `specs/field.md`, drawn at its fixed geometry". The other four regions hold the
// heading, the tray, the readout and the tape panel, and "every extent above ...
// includes its lower bound and excludes its upper". The field's geometry is
// fixed rather than fitted — `specs/field.md` spans it "stage `x` `376` to `856`
// and `y` `96.15` to `511.85` from center to center", and "every mote's drawn
// form fits inside `MOTE_R` (`22`) of its position" — so the field with a mote on
// every one of its outermost hexes is inside the field's region and nowhere else.
//
// THE CONFIGURATION. A live run over an empty machine, PAUSED so no boundary and
// no fraction can move anything between the two frames, and the field emptied.
// One frame is drawn bare; then a mote goes onto each of the thirty hexes of the
// outer ring — `max(|q|, |r|, |q + r|)` exactly `FIELD_R` (`5`), the hexes that
// reach the extents above — and a second frame is drawn.
//
// THE VERDICT is read as a difference between those two frames, over the four
// regions that are NOT the field's: `specs/editor.md`'s heading, tray, readout
// and tape panel tile the whole of the stage the field's region does not cover.
// Not one pixel of any of them moved, which is the layout rule stated whole:
// "Each region draws from its own contents alone: what a region holds is drawn
// inside that region's extent and nowhere else on the stage. The motes on the
// field are the field's — no other region draws one or counts what rests there."
// So thirty motes arriving on the field change the field's region and nothing
// beside it — not the readout, which counts nothing that rests there either.
//
// AND THE MOTES WERE REALLY THERE. A build that drew no mote at all would move no
// pixel anywhere, so the same difference is read the other way round inside the
// field: within `MOTE_R` of each of the thirty positions, something changed.
// Nothing here says WHAT was drawn — that is the presentation's own point — only
// that each mote is drawn, and drawn where the region rule needs it to be.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import { FIELD_R, MOTE_R } from "../constants";
import {
  fieldHexes,
  hexCenter,
  HEADING_REGION,
  READOUT_REGION,
  TAPE_REGION,
  TRAY_REGION,
  type Hex,
  type Region,
} from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  openBareRun,
  pixelsDiffering,
  spawnMote,
  type Harness,
  type PixelRect,
} from "../harness";

let h: Harness;

/** The four regions of `specs/editor.md` that are not the field's. */
const ELSEWHERE: readonly { name: string; region: Region }[] = [
  { name: "the heading", region: HEADING_REGION },
  { name: "the tray", region: TRAY_REGION },
  { name: "the readout", region: READOUT_REGION },
  { name: "the tape panel", region: TAPE_REGION },
];

/** The ring of hexes at exactly `FIELD_R` from the origin, in reading order. */
function outerRing(): Hex[] {
  return fieldHexes().filter(
    (hex) =>
      Math.max(Math.abs(hex.q), Math.abs(hex.r), Math.abs(hex.q + hex.r)) ===
      FIELD_R,
  );
}

/** The square of side `2 * MOTE_R` a mote's drawn form must fit inside. */
function moteBox(hex: Hex): Region {
  const center = hexCenter(hex);
  return {
    x: center.x - MOTE_R,
    y: center.y - MOTE_R,
    w: 2 * MOTE_R,
    h: 2 * MOTE_R,
  };
}

function read(region: Region): Promise<PixelRect> {
  return h.pixelRect(region.x, region.y, region.w, region.h);
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a mote on every outermost hex without touching the other four regions", async () => {
  await openBareRun(h, { challenge: BARE, paused: true });
  await h.advance(1);

  const ring = outerRing();
  assertLength(
    ring,
    6 * FIELD_R,
    "the outer ring of a radius-FIELD_R hexagonal field holds 6 * FIELD_R hexes",
  );

  const bareElsewhere: PixelRect[] = [];
  for (const { region } of ELSEWHERE) bareElsewhere.push(await read(region));
  const bareMotes: PixelRect[] = [];
  for (const hex of ring) bareMotes.push(await read(moteBox(hex)));

  for (const hex of ring) await spawnMote(h, hex, "dust");
  await h.advance(1);
  await captureStill(h, "extent");

  const snapshot = await h.snapshot();
  assertLength(
    snapshot.sim?.motes ?? [],
    ring.length,
    "the field holds one mote per outer-ring hex and nothing else",
  );

  for (const [i, hex] of ring.entries()) {
    const drawn = await read(moteBox(hex));
    assertGreaterThan(
      pixelsDiffering(bareMotes[i] as PixelRect, drawn),
      0,
      `(${hex.q}, ${hex.r}): the mote resting there is drawn within MOTE_R of its position`,
    );
  }

  for (const [i, { name, region }] of ELSEWHERE.entries()) {
    const after = await read(region);
    assertEqual(
      pixelsDiffering(bareElsewhere[i] as PixelRect, after),
      0,
      `${name} (x ${region.x} to ${region.x + region.w}, y ${region.y} to ${region.y + region.h}) is untouched by the motes on the field`,
    );
  }
});
