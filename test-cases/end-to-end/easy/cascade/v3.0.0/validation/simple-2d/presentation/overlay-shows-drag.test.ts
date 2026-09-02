// presentation/overlay-shows-drag — the overlay reports the run in hand.
//
// THE RULE. specs/instrumentation.md, "Diagnostics", lists among the sources the
// build registers: "whether a run is in hand and how many cards it holds". Under
// this engine "Registering those values is the whole of Cascade's part, through
// `InitApi.diagnostics`", so what this point decides is that the build registered
// those two.
//
// WHAT IT DECIDES, AND WHAT IT LEAVES ALONE. The two drag sources. The screen and
// the mode are `presentation/overlay-shows-screen`, the pile counts
// `presentation/overlay-shows-pile-counts`, the cascade
// `presentation/overlay-shows-cascade`, and that watching the panel costs the
// game nothing is `presentation/overlay-changes-nothing`. What the run in hand
// LOOKS like is `presentation/held-run-drawn-above`, and what a press lifts is
// `handling.press-grabs-column-run`.
//
// THE RUN HELD IS FOUR CARDS, on an otherwise empty table. Every other figure the
// panel can carry is then a zero — the thirteen piles are empty once the run
// leaves the column it was lifted from — so a run of digits reading `4` is the
// held count and can be nothing else. A run of one card would have been a figure
// a build could carry by accident.
//
// THE PRESS LANDS IN THE TOP CARD'S EXPOSED BAND. specs/controls.md resolves a
// press to "the card drawn over every other card at the press point, which in a
// column is the lowest of the cards whose footprint contains that point", so a
// press at the top card's CENTRE would land on the card fanned below it and lift
// a run of two. The press is therefore aimed at the band of the first card that
// the second does not cover, which the harness's column geometry gives; that is
// aiming, and nothing about the fan is graded here.
//
// THE VALUE IS READ, NEVER THE NAME, which is what keeps the flag honest: a
// build whose source is NAMED `dragging` and whose value says `false` reports no
// live drag, and only the half of the line after the name is read. The count is
// matched as a whole run of digits. The flag is not a number, and
// specs/instrumentation.md fixes no spelling for it, so it is accepted in any of
// the forms a build would honestly report a live drag in — and it is the ONLY
// flag the specification asks the panel to carry, so a truthy word among the
// values can only be it.
//
// THE WORLD IT POSES. `openTable` empties all thirteen piles; one four-card run
// goes on column `0` and is lifted. Nothing else is on the table, and the pointer
// is driven through the debug surface, which specs/instrumentation.md feeds into
// the same input path a player's pointer feeds.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CARD_W } from "../constants";
import {
  captureStill,
  columnCardTopLeft,
  createHarness,
  drawFrame,
  faceUpGap,
  facesOf,
  openTable,
  pileOf,
  poseColumn,
  toggleOverlay,
  type Harness,
} from "../harness";
import { assertFigure, assertForm, overlayLines } from "./overlay";

/** The run posed, in run order: each card one lower and the other colour. */
const RUN = ["KS", "QH", "JC", "10D"];
const COLUMN = 0;

/**
 * The forms a live drag may be reported in.
 *
 * specs/instrumentation.md asks for "whether a run is in hand" and fixes no
 * spelling, so a build is free to register the boolean itself, which the engine
 * draws as `true` (engine docs, `diagnostics.md`), or a word of its own. It is
 * the only flag the specification asks the panel to carry, and every other value
 * on this board is a count, so none of these words can belong to anything else.
 * The `none` and `structured-2d` suites read the same forms, so the one
 * requirement is decided the same way on all three engines.
 */
const HELD_FORMS = /\b(true|yes|on|live|held|holding|in hand)\b/i;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws whether a run is in hand and how many cards it holds", async () => {
  openTable(h);
  poseColumn(h, COLUMN, RUN);

  // The band of the column's first card that the card fanned below it does not
  // cover, so the press lifts the whole run rather than part of it.
  const faces = facesOf(pileOf(h.snapshot(), "tableau", COLUMN));
  const top = columnCardTopLeft(COLUMN, 0, faces);
  h.debug.pointerDown(top.x + CARD_W / 2, top.y + faceUpGap(faces) / 2);

  const held = h.snapshot().drag;
  assertEqual(
    held?.cards.length,
    RUN.length,
    `the cards a press at the top of column ${String(COLUMN)} lifted ` +
      "(specs/controls.md: a press on a face-up card in a column lifts that " +
      "card and every card below it) — the board this point reads is one with " +
      "the whole run in hand",
  );

  const before = await drawFrame(h);
  const after = await toggleOverlay(h);
  captureStill(h, "overlay");
  const lines = overlayLines(before, after);

  assertForm(lines, HELD_FORMS, "whether a run is in hand, reported as live");
  assertFigure(
    lines,
    RUN.length,
    "how many cards the run in hand holds (specs/instrumentation.md)",
  );
});
