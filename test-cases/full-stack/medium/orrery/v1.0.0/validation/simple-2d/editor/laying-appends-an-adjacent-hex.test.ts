// editor/laying-appends-an-adjacent-hex — while laying, each pointer move onto a
// hex adjacent to the live end appends that hex, and it becomes the live end.
//
// THE RULE. "While laying, MOVING THE POINTER ONTO A HEX ADJACENT TO THE LIVE END
// APPENDS IT TO THE PATH WHEN THE PLACEMENT RULES ALLOW, AND THAT HEX BECOMES THE
// LIVE END" (`specs/editor.md`, Laying track). Which end is live is fixed by the
// press: "A PRESS ON A ONE-CELL TRACK BEGINS LAYING FROM ITS `LAST` END", so a
// one-cell track lays forward and each appended hex lands at the path's end.
// Adjacency is `specs/field.md`'s: "Two hexes are adjacent when their difference
// is one of `DIRS`."
//
// THE CONFIGURATION. `BARE` opened in the editor with ONE one-cell track on
// `ORIGIN`, laid through the surface, and nothing else on the field — so no
// footprint, no second track and no rule but adjacency can decide what the two
// moves do. The gesture presses `ORIGIN`, moves onto `(1, 0)`, moves onto
// `(2, 0)`, and releases. Each hex is one step east of the one before, both are on
// the field, and neither is a cell of anything, so the placement rules allow both:
// the placement oracle passes the finished three-cell path.
//
// THE PATH IS READ AFTER EACH MOVE, not only at the end, because "that hex becomes
// the live end" is what makes the second move append to the first rather than
// replace it.
//
// THE VERDICT. `cells` is `(0, 0)`, `(1, 0)` after the first move and `(0, 0)`,
// `(1, 0)`, `(2, 0)` after the second, in that order.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNull, assertTrue } from "../assert";
import { adjacent, at, hexCenter, type Hex } from "../field";
import { trackPart } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import { placementFault } from "../parts";
import {
  captureReplay,
  createHarness,
  moveTo,
  openChallengeDocument,
  partById,
  placeTrack,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

/** The two hexes the pointer visits, each adjacent to the one before it. */
const STEPS: readonly Hex[] = [at(1, 0), at(2, 0)];

/** The path the two moves must leave behind. */
const LAID: readonly Hex[] = [ORIGIN, ...STEPS];

/** A path, as the strings a reading compares. */
function spelled(cells: readonly { q: number; r: number }[]): string[] {
  return cells.map((cell) => `${cell.q},${cell.r}`);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("appends each adjacent hex the pointer moves onto, in order", async () => {
  for (const [index, step] of STEPS.entries()) {
    assertTrue(
      adjacent(LAID[index] as Hex, step),
      `the pointer's step onto (${step.q}, ${step.r}) lands adjacent to the live end before it`,
    );
  }
  assertNull(
    placementFault([trackPart(LAID)], {
      reagents: BARE.reagents,
      products: BARE.products,
    }),
    "the finished three-cell path breaks none of the six placement rules",
  );

  await openChallengeDocument(h, BARE);
  const track = await placeTrack(h, [ORIGIN]);

  const seen = await captureReplay(h, "path", async () => {
    await h.advance(1);
    await pressAt(h, hexCenter(ORIGIN));
    const paths: string[][] = [];
    for (const step of STEPS) {
      await moveTo(h, hexCenter(step));
      await h.advance(1);
      paths.push(spelled(partById(await h.snapshot(), track)?.cells ?? []));
    }
    await releasePointer(h);
    await h.advance(1);
    return paths;
  });

  assertDeepEqual(
    seen,
    [spelled(LAID.slice(0, 2)), spelled(LAID)],
    "the first move appended (1, 0) and the second appended (2, 0) after it",
  );
  assertDeepEqual(
    spelled(partById(await h.snapshot(), track)?.cells ?? []),
    spelled(LAID),
    "and the release left the path as laid",
  );
});
