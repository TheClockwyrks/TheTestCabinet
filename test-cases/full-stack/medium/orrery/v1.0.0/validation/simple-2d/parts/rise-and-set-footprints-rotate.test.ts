// parts/rise-and-set-footprints-rotate — a rise's or a set's footprint turns with
// the rotation it was placed at.
//
// THE RULE. "A rise or set is placed at an anchor and rotation like any sigil,
// and its footprint is its pattern's hexes placed at that pose" (`specs/parts.md`,
// Rises and sets), and `specs/field.md` fixes what placing a pattern at a pose
// means: "A pattern is placed onto the field at an anchor hex and a rotation `0`
// to `5`: each pattern coordinate is rotated about `(0, 0)` by the rotation,
// using the formulas above, then translated by the anchor." The formulas are
// `specs/field.md`'s own: "Clockwise: `(q, r) -> (-r, q + r)`."
//
// HOW A FOOTPRINT IS OBSERVED. The snapshot reports a rise's anchor and rotation,
// never the hexes it covers, so the footprint is read through placement rule 2:
// "Sigil footprints, rise and set footprints included, are pairwise disjoint, and
// no track cell lies on any of them" (`specs/parts.md`). A one-cell track offered
// on a hex the footprint claims is refused; one offered on a hex it does not
// claim is placed.
//
// THE CONFIGURATION. A challenge with TWO identical reagents, each three `dust`
// in a line on `(0, 0)`, `(1, 0)`, `(2, 0)`. Reagent `0`'s rise is placed at
// `(-1, -2)` at rotation `0`, so its arm of the line runs EAST; reagent `1`'s at
// `(1, 2)` at rotation `3`, three sixty-degree steps, which turns `(1, 0)` into
// `(-1, 0)` and so runs its arm WEST. Both stand on the field at once, far apart,
// which is why one picture shows the pair. The hexes read are each rise's own
// `(1, 0)` and `(-1, 0)` offsets: the unrotated rise claims the first and not the
// second, and the rotated one claims the second and not the first.
//
// THE VERDICT. The four readings come out as the rotation formula places them. A
// build that ignored a rise's rotation would claim `(1, 0)` under both.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { at, onField, place, type Hex } from "../field";
import { challenge, link, molecule, mote } from "../formats";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  partById,
  partIds,
  placeRise,
  type Harness,
} from "../harness";
import { riseFootprint } from "../parts";

/**
 * Whether the surface REFUSED a placement: "Each placement is checked against
 * the placement rules of `specs/parts.md` alone, and throws an `Error` naming
 * the first rule it breaks" (`specs/instrumentation.md`, The machine).
 */
async function refusesPlacement(
  place_: () => Promise<unknown>,
): Promise<boolean> {
  try {
    await place_();
    return false;
  } catch {
    return true;
  }
}

/** Three `dust` in a line east, joined: a pattern whose rotation is visible. */
const LINE = molecule(
  [mote(0, 0, "dust"), mote(1, 0, "dust"), mote(2, 0, "dust")],
  [link(at(0, 0), at(1, 0), 1), link(at(1, 0), at(2, 0), 1)],
);

/** A challenge carrying that line twice, so two rises stand at once. */
const TWO_LINES = challenge({
  name: "Two Lines",
  reagents: [LINE, LINE],
  products: [molecule([mote(0, 0, "dust")])],
  permitted: ["arm", "track"],
});

/** Where the unrotated rise stands, and where the rotated one does. */
const PLAIN_ANCHOR: Hex = at(-1, -2);
const TURNED_ANCHOR: Hex = at(1, 2);

/** The rotation the second rise is placed at: three sixty-degree steps. */
const TURN = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("places a rise's pattern rotated about (0, 0) and then translated by the anchor", async () => {
  await openChallengeDocument(h, TWO_LINES);
  const plain = await placeRise(h, 0, PLAIN_ANCHOR, 0);
  const turned = await placeRise(h, 1, TURNED_ANCHOR, TURN);

  await h.advance(1);
  await captureStill(h, "rotated");

  const snapshot = await h.snapshot();
  assertEqual(
    partById(snapshot, plain)?.rotation,
    0,
    "the first rise stands at rotation 0",
  );
  assertEqual(
    partById(snapshot, turned)?.rotation,
    TURN,
    "the second rise stands at rotation 3",
  );

  // What the rotation formula makes of the pattern's `(1, 0)` at each pose: east
  // for the unrotated rise, west for the rotated one.
  const plainClaims = place(at(1, 0), PLAIN_ANCHOR, 0);
  const plainFree = place(at(-1, 0), PLAIN_ANCHOR, 0);
  const turnedClaims = place(at(1, 0), TURNED_ANCHOR, TURN);
  const turnedFree = place(at(-1, 0), TURNED_ANCHOR, TURN);
  assertEqual(
    `${turnedClaims.q},${turnedClaims.r}`,
    `${TURNED_ANCHOR.q - 1},${TURNED_ANCHOR.r}`,
    "three clockwise steps carry the pattern's (1, 0) onto (-1, 0)",
  );
  for (const hex of [plainClaims, plainFree, turnedClaims, turnedFree]) {
    assertEqual(
      onField(hex),
      true,
      `the hex (${hex.q}, ${hex.r}) this check reads is on the field`,
    );
  }

  // The two footprints, as the rule computes them, are disjoint — so a refusal
  // at one rise's hex is that rise's own and not the other's.
  const plainHexes = riseFootprint(LINE, PLAIN_ANCHOR, 0);
  const turnedHexes = riseFootprint(LINE, TURNED_ANCHOR, TURN);
  assertEqual(
    plainHexes.filter((a) =>
      turnedHexes.some((b) => a.q === b.q && a.r === b.r),
    ).length,
    0,
    "the two rises' footprints share no hex, so each reading is one rise's",
  );

  let standing = 2;
  const readings: { hex: Hex; claimed: boolean; why: string }[] = [
    {
      hex: plainClaims,
      claimed: true,
      why: "the unrotated rise claims its pattern's (1, 0), which lies east",
    },
    {
      hex: plainFree,
      claimed: false,
      why: "the unrotated rise does not reach west of its anchor",
    },
    {
      hex: turnedClaims,
      claimed: true,
      why: "the rise at rotation 3 claims the hex its pattern's (1, 0) turns onto, which lies west",
    },
    {
      hex: turnedFree,
      claimed: false,
      why: "the rise at rotation 3 does not reach east of its anchor",
    },
  ];
  for (const reading of readings) {
    const refused = await refusesPlacement(() =>
      h.debug.placeTrack(reading.hex.q, reading.hex.r),
    );
    assertEqual(refused, reading.claimed, reading.why);
    if (!reading.claimed) standing += 1;
    assertEqual(
      (await partIds(h)).length,
      standing,
      `the machine holds ${standing} parts after the reading at (${reading.hex.q}, ${reading.hex.r})`,
    );
  }
});
