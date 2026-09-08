// parts/track-may-not-be-laid-on-a-footprint — a track cell may not be laid on a
// footprint hex.
//
// THE RULE. Placement rule 2: "Sigil footprints, rise and set footprints
// included, are pairwise disjoint, and no track cell lies on any of them"
// (`specs/parts.md`, Placement rules). `bind`'s footprint is `(0, 0)` and
// `(1, 0)` (`specs/sigils.md`), and the surface "throws an `Error` naming the
// first rule it breaks" (`specs/instrumentation.md`).
//
// THE CONFIGURATION. An empty machine on a posed challenge, with no run live. A
// `bind` stands at `(0, 0)`, holding `(0, 0)` and `(1, 0)`. A track is laid from
// `(0, 1)`, a hex the sigil does not cover, and is offered in turn:
//
//   - `(0, 0)`, the sigil's first hex, adjacent to the live end;
//   - `(1, 0)`, the sigil's second hex, also adjacent to the live end;
//   - `(-1, 1)`, adjacent to the live end and covered by nothing.
//
// Every offered hex is adjacent to the live end and on the field, so placement
// rules 1 and 6 hold for all three and only rule 2 separates them. A fresh
// one-cell track is then offered directly on `(1, 0)`, which reaches the same
// rule without an extension at all.
//
// THE VERDICT. Both extensions onto the footprint are refused and the path stays
// the one cell it was laid as; the extension clear of it is taken; and the fresh
// track on a footprint hex adds no part.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { adjacent, at, onField, type Hex } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  partById,
  partIds,
  placePart,
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

/** A track's cells, as a string a failure reads at a glance. */
function pathOf(cells: readonly Hex[] | null | undefined): string {
  return (cells ?? []).map((cell) => `${cell.q},${cell.r}`).join(" ");
}

const SIGIL: Hex = at(0, 0);
const START: Hex = at(0, 1);
const ON_FIRST: Hex = at(0, 0);
const ON_SECOND: Hex = at(1, 0);
const CLEAR: Hex = at(-1, 1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses a track cell on a sigil's footprint and leaves the path as it was", async () => {
  await openChallengeDocument(h, BARE);

  // The geometry the check claims to be posing.
  const footprint = sigilHexes("bind", SIGIL, 0);
  assertEqual(onField(START), true, "the track's first cell is on the field");
  for (const hex of [ON_FIRST, ON_SECOND, CLEAR]) {
    assertEqual(
      onField(hex),
      true,
      `the hex (${hex.q}, ${hex.r}) is on the field`,
    );
    assertEqual(
      adjacent(START, hex),
      true,
      `(${hex.q}, ${hex.r}) is adjacent to the track's live end, so rule 6 refuses nothing here`,
    );
  }
  assertEqual(
    footprint.map((hex) => `${hex.q},${hex.r}`).join(" "),
    `${ON_FIRST.q},${ON_FIRST.r} ${ON_SECOND.q},${ON_SECOND.r}`,
    "the sigil covers the two hexes the track is offered, and not the third",
  );
  assertEqual(
    footprint.some((hex) => hex.q === CLEAR.q && hex.r === CLEAR.r),
    false,
    "the sigil does not cover the control hex",
  );

  await placePart(h, "bind", SIGIL, 0);
  await h.debug.placeTrack(START.q, START.r);
  const track = (await partIds(h))[1] ?? -1;

  const ontoFirst = await refusesPlacement(() =>
    h.debug.extendTrack(track, ON_FIRST.q, ON_FIRST.r),
  );
  const afterFirst = pathOf(partById(await h.snapshot(), track)?.cells);
  const ontoSecond = await refusesPlacement(() =>
    h.debug.extendTrack(track, ON_SECOND.q, ON_SECOND.r),
  );
  const afterSecond = pathOf(partById(await h.snapshot(), track)?.cells);
  const ontoClear = await refusesPlacement(() =>
    h.debug.extendTrack(track, CLEAR.q, CLEAR.r),
  );
  const afterClear = pathOf(partById(await h.snapshot(), track)?.cells);
  const freshOnFootprint = await refusesPlacement(() =>
    h.debug.placeTrack(ON_SECOND.q, ON_SECOND.r),
  );
  const parts = (await partIds(h)).length;

  await h.advance(1);
  await captureStill(h, "refused");

  assertEqual(
    ontoFirst,
    true,
    "extending onto the sigil's first hex is refused",
  );
  assertEqual(
    afterFirst,
    pathOf([START]),
    "that refusal left the path as it was",
  );
  assertEqual(
    ontoSecond,
    true,
    "extending onto the sigil's second hex is refused",
  );
  assertEqual(
    afterSecond,
    pathOf([START]),
    "that refusal left the path as it was too",
  );
  assertEqual(
    ontoClear,
    false,
    "extending onto a hex no footprint covers is taken",
  );
  assertEqual(
    afterClear,
    pathOf([START, CLEAR]),
    "the taken extension is the path's second cell",
  );
  assertEqual(
    freshOnFootprint,
    true,
    "a fresh one-cell track on a footprint hex is refused as well",
  );
  assertEqual(parts, 2, "the machine holds the sigil and the one track");
});
