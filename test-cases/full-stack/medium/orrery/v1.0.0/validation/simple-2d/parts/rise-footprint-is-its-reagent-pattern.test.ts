// parts/rise-footprint-is-its-reagent-pattern — a rise occupies exactly its
// reagent's pattern, placed at its pose.
//
// THE RULE. "A rise or set is placed at an anchor and rotation like any sigil, and
// its footprint is its pattern's hexes placed at that pose: the molecule pattern
// for a rise" (`specs/parts.md`, Rises and sets). What "placed at that pose" means
// is `specs/field.md`, Molecule patterns: "A pattern is placed onto the field at
// an anchor hex and a rotation `0` to `5`: each pattern coordinate is rotated
// about `(0, 0)` by the rotation ... then translated by the anchor." So a
// three-mote reagent gives a three-hex footprint, on the three hexes its motes
// would land on.
//
// HOW A FOOTPRINT IS OBSERVED. Placement rule 2: "Sigil footprints, rise and set
// footprints included, are pairwise disjoint" (`specs/parts.md`). So a hex of the
// footprint refuses a second sigil and a hex outside it accepts one, and the
// refusal is stated: "Each placement is checked against the placement rules of
// `specs/parts.md` alone, and throws an `Error` naming the first rule it breaks"
// (`specs/instrumentation.md`). The probe is a `wane`, whose footprint is the
// single hex "`(0, 0)` — seat" (`specs/sigils.md`), so a refusal can only be about
// the one hex it was offered on.
//
// THE CONFIGURATION. A posed challenge whose one reagent is three `dust` in a
// line, `(0, 0)`, `(1, 0)`, `(2, 0)`, joined west to east. Its rise is placed at
// anchor `(-1, -1)` at rotation `0`, so its footprint is those three hexes
// translated by the anchor: `(-1, -1)`, `(0, -1)`, `(1, -1)`. A `wane` is then
// offered on each of the three, and on every hex ADJACENT to the footprint and off
// it — which is where a fourth claimed hex would have to be for the footprint to
// be a connected shape larger than the pattern.
//
// THE VERDICT. All three footprint hexes refuse the second sigil and add nothing
// to the machine; every hex around the footprint accepts one, which is removed
// again before the next probe. The footprint is the pattern's three hexes and
// nothing more.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import { at, neighbors, onField, sameHex, type Hex } from "../field";
import { challenge, type Challenge } from "../formats";
import { ONE_DUST, THREE_DUST_LINE } from "../fixtures";
import { riseFootprint } from "../parts";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  partIds,
  placeRise,
  type Harness,
} from "../harness";

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

/** A challenge whose one reagent is a three-mote line, so its rise is three hexes. */
const LINE_REAGENT: Challenge = challenge({
  name: "Line Reagent",
  reagents: [THREE_DUST_LINE],
  products: [ONE_DUST],
  permitted: ["arm"],
});

/** Where the rise stands. Rotation `0`, so the pose is the anchor's translation. */
const ANCHOR = at(-1, -1);
const ROTATION = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("claims its reagent's three hexes and no hex around them", async () => {
  const footprint = riseFootprint(THREE_DUST_LINE, ANCHOR, ROTATION);
  assertLength(
    footprint,
    THREE_DUST_LINE.motes.length,
    "a three-mote reagent gives a three-hex footprint: one hex per pattern mote",
  );

  await openChallengeDocument(h, LINE_REAGENT);
  const rise = await placeRise(h, 0, ANCHOR, ROTATION);

  await h.advance(1);
  await captureStill(h, "rise");

  assertEqual(
    (await partIds(h)).length,
    1,
    "the rise is on the machine, and it is the only part on it",
  );

  for (const hex of footprint) {
    const refused = await refusesPlacement(() =>
      h.debug.placePart("wane", hex.q, hex.r, 0),
    );
    assertTrue(
      refused,
      `(${hex.q}, ${hex.r}) is a footprint hex of the rise, so rule 2 refuses a sigil on it`,
    );
    assertEqual(
      (await partIds(h)).length,
      1,
      `the refused sigil on (${hex.q}, ${hex.r}) added no part`,
    );
  }

  // Every hex touching the footprint and off it takes a sigil, so no fourth hex
  // is claimed anywhere around the three.
  const around: Hex[] = [];
  for (const hex of footprint) {
    for (const near of neighbors(hex)) {
      const claimed = footprint.some((own) => sameHex(own, near));
      const already = around.some((seen) => sameHex(seen, near));
      if (!claimed && !already && onField(near)) around.push(near);
    }
  }
  assertTrue(
    around.length > 0,
    "the footprint has hexes around it on the field to probe",
  );
  for (const hex of around) {
    const refused = await refusesPlacement(() =>
      h.debug.placePart("wane", hex.q, hex.r, 0),
    );
    assertEqual(
      refused,
      false,
      `(${hex.q}, ${hex.r}) is not one of the reagent pattern's hexes, so the rise does not claim it`,
    );
    const ids = await partIds(h);
    assertEqual(ids.length, 2, `the sigil on (${hex.q}, ${hex.r}) was placed`);
    await h.debug.removePart(ids[1] ?? -1);
  }

  assertEqual(
    (await partIds(h)).length,
    1,
    "the machine is back to the rise alone, so every probe was cleaned up after",
  );
  assertEqual(rise, (await partIds(h))[0], "the rise is the part that remains");
});
