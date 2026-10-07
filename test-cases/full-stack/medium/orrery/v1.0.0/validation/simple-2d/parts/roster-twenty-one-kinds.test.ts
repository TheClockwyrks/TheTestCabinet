// parts/roster-twenty-one-kinds — `PARTS` holds twenty-one kinds, and every one
// of them goes onto the field.
//
// THE RULE. "`PARTS` holds the twenty-one part kinds in this order"
// (`specs/parts.md`, The parts roster), and the roster table names them: the five
// mechanisms `arm`, `biarm`, `triarm`, `hexarm` and `piston`, the `wheel`, the
// `track`, then `bind`, `manifold`, `triune`, `sunder`, `wane`, `mirror`,
// `ascend`, `conjoin`, `eclipse`, `confluence`, `dispersion`, `void`, `rise` and
// `set` — "`bind` through `void` are the twelve transforming sigils; `rise` and
// `set` are the other two."
//
// WHICH OPERATION PLACES WHICH. `specs/instrumentation.md`, The machine, splits
// the roster across four operations: "`placePart(kind, q, r, rotation)` — Places
// one part of `kind`, an arm, wheel, or sigil kind of `PARTS` in `specs/parts.md`
// ... A `kind` of `track`, `rise`, or `set` throws; each has its own operation",
// and those three are `placeTrack`, `placeRise` and `placeSet`. So the six
// mechanisms and the twelve transforming sigils go down through `placePart`, the
// track through `placeTrack`, and the challenge's one rise and one set through
// `placeRise` and `placeSet`: twenty-one placements, one per kind.
//
// THE TRAY IS NOT CONSULTED. "The challenge's `permitted` list is a tray rule of
// `specs/editor.md` rather than a placement rule, so none of these reads it"
// (`specs/instrumentation.md`), and `specs/formats.md` bounds a derived tray at
// `TRAY_MAX` (`16`) entries, so no single challenge could permit twenty-one kinds
// anyway. The posed challenge is therefore any challenge with one reagent and one
// product; what it permits is beside the point.
//
// THE LAYOUT. Every footprint below is `specs/sigils.md`'s own, placed at rotation
// `0`, and the anchors are chosen so that the six placement rules of
// `specs/parts.md` hold across the whole machine: every hex on the field of radius
// `FIELD_R` (`5`), the fourteen footprints pairwise disjoint, the track's three
// cells clear of all of them and consecutively adjacent, and the six mechanism
// anchors distinct. The kinds go down in `PARTS` order, so `editor.parts`, which
// `specs/instrumentation.md` reports in "placement order", reads back as the
// roster itself.
//
// THE VERDICT. The machine holds twenty-one parts and their kinds, in placement
// order, are exactly `PARTS`: no kind was refused, and no kind stood in for
// another.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { PARTS, type PartName } from "../constants";
import { at, type Hex } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  placePart,
  placeRise,
  placeSet,
  placeTrack,
  type Harness,
} from "../harness";

/** The six anchored mechanisms, in `PARTS` order, each on its own hex. */
const MECHANISMS: readonly (readonly [PartName, Hex])[] = [
  ["arm", at(0, -5)],
  ["biarm", at(1, -5)],
  ["triarm", at(2, -5)],
  ["hexarm", at(3, -5)],
  ["piston", at(4, -5)],
  ["wheel", at(5, -5)],
];

/** The track's path: three consecutive cells, clear of every footprint below. */
const TRACK_CELLS: readonly Hex[] = [at(-1, -4), at(0, -4), at(1, -4)];

/** The twelve transforming sigils, in `PARTS` order, at pairwise disjoint poses. */
const SIGILS: readonly (readonly [PartName, Hex])[] = [
  ["bind", at(-2, -3)],
  ["manifold", at(2, -3)],
  ["triune", at(0, -3)],
  ["sunder", at(4, -3)],
  ["wane", at(-3, -2)],
  ["mirror", at(-2, -2)],
  ["ascend", at(2, -2)],
  ["conjoin", at(4, -2)],
  ["eclipse", at(-1, -1)],
  ["confluence", at(-4, 0)],
  ["dispersion", at(1, 0)],
  ["void", at(3, 1)],
];

/** Where the challenge's one rise and one set stand, clear of every sigil. */
const RISE_ANCHOR = at(-3, -1);
const SET_ANCHOR = at(-2, -1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("places one of every kind PARTS names, and the machine reads back as the roster", async () => {
  assertLength(
    PARTS,
    21,
    "PARTS holds the twenty-one part kinds specs/parts.md tabulates",
  );

  await openChallengeDocument(h, BARE);

  const placed: PartName[] = [];
  for (const [kind, anchor] of MECHANISMS) {
    await placePart(h, kind, anchor, 0);
    placed.push(kind);
  }
  await placeTrack(h, TRACK_CELLS);
  placed.push("track");
  for (const [kind, anchor] of SIGILS) {
    await placePart(h, kind, anchor, 0);
    placed.push(kind);
  }
  await placeRise(h, 0, RISE_ANCHOR, 0);
  placed.push("rise");
  await placeSet(h, 0, SET_ANCHOR, 0);
  placed.push("set");

  await h.advance(1);
  await captureStill(h, "roster");

  const snapshot = await h.snapshot();
  assertDeepEqual(
    placed,
    [...PARTS],
    "the check offered one placement per kind, in the order PARTS names them",
  );
  assertEqual(
    snapshot.editor.parts.length,
    PARTS.length,
    "every one of the twenty-one placements was accepted, so the machine holds twenty-one parts",
  );
  assertDeepEqual(
    snapshot.editor.parts.map((part) => part.kind),
    [...PARTS],
    "editor.parts is in placement order, so the machine reads back as the PARTS roster itself",
  );
});
