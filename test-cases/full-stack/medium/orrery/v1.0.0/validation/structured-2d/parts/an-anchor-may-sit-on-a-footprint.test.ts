// parts/an-anchor-may-sit-on-a-footprint — an arm or wheel may be anchored on a
// sigil, rise or set footprint hex.
//
// THE RULE. Placement rule 4: "No two arms or wheels share an anchor hex. An arm
// or wheel's anchor may sit on any sigil footprint hex, a rise's and a set's
// included, or on a track cell; sitting on a track cell is what mounts it"
// (`specs/parts.md`, Placement rules). Rule 2 keeps footprints apart from each
// other and from track cells and says nothing about anchors: "Sigil footprints,
// rise and set footprints included, are pairwise disjoint, and no track cell lies
// on any of them." So an anchor over a footprint is legal, and the surface — which
// checks "against the placement rules of `specs/parts.md` alone"
// (`specs/instrumentation.md`) — has nothing to refuse.
//
// THE CONFIGURATION. An empty machine on a posed challenge, with no run live. A
// `bind` stands at `(0, 0)`, covering `(0, 0)` and `(1, 0)`; the challenge's rise
// stands at `(3, 0)` and its set at `(-3, 0)`, each covering the one hex its
// one-mote pattern places. Four mechanisms are then anchored, one on each of
// those footprint hexes: an `arm` on the sigil's first hex, a `wheel` on its
// second, an `arm` on the rise's hex and a `wheel` on the set's. No two of them
// share an anchor, so rule 4's own prohibition is not what is being read.
//
// THE VERDICT. All four placements are taken, and each mechanism reads back
// anchored on the footprint hex it was offered.

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
  placePart,
  placeRise,
  placeSet,
  type Harness,
} from "../harness";
import { sigilHexes } from "../parts";

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

const SIGIL: Hex = at(0, 0);
const SIGIL_SECOND: Hex = at(1, 0);
const RISE: Hex = at(3, 0);
const SET: Hex = at(-3, 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("anchors an arm and a wheel on sigil, rise and set footprint hexes", async () => {
  await openChallengeDocument(h, BARE);

  // The geometry the check claims to be posing.
  for (const hex of [SIGIL, SIGIL_SECOND, RISE, SET]) {
    assertEqual(onField(hex), true, `the hex (${hex.q}, ${hex.r}) is on the field`);
  }
  const footprint = sigilHexes("bind", SIGIL, 0);
  assertEqual(
    footprint.filter((hex) => sameHex(hex, SIGIL) || sameHex(hex, SIGIL_SECOND))
      .length,
    2,
    "the sigil covers both of the hexes its two mechanisms are anchored on",
  );

  await placePart(h, "bind", SIGIL, 0);
  await placeRise(h, 0, RISE, 0);
  await placeSet(h, 0, SET, 0);

  let onSigilFirst = -1;
  const sigilFirstRefused = await refusesPlacement(async () => {
    onSigilFirst = await placePart(h, "arm", SIGIL, 0);
  });
  let onSigilSecond = -1;
  const sigilSecondRefused = await refusesPlacement(async () => {
    onSigilSecond = await placePart(h, "wheel", SIGIL_SECOND, 0);
  });
  let onRise = -1;
  const riseRefused = await refusesPlacement(async () => {
    onRise = await placePart(h, "arm", RISE, 0);
  });
  let onSet = -1;
  const setRefused = await refusesPlacement(async () => {
    onSet = await placePart(h, "wheel", SET, 0);
  });

  await h.advance(1);
  await captureStill(h, "shared");

  assertEqual(
    sigilFirstRefused,
    false,
    "an arm anchored on a sigil's first footprint hex is placed",
  );
  assertEqual(
    sigilSecondRefused,
    false,
    "a wheel anchored on that sigil's second footprint hex is placed",
  );
  assertEqual(riseRefused, false, "an arm anchored on a rise's footprint hex is placed");
  assertEqual(setRefused, false, "a wheel anchored on a set's footprint hex is placed");

  const snapshot = await h.snapshot();
  const seated: { part: number; kind: string; hex: Hex }[] = [
    { part: onSigilFirst, kind: "arm", hex: SIGIL },
    { part: onSigilSecond, kind: "wheel", hex: SIGIL_SECOND },
    { part: onRise, kind: "arm", hex: RISE },
    { part: onSet, kind: "wheel", hex: SET },
  ];
  for (const entry of seated) {
    assertEqual(
      partById(snapshot, entry.part)?.kind,
      entry.kind,
      `the ${entry.kind} on (${entry.hex.q}, ${entry.hex.r}) stands on the machine`,
    );
    assertEqual(
      `${partById(snapshot, entry.part)?.q},${partById(snapshot, entry.part)?.r}`,
      `${entry.hex.q},${entry.hex.r}`,
      `the ${entry.kind} is anchored on the footprint hex it was offered`,
    );
  }
  assertEqual(
    (await partIds(h)).length,
    7,
    "the machine holds the sigil, the rise, the set and all four mechanisms",
  );
});
