// parts/track-cells-are-consecutively-adjacent — a track's consecutive cells are
// adjacent, so an extension onto a hex away from the live end is refused.
//
// THE RULE. Placement rule 6: "A track's consecutive cells are adjacent, and a
// closed track's last cell is adjacent to its first and its path holds at least
// three cells" (`specs/parts.md`, Placement rules), which `specs/parts.md` also
// states under Track: "A `track` is an ordered path of distinct hexes, `cells`,
// laid one hex at a time in the editor. Consecutive cells are adjacent." What
// adjacency is, is `specs/field.md`: "Two hexes are adjacent when their
// difference is one of `DIRS`." `extendTrack` "Appends `(q, r)` to that track's
// path at its `last` end", and the surface "throws an `Error` naming the first
// rule it breaks" (`specs/instrumentation.md`).
//
// THE CONFIGURATION. An empty machine on a posed challenge, with no run live. A
// track is laid on `(0, 0)` alone and offered `(2, 0)`, two steps east of its
// live end; then `(1, 0)`, one step east; then `(1, 2)`, which is two steps from
// the new live end; then `(2, 0)`, one step from it. Every hex named is on the
// field, no footprint or second track is anywhere, and no hex is offered twice
// while it is held — so rules 1, 2 and 3 hold throughout and only rule 6
// separates the offers.
//
// THE VERDICT. Both non-adjacent extensions are refused and leave the path as it
// was; both adjacent ones are taken.

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
  placeTrack,
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

/** A track's cells, as a string a failure reads at a glance. */
function pathOf(cells: readonly Hex[] | null | undefined): string {
  return (cells ?? []).map((cell) => `${cell.q},${cell.r}`).join(" ");
}

const START: Hex = at(0, 0);
const NEXT: Hex = at(1, 0);
const AWAY_FROM_START: Hex = at(2, 0);
const AWAY_FROM_NEXT: Hex = at(1, 2);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses an extension onto a hex that is not adjacent to the live end", async () => {
  await openChallengeDocument(h, BARE);

  // The geometry the check claims to be posing.
  for (const hex of [START, NEXT, AWAY_FROM_START, AWAY_FROM_NEXT]) {
    assertEqual(
      onField(hex),
      true,
      `the hex (${hex.q}, ${hex.r}) is on the field`,
    );
  }
  assertEqual(
    adjacent(START, AWAY_FROM_START),
    false,
    "the first offer is not adjacent to the one-cell path's live end",
  );
  assertEqual(
    adjacent(START, NEXT),
    true,
    "the first control offer is adjacent to it",
  );
  assertEqual(
    adjacent(NEXT, AWAY_FROM_NEXT),
    false,
    "the second offer is not adjacent to the two-cell path's live end",
  );
  assertEqual(
    adjacent(NEXT, AWAY_FROM_START),
    true,
    "the second control offer is adjacent to it",
  );

  const track = await placeTrack(h, [START]);

  const jumpFromStart = await refusesPlacement(() =>
    h.debug.extendTrack(track, AWAY_FROM_START.q, AWAY_FROM_START.r),
  );
  const afterJump = pathOf(partById(await h.snapshot(), track)?.cells);
  const stepFromStart = await refusesPlacement(() =>
    h.debug.extendTrack(track, NEXT.q, NEXT.r),
  );
  const afterStep = pathOf(partById(await h.snapshot(), track)?.cells);
  const jumpFromNext = await refusesPlacement(() =>
    h.debug.extendTrack(track, AWAY_FROM_NEXT.q, AWAY_FROM_NEXT.r),
  );
  const afterSecondJump = pathOf(partById(await h.snapshot(), track)?.cells);
  const stepFromNext = await refusesPlacement(() =>
    h.debug.extendTrack(track, AWAY_FROM_START.q, AWAY_FROM_START.r),
  );
  const afterSecondStep = pathOf(partById(await h.snapshot(), track)?.cells);

  await h.advance(1);
  await captureStill(h, "refused");

  assertEqual(
    jumpFromStart,
    true,
    "extending two hexes past the live end is refused: consecutive cells are adjacent",
  );
  assertEqual(
    afterJump,
    pathOf([START]),
    "the refused extension left the path as it was",
  );
  assertEqual(
    stepFromStart,
    false,
    "extending one hex from the live end is taken",
  );
  assertEqual(
    afterStep,
    pathOf([START, NEXT]),
    "the taken extension is the path's second cell",
  );
  assertEqual(
    jumpFromNext,
    true,
    "an extension away from the NEW live end is refused the same way",
  );
  assertEqual(
    afterSecondJump,
    pathOf([START, NEXT]),
    "that refusal left the two-cell path as it was",
  );
  assertEqual(
    stepFromNext,
    false,
    "an extension adjacent to the new live end is taken",
  );
  assertEqual(
    afterSecondStep,
    pathOf([START, NEXT, AWAY_FROM_START]),
    "the path is the three consecutive, adjacent cells it was laid as",
  );
  assertEqual((await partIds(h)).length, 1, "the track is the whole machine");
});
