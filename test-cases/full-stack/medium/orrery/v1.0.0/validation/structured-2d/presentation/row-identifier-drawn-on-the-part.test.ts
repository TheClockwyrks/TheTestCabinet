// presentation/row-identifier-drawn-on-the-part — the identifier a tape row's
// label carries is drawn on that part on the field.
//
// THE RULE. "Each row's label carries an identifier unique among the machine's
// rows, and the same identifier is drawn on that part on the field"
// (`specs/editor.md`, The tape panel). `specs/assets.md` puts "The identifier
// drawn on each arm and wheel on the field" under "What stays drawn in code".
//
// WHICH ROW BELONGS TO WHICH PART. The panel "shows one row per arm and wheel, in
// placement order", and "Visible row `v` ... shows the arm at index `firstRow + v`
// in placement order", with `firstRow` `0` "with no cursor". Three arms are placed
// and nothing points the cursor at a row, so visible rows `0`, `1` and `2` are the
// three arms in the order they were placed — which is the order `partIds` answers
// them in.
//
// WHERE EACH IS READ. A row's label "spans `x` `TRAY_REGION_W` (`224`) to
// `TRAY_REGION_W + TAPE_LABEL_W` (`304`) across its row's full height", which is
// the rectangle `tapeLabel(v)` computes; the field identifier is read from the
// text the frame drew within one hex of the part's own anchor. Both are read off
// ONE frame, so nothing can have changed between them.
//
// WHAT AN IDENTIFIER LOOKS LIKE IS THE BUILD'S. `specs/` fixes no alphabet, no
// length, and no place within the label or within the part, and a row's label also
// carries the length annotation the same section requires ("each row is annotated
// with its tape length against the machine's period"). So the reading is by
// CONTAINMENT, case and whitespace dropped: the run drawn on the part is one the
// row's label also carries. Requiring the two to be the same run would fail a
// build whose label draws the identifier and the annotation together.
//
// AND THE THREE MUST BE TELLING PARTS APART. The identifiers are "unique among the
// machine's rows", so the three the field carries are three different strings —
// otherwise the parts are not told apart on the field however legible each mark is.
//
// THE VERDICT. Each of the three arms carries a non-empty identifier on the field,
// each is one the matching row's label carries, and the three are distinct.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import { HEX_PITCH } from "../constants";
import { hexCenter, tapeLabel, type Hex } from "../field";
import { BARE, EAST, ORIGIN, WEST } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  partIds,
  placePart,
  textDraws,
  textIn,
  type Harness,
} from "../harness";

/** Where the three arms stand: three hexes no length-one arm can reach between. */
const ANCHORS: readonly Hex[] = [WEST, ORIGIN, EAST];

/** How far from a part's anchor a run of text counts as drawn on that part. */
const ON_THE_PART = HEX_PITCH;

/** Text with its case and its whitespace dropped, which is how runs are matched. */
function squash(text: string): string {
  return text.toLowerCase().replace(/\s+/gu, "");
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws each row's identifier on its own arm on the field", async () => {
  await openChallengeDocument(h, BARE);
  for (const anchor of ANCHORS) await placePart(h, "arm", anchor, 0);
  // The editor outlines the selected part (`specs/editor.md`); this point is
  // about what is written on the parts, not about which one is in hand.
  await h.debug.setSelected(null);
  await h.advance(1);
  await captureStill(h, "field-identifiers");

  const placed = await partIds(h);
  assertEqual(
    placed.length,
    ANCHORS.length,
    "three arms are on the field, so the panel shows three rows and the field carries three identifiers",
  );

  const calls = await h.lastCalls();
  const carried: string[] = [];

  for (const [row, anchor] of ANCHORS.entries()) {
    const label = textIn(calls, tapeLabel(row))
      .map((draw) => squash(draw.text))
      .filter((text) => text.length > 0);
    assertGreaterThan(
      label.length,
      0,
      `row ${row} of the tape panel draws a label, which is where its identifier is carried`,
    );

    const centre = hexCenter(anchor);
    const onPart = textDraws(calls)
      .filter(
        (draw) =>
          Math.hypot(draw.x - centre.x, draw.y - centre.y) <= ON_THE_PART,
      )
      .map((draw) => squash(draw.text))
      .filter((text) => text.length > 0);
    assertGreaterThan(
      onPart.length,
      0,
      `the arm at (${anchor.q}, ${anchor.r}) carries a run of text on the field, which is where its row's identifier is drawn`,
    );

    const shared = onPart.find((text) =>
      label.some((entry) => entry.includes(text) || text.includes(entry)),
    );
    assertTrue(
      shared !== undefined,
      `the text drawn on the arm at (${anchor.q}, ${anchor.r}) is the identifier its row's label carries; the field drew ${JSON.stringify(onPart)} and the label ${JSON.stringify(label)}`,
    );
    carried.push(shared ?? "");
  }

  assertEqual(
    new Set(carried).size,
    ANCHORS.length,
    `the three arms carry three different identifiers, so they are told apart on the field; they carried ${JSON.stringify(carried)}`,
  );
});
