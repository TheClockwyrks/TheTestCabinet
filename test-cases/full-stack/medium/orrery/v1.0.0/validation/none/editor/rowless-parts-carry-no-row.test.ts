// editor/rowless-parts-carry-no-row — tracks, sigils, rises and sets take no row
// in the tape panel.
//
// THE RULE. "The panel shows one row per arm and wheel, in placement order"
// (`specs/editor.md`, The tape panel) — one per ARM AND WHEEL, so a part that is
// neither takes no row at all. `specs/parts.md` says which kinds those are: `arm`,
// `biarm`, `triarm`, `hexarm` and `piston` "share one anatomy", a `wheel` is the
// zodiac wheel, and `track`, the twelve transforming sigils, `rise` and `set` are
// the rest. `specs/formats.md` draws the same line over the state: "Every arm and
// wheel carries a `tape`, possibly empty", and no other class carries one — which
// is what `specs/instrumentation.md` reports as `tape: [...] | null`.
//
// So a rowless part must not push the rows of the arms placed after it down: the
// row order is the order of the ARMS AND WHEELS in `editor.parts`, not the order
// of `editor.parts` itself.
//
// HOW A ROW IS READ. By pressing its label: "A press inside a row's label points
// [the cursor] at that row, column `0`", "Visible row `v` ... shows the arm at
// index `firstRow + v` in placement order" with `firstRow` `0` "with no cursor",
// and "a press in the panel that lands on no row or cell leaves the cursor as it
// is".
//
// THE CONFIGURATION. `BARE` opened in the editor and a machine loaded whose parts
// INTERLEAVE the rowless kinds with the arms, so a build that counted rows off
// `editor.parts` rather than off its arms lands on the wrong part at every row.
// In placement order: a track `(0, 3)`–`(2, 3)`; an arm on `(-3, 0)`; a `bind`
// sigil on `(0, -3)`; the challenge's rise on `(-3, 3)`; an arm on `(3, 0)`; and
// the challenge's set on `(3, -3)`. The three sigil footprints are pairwise
// disjoint and no track cell lies on any of them, as placement rule 2 requires,
// and the two arms' anchors differ, as rule 4 requires. Six parts, two of which
// carry rows.
//
// THE VERDICT. Visible row `0` is the first ARM and visible row `1` is the second
// ARM — the four rowless parts between and around them take no row and shift
// nothing — and visible row `2` lands on no row at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import { at, regionCenter, tapeLabel } from "../field";
import {
  armPart,
  risePart,
  setPart,
  sigilPart,
  solution,
  trackPart,
} from "../formats";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadMachine,
  openChallengeDocument,
  partIds,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Clear the cursor, press visible row `v`'s label, and answer where the cursor landed. */
async function pressLabel(
  v: number,
): Promise<{ part: number; col: number } | null> {
  await h.debug.setCursor(null, 0);
  await pressAt(h, regionCenter(tapeLabel(v)));
  await releasePointer(h);
  return (await h.snapshot()).editor.cursor;
}

it("shows a row for each arm alone, skipping the track, the sigil, the rise and the set", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(
    h,
    solution([
      trackPart([at(0, 3), at(1, 3), at(2, 3)]),
      armPart("arm", -3, 0, 0, 1, ["grab"]),
      sigilPart("bind", 0, -3, 0),
      risePart(0, -3, 3, 0),
      armPart("arm", 3, 0, 0, 1, ["drop"]),
      setPart(0, 3, -3, 0),
    ]),
  );
  await h.advance(1);
  await captureStill(h, "rows");

  const ids = await partIds(h);
  assertEqual(ids.length, 6, "all six parts are on the field");
  assertDeepEqual(
    (await h.snapshot()).editor.parts.map((part) => part.kind),
    ["track", "arm", "bind", "rise", "arm", "set"],
    "the machine interleaves the rowless kinds with the two arms",
  );

  assertEqual(
    (await pressLabel(0))?.part,
    ids[1],
    "visible row 0 is the first ARM, not the track that was placed before it",
  );
  assertEqual(
    (await pressLabel(1))?.part,
    ids[4],
    "visible row 1 is the second ARM: the sigil and the rise between the two arms take no row",
  );
  assertNull(
    await pressLabel(2),
    "there is no third row: the track, the sigil, the rise and the set carry none",
  );
});
