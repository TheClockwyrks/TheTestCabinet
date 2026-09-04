// parts/void-rim-is-part-of-its-footprint — a `void`'s rim is footprint for the
// placement rules, even though the rim consumes nothing.
//
// THE RULE. `specs/sigils.md`, The void, gives `void` seven hexes: "`(0, 0)` —
// maw" and "all six neighbors of `(0, 0)` — rim", and then says what the rim is
// for: "The maw is the only hex that consumes; the rim takes part in the
// placement rules of `specs/parts.md` alone." Placement rule 2 is the rule it
// takes part in: "Sigil footprints, rise and set footprints included, are
// pairwise disjoint" (`specs/parts.md`, Placement rules). The refusal itself is
// `specs/instrumentation.md`, The machine: "Each placement is checked against the
// placement rules of `specs/parts.md` alone, and throws an `Error` naming the
// first rule it breaks."
//
// THE CONFIGURATION. One `void` at `(0, 0)`, so its maw is `(0, 0)` and its rim
// is the six neighbors, `(1, 0)` among them. Then a `wane` — the one-hex sigil,
// "`(0, 0)` — seat", chosen so the offered footprint is a single hex and nothing
// but that hex can be what a refusal is about — is offered twice: once on the rim
// hex `(1, 0)`, and once on `(2, 0)`, which is one step further out and so on no
// hex of the void at all.
//
// THE VERDICT. The rim placement is refused and adds no part; the placement one
// hex beyond the rim is accepted. The control half is what makes the refusal mean
// "the rim is footprint" rather than a surface that refuses a second sigil
// anywhere near a void.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual, assertLength } from "../assert";
import { at } from "../field";
import { BARE } from "../fixtures";
import { sigilHexes } from "../parts";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  partById,
  partIds,
  placePart,
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

/** Where the void stands, and the two hexes the second sigil is offered on. */
const VOID_ANCHOR = at(0, 0);
const ON_THE_RIM = at(1, 0);
const BEYOND_THE_RIM = at(2, 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses a sigil on a void's rim hex and accepts one a step beyond it", async () => {
  await openChallengeDocument(h, BARE);

  const maw = await placePart(h, "void", VOID_ANCHOR, 0);

  // The geometry the check claims to be posing, read off `specs/sigils.md`'s own
  // footprint: the rim hex is one of the void's seven, and the control hex is not.
  const footprint = sigilHexes("void", VOID_ANCHOR, 0).map(
    (hex) => `${hex.q},${hex.r}`,
  );
  assertLength(
    footprint,
    7,
    "a void's footprint is the maw at (0, 0) together with all six neighbors",
  );
  assertContains(
    footprint,
    `${ON_THE_RIM.q},${ON_THE_RIM.r}`,
    "the hex the refused sigil is offered on is a rim hex of the placed void",
  );
  assertEqual(
    footprint.includes(`${BEYOND_THE_RIM.q},${BEYOND_THE_RIM.r}`),
    false,
    "the hex the control sigil is offered on lies outside the void altogether",
  );

  const onRim = await refusesPlacement(() =>
    h.debug.placePart("wane", ON_THE_RIM.q, ON_THE_RIM.r, 0),
  );
  const afterRim = (await partIds(h)).length;

  let beyond = -1;
  const offRim = await refusesPlacement(async () => {
    beyond = await placePart(h, "wane", BEYOND_THE_RIM, 0);
  });

  await h.advance(1);
  await captureStill(h, "rim");

  assertEqual(
    onRim,
    true,
    `a wane on the rim hex (${ON_THE_RIM.q}, ${ON_THE_RIM.r}) is refused: the rim is part of the void's footprint, and rule 2 keeps footprints pairwise disjoint`,
  );
  assertEqual(
    afterRim,
    1,
    "the refused sigil added no part: the machine still holds the void alone",
  );
  assertEqual(
    offRim,
    false,
    `a wane on (${BEYOND_THE_RIM.q}, ${BEYOND_THE_RIM.r}), one hex past the rim, is placed`,
  );

  const snapshot = await h.snapshot();
  assertEqual(
    partById(snapshot, maw)?.kind,
    "void",
    "the void is still on the field, unchanged by the refusal",
  );
  assertEqual(
    partById(snapshot, beyond)?.kind,
    "wane",
    "the accepted sigil stands a hex beyond the rim",
  );
  assertEqual(
    snapshot.editor.parts.length,
    2,
    "the machine holds the void and the accepted sigil, and not the refused one",
  );
});
