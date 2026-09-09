// presentation/overlay-shows-drag — the overlay reports the run in hand.
//
// THE RULE. `specs/instrumentation.md`, "Diagnostics", lists among the sources
// the build registers: "whether a run is in hand and how many cards it holds".
// Under this engine the panel is the build's own as well, so what this point
// decides is that those two values reach it.
//
// WHAT IT DECIDES, AND WHAT IT LEAVES ALONE. The two drag sources. The screen
// and the mode are `presentation/overlay-shows-screen`, the pile counts
// `presentation/overlay-shows-pile-counts`, the cascade
// `presentation/overlay-shows-cascade`, and that watching the panel costs the
// game nothing is `presentation/overlay-changes-nothing`. What the run in hand
// LOOKS like is `presentation/held-run-drawn-above`, and what a press lifts is
// `handling.press-grabs-column-run`.
//
// THE RUN HELD IS TWELVE CARDS, and the length is the distinguishing value. The
// run leaves its column as it enters the hand (specs/controls.md), so on this
// board all thirteen piles hold nothing and every count the panel can carry is a
// zero: `12` can only be the run in hand. It is also a figure a build's own
// panel lines are unlikely to carry by accident, which a run of one or two would
// not have been, and it is far from the `1` a build reporting a constant would
// draw.
//
// THE PRESS LANDS IN THE TOP CARD'S EXPOSED BAND. specs/controls.md resolves a
// press to the card drawn over every other at the press point, which in a column
// is the lowest of the cards whose footprint contains it, so a press at the top
// card's CENTRE would land on a card fanned below it and lift a shorter run. The
// press is therefore aimed at the band of the first card that the second does
// not cover, which the harness's column geometry gives; that is aiming, and
// nothing about the fan is graded here.
//
// THE VALUE IS READ, NEVER THE NAME where a build separated the two, which is
// what keeps the flag honest: a build whose source is NAMED `dragging` and whose
// value says `none` reports no live drag. The count is matched as a whole run of
// digits. The flag is not a number, and specs/instrumentation.md fixes no
// spelling for it, so it is accepted in any of the forms a build would honestly
// report a live drag in — and it is the ONLY flag the specification asks the
// panel to carry, so a truthy word among the values can only be it.
//
// THE WORLD IT POSES. `openTable` empties all thirteen piles; one twelve-card
// run goes on column `0` and is lifted. Nothing else is on the table, and the
// pointer is driven through the debug surface, which specs/instrumentation.md
// feeds into the same input path a player's pointer feeds.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CARD_W } from "../constants";
import {
  captureStill,
  card,
  columnCardTopLeft,
  columnFaceUpOffset,
  createHarness,
  facesOf,
  openTable,
  pileOf,
  poseColumn,
  runDown,
  toggleOverlay,
  type Harness,
} from "../harness";
import { assertFigure, assertForm, overlayLines } from "./overlay";

/**
 * The run posed: a King down to a two, alternating in colour, which is the
 * longest run specs/tableau.md lets a column hold in one piece.
 */
const RUN_LENGTH = 12;
const RUN = runDown(card("KS"), RUN_LENGTH);
const COLUMN = 0;

/**
 * The words a live drag may be reported in.
 *
 * specs/instrumentation.md asks for "whether a run is in hand" and fixes no
 * spelling, so a build is free to register the boolean itself, drawn as `true`,
 * or a word of its own. It is the only flag the specification asks the panel to
 * carry, and every other value on this board is a count, so none of these words
 * can belong to anything else. The `simple-2d` and `structured-2d` suites read
 * the same requirement as a dependence instead — a line the panel draws only
 * once the run is in hand, carrying the run's length — and both readings accept
 * every form the specification permits.
 */
const HELD_WORDS = /\b(true|yes|on|live|held|holding|in hand)\b/i;

/**
 * The other honest form: the run reported as the cards it holds.
 *
 * A panel line reading `drag 12 cards` says that a run is in hand and says how
 * many cards it holds, in one value, and a build that draws it that way has
 * registered both of the facts specs/instrumentation.md names. Refusing it would
 * be demanding a spelling the specification does not fix.
 *
 * It is the POSED length that is looked for, next to a word for what is being
 * counted, so a source stuck at `0 cards` does not answer this and neither does
 * a bare figure: `12` on its own could be any of the thirteen pile counts, and
 * a panel that draws one is not reporting whether a run is in hand.
 */
const HELD_COUNT = new RegExp(
  `\\b${String(RUN_LENGTH)}\\b[^0-9]{0,16}\\b(cards?|run|hand)\\b|` +
    `\\b(cards?|run|hand)\\b[^0-9]{0,16}\\b${String(RUN_LENGTH)}\\b`,
  "i",
);

/** Either of them: the panel reports the run in hand as a word or as a count. */
const HELD_FORMS = new RegExp(`${HELD_WORDS.source}|${HELD_COUNT.source}`, "i");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws whether a run is in hand and how many cards it holds", async () => {
  await openTable(h);
  await poseColumn(h, COLUMN, RUN);

  // The band of the column's first card that the card fanned below it does not
  // cover, so the press lifts the whole run rather than part of it.
  const faces = facesOf(pileOf(await h.snapshot(), "tableau", COLUMN));
  const top = columnCardTopLeft(COLUMN, 0, faces);
  await h.debug.pointerDown(
    top.x + CARD_W / 2,
    top.y + columnFaceUpOffset(faces) / 2,
  );

  const held = (await h.snapshot()).drag;
  assertEqual(
    held?.cards.length,
    RUN_LENGTH,
    `the cards a press at the top of column ${String(COLUMN)} lifted ` +
      "(specs/controls.md: a press on a face-up card in a column lifts that " +
      "card and every face-up card below it) — the board this point reads is " +
      "one with the whole run in hand",
  );

  const before = await h.frameCalls();
  await toggleOverlay(h);
  const after = await h.frameCalls();
  await captureStill(h, "overlay");
  const lines = overlayLines(before, after);

  assertForm(
    lines,
    HELD_FORMS,
    "whether a run is in hand, reported as a word for a live drag or as the " +
      "cards it holds (specs/instrumentation.md)",
  );
  assertFigure(
    lines,
    RUN_LENGTH,
    "how many cards the run in hand holds (specs/instrumentation.md)",
  );
});
