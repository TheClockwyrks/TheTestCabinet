// parts/a-footprint-may-not-cover-a-track-cell — rule 2 holds in the other order:
// a footprint may not be placed over a hex a track already holds.
//
// THE RULE. Placement rule 2: "Sigil footprints, rise and set footprints
// included, are pairwise disjoint, and no track cell lies on any of them"
// (`specs/parts.md`, Placement rules). The rule is a relation between a track's
// cells and the footprints, so it refuses the footprint laid over a cell exactly
// as it refuses the cell laid over a footprint. The surface "throws an `Error`
// naming the first rule it breaks" (`specs/instrumentation.md`).
//
// THE CONFIGURATION. An empty machine on a posed challenge, with no run live. One
// open track is laid on `(0, 0)`, `(1, 0)`, `(2, 0)`. Four placements are then
// offered against it: a `wane`, whose footprint is the single hex `(0, 0)`; a
// `bind` at `(2, 0)`, whose FIRST hex falls on the track's last cell; the
// challenge's rise on `(1, 0)`; and its set on `(2, 0)`. A `bind` at `(3, 0)`,
// whose two hexes `(3, 0)` and `(4, 0)` the track does not reach, is the control.
// Every hex named is on the field and no two footprints offered ever stand at
// once, so nothing but rule 2 is in play.
//
// THE VERDICT. The four offers over a cell are refused and add no part; the one
// clear of the path is placed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { at, onField, sameHex, type Hex } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  partById,
  partIds,
  placeTrack,
  type Harness,
} from "../harness";
import { sigilHexes } from "../parts";

/**
 * Whether the surface REFUSED a placement: "Each placement is checked against
 * the placement rules of `specs/parts.md` alone, and throws an `Error` naming
 * the first rule it breaks" (`specs/instrumentation.md`, The machine).
 */
async function refusesPlacement(
  place: () => Promise<unknown>,
): Promise<boolean> {
  try {
    await place();
    return false;
  } catch {
    return true;
  }
}

/** The path laid, and the anchors offered over it and clear of it. */
const PATH: readonly Hex[] = [at(0, 0), at(1, 0), at(2, 0)];
const OVER_FIRST: Hex = at(0, 0);
const OVER_LAST: Hex = at(2, 0);
const OVER_MIDDLE: Hex = at(1, 0);
const CLEAR: Hex = at(3, 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses a sigil, a rise or a set whose footprint covers a track cell", async () => {
  await openChallengeDocument(h, BARE);

  // The geometry the check claims to be posing.
  for (const hex of [...PATH, CLEAR]) {
    assertEqual(
      onField(hex),
      true,
      `the hex (${hex.q}, ${hex.r}) is on the field`,
    );
  }
  assertEqual(
    sigilHexes("bind", CLEAR, 0).filter((hex) =>
      PATH.some((cell) => sameHex(cell, hex)),
    ).length,
    0,
    "the control sigil's two hexes lie clear of every cell of the path",
  );
  assertEqual(
    sigilHexes("bind", OVER_LAST, 0).filter((hex) =>
      PATH.some((cell) => sameHex(cell, hex)),
    ).length,
    1,
    "the sigil offered at (2, 0) covers the path's last cell with its first hex",
  );

  const track = await placeTrack(h, PATH);

  const waneOverCell = await refusesPlacement(() =>
    h.debug.placePart("wane", OVER_FIRST.q, OVER_FIRST.r, 0),
  );
  const bindOverCell = await refusesPlacement(() =>
    h.debug.placePart("bind", OVER_LAST.q, OVER_LAST.r, 0),
  );
  const riseOverCell = await refusesPlacement(() =>
    h.debug.placeRise(0, OVER_MIDDLE.q, OVER_MIDDLE.r, 0),
  );
  const setOverCell = await refusesPlacement(() =>
    h.debug.placeSet(0, OVER_LAST.q, OVER_LAST.r, 0),
  );
  const afterRefusals = (await partIds(h)).length;
  const bindClear = await refusesPlacement(() =>
    h.debug.placePart("bind", CLEAR.q, CLEAR.r, 0),
  );

  await h.advance(1);
  await captureStill(h, "refused");

  assertEqual(
    waneOverCell,
    true,
    "a wane whose seat is a track cell is refused",
  );
  assertEqual(
    bindOverCell,
    true,
    "a bind whose first hex is a track cell is refused",
  );
  assertEqual(
    riseOverCell,
    true,
    "a rise whose footprint covers a track cell is refused",
  );
  assertEqual(
    setOverCell,
    true,
    "a set whose footprint covers a track cell is refused",
  );
  assertEqual(
    afterRefusals,
    1,
    "not one of the four refused placements added a part: the track stands alone",
  );
  assertEqual(
    bindClear,
    false,
    "a sigil clear of every cell of the path is placed",
  );

  const snapshot = await h.snapshot();
  assertEqual(
    (partById(snapshot, track)?.cells ?? []).length,
    PATH.length,
    "the track still holds the three cells it was laid as",
  );
  assertEqual(
    (await partIds(h)).length,
    2,
    "the machine holds the track and the one accepted sigil",
  );
});
