// parts/a-track-never-revisits-a-hex — a track's cells are distinct, so a path
// cannot be extended back onto a hex it already holds.
//
// THE RULE. Placement rule 3: "No hex is a cell of two tracks, or of one track
// twice" (`specs/parts.md`, Placement rules), which `specs/parts.md` also states
// from the track's own side under Track: "A `track` is an ordered path of
// distinct hexes, `cells`, laid one hex at a time in the editor." The surface
// "throws an `Error` naming the first rule it breaks"
// (`specs/instrumentation.md`).
//
// THE CONFIGURATION. An empty machine on a posed challenge, with no run live. One
// track is laid on `(0, 0)`, `(1, 0)`, `(0, 1)` — three cells that ring back on
// themselves, so the path's live end `(0, 1)` is adjacent to its own first cell.
// Two extensions are then offered from that end: `(0, 0)`, which the path already
// holds, and `(-1, 1)`, which it does not. Both are adjacent to the live end and
// on the field, so placement rules 1 and 6 hold for both and only rule 3
// separates them.
//
// THE VERDICT. The extension back onto `(0, 0)` is refused and the path stays the
// three cells it was laid as; the extension onto `(-1, 1)` is taken.

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

/** The path laid, the hex it already holds, and the hex it does not. */
const PATH: readonly Hex[] = [at(0, 0), at(1, 0), at(0, 1)];
const REVISITED: Hex = at(0, 0);
const FRESH: Hex = at(-1, 1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses an extension onto a hex the track already holds", async () => {
  await openChallengeDocument(h, BARE);

  // The geometry the check claims to be posing.
  const live = PATH[PATH.length - 1] as Hex;
  for (const hex of [...PATH, FRESH]) {
    assertEqual(
      onField(hex),
      true,
      `the hex (${hex.q}, ${hex.r}) is on the field`,
    );
  }
  assertEqual(
    adjacent(live, REVISITED),
    true,
    "the revisited hex is adjacent to the live end, so rule 6 is not what refuses it",
  );
  assertEqual(
    adjacent(live, FRESH),
    true,
    "so is the fresh hex the control extension takes",
  );
  assertEqual(
    PATH.filter((cell) => cell.q === REVISITED.q && cell.r === REVISITED.r)
      .length,
    1,
    "the revisited hex is already a cell of this very track",
  );
  assertEqual(
    PATH.some((cell) => cell.q === FRESH.q && cell.r === FRESH.r),
    false,
    "the fresh hex is a cell of nothing",
  );

  const track = await placeTrack(h, PATH);

  const backOntoItself = await refusesPlacement(() =>
    h.debug.extendTrack(track, REVISITED.q, REVISITED.r),
  );
  const afterRefusal = pathOf(partById(await h.snapshot(), track)?.cells);
  const ontoFresh = await refusesPlacement(() =>
    h.debug.extendTrack(track, FRESH.q, FRESH.r),
  );
  const afterFresh = pathOf(partById(await h.snapshot(), track)?.cells);

  await h.advance(1);
  await captureStill(h, "refused");

  assertEqual(
    backOntoItself,
    true,
    "extending the track onto a hex it already holds is refused",
  );
  assertEqual(
    afterRefusal,
    pathOf(PATH),
    "the refused extension left the path exactly as it was laid",
  );
  assertEqual(
    ontoFresh,
    false,
    "extending the track onto a hex it does not hold is taken",
  );
  assertEqual(
    afterFresh,
    pathOf([...PATH, FRESH]),
    "the taken extension is the path's fourth cell",
  );
  assertEqual((await partIds(h)).length, 1, "the track is the whole machine");
});
