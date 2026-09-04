// parts/anchors-are-unique — no two arms or wheels share an anchor hex, in every
// pairing of the six anchored mechanism kinds.
//
// THE RULE. Placement rule 4: "No two arms or wheels share an anchor hex ... An
// arm or wheel's anchor may sit on any sigil footprint hex, a rise's and a set's
// included, or on a track cell; sitting on a track cell is what mounts it"
// (`specs/parts.md`, Placement rules). The kinds it speaks of are the anchored
// mechanisms of the roster: `arm`, `biarm`, `triarm`, `hexarm`, `piston` — "one
// anatomy: a base fixed on the anchor hex" — and `wheel`, "a hub on its anchor
// hex" (`specs/parts.md`). The surface "throws an `Error` naming the first rule
// it breaks" (`specs/instrumentation.md`).
//
// THE CONFIGURATION. An empty machine on a posed challenge, with no run live. The
// pairing is swept: for each ORDERED pair of the six kinds, the machine is
// emptied, the first kind is anchored on `(0, 0)`, and the second is offered on
// `(0, 0)` and then on `(3, 0)`. Thirty-six pairings, each posed alone, because
// the rule is stated over arms and wheels rather than over one kind and a build
// may hold the six in different places. Both hexes are on the field and neither
// part carries a footprint or a cell.
//
// WHY THE FREE ANCHOR IS THREE HEXES OFF. The same rule carries a second clause:
// "no two wheels' rings meet: no hex is adjacent to the anchors of two wheels".
// A wheel's ring reaches one hex out, so two wheels anchored one or two hexes
// apart share a ring hex and the second is refused for THAT clause rather than
// for the shared anchor this point is about. Three hexes leaves no hex adjacent
// to both, so across all thirty-six pairings the only thing standing between the
// second part and its anchor is whether the anchor is already taken.
//
// THE VERDICT. Every offer on the occupied anchor is refused and adds no part;
// every offer on the free anchor is taken.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { at, onField, type Hex } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  clearWorld,
  createHarness,
  openChallengeDocument,
  partById,
  partIds,
  placePart,
  type Harness,
} from "../harness";
import type { PartName } from "../constants";

/**
 * Whether the surface REFUSED a placement: "Each placement is checked against
 * the placement rules of `specs/parts.md` alone, and throws an `Error` naming
 * the first rule it breaks" (`specs/instrumentation.md`, The machine).
 */
async function refusesPlacement(place: () => Promise<unknown>): Promise<boolean> {
  try {
    await place();
    return false;
  } catch {
    return true;
  }
}

/** The six kinds of `PARTS` anchored on one hex: the five arms and the wheel. */
const ANCHORED: readonly PartName[] = [
  "arm",
  "biarm",
  "triarm",
  "hexarm",
  "piston",
  "wheel",
];

/** The contested anchor, and a free anchor three hexes from it. */
const TAKEN: Hex = at(0, 0);
const BESIDE: Hex = at(3, 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses a second arm or wheel on an occupied anchor, in every pairing", async () => {
  await openChallengeDocument(h, BARE);
  assertEqual(onField(TAKEN), true, "the contested anchor is on the field");
  assertEqual(onField(BESIDE), true, "the free anchor three hexes off is on the field");

  // The representative pairing, posed and drawn first so the evidence exists
  // whichever pairing of the sweep below turns out to fail.
  const standing = await placePart(h, "arm", TAKEN, 0);
  const secondArm = await refusesPlacement(() =>
    h.debug.placePart("arm", TAKEN.q, TAKEN.r, 0),
  );
  const afterSecondArm = (await partIds(h)).length;

  await h.advance(1);
  await captureStill(h, "refused");

  assertEqual(
    partById(await h.snapshot(), standing)?.kind,
    "arm",
    "the first arm stands on the contested anchor",
  );
  assertEqual(
    secondArm,
    true,
    "a second arm on the hex an arm is already anchored on is refused",
  );
  assertEqual(afterSecondArm, 1, "that refusal added no part");

  for (const first of ANCHORED) {
    for (const second of ANCHORED) {
      const pairing = `${first} then ${second}`;
      await clearWorld(h);
      assertEqual((await partIds(h)).length, 0, `${pairing}: the machine starts empty`);

      let held = -1;
      const heldRefused = await refusesPlacement(async () => {
        held = await placePart(h, first, TAKEN, 0);
      });
      assertEqual(heldRefused, false, `${pairing}: the first part takes the anchor`);
      assertEqual(
        partById(await h.snapshot(), held)?.kind,
        first,
        `${pairing}: the first part stands on (0, 0)`,
      );

      const onTaken = await refusesPlacement(() =>
        h.debug.placePart(second, TAKEN.q, TAKEN.r, 0),
      );
      assertEqual(
        onTaken,
        true,
        `${pairing}: the second part is refused on the occupied anchor`,
      );
      assertEqual(
        (await partIds(h)).length,
        1,
        `${pairing}: the refusal added no part`,
      );

      let beside = -1;
      const onBeside = await refusesPlacement(async () => {
        beside = await placePart(h, second, BESIDE, 0);
      });
      assertEqual(
        onBeside,
        false,
        `${pairing}: the second part is taken three hexes off, where no anchor is shared`,
      );
      assertEqual(
        partById(await h.snapshot(), beside)?.kind,
        second,
        `${pairing}: the second part stands on (3, 0)`,
      );
      assertEqual(
        (await partIds(h)).length,
        2,
        `${pairing}: the machine holds the two parts on their two anchors`,
      );
    }
  }
});
