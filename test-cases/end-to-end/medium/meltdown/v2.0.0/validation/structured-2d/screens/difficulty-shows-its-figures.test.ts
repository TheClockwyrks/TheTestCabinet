// Meltdown — screens/difficulty-shows-its-figures: every difficulty's starting
// money and wave count are on the screen before one is chosen.
//
// THE RULE. specs/screens.md, `difficultyselect`: "Each row draws that
// difficulty's starting money and its wave count, before it is chosen."
// specs/modes.md fixes the six figures in `DIFFICULTY_TABLE`: Easy `350` and
// `15`, Medium `250` and `20`, Hard `200` and `26`.
//
// SIX NUMBERS, READ OFF ONE FRAME OF THE UNCHOSEN LIST. The point of the rule is
// that a player can compare the three before committing, so all six must be on
// the screen at once, with the screen still `difficultyselect` — which is what
// "before it is chosen" means and what is asserted beside them.
//
// THE FIGURES ARE READ AS NUMBERS, NOT AS STRINGS. specs/screens.md fixes nothing
// about how a row formats what it reports, so a build may draw `350 MONEY  15
// WAVES`, `$350 / 15`, or a two-line row, and every one of those is the
// requirement met. A number TOKEN is looked for, so a screen reading `1500` is
// never accepted as a screen reading `15`.
//
// WHY NO ROW ASSOCIATION IS DEMANDED. specs/screens.md fixes no layout for a row,
// so a check requiring a figure to sit within some distance of its row's name
// would be demanding a layout the specification leaves open, and would fail a
// build that drew the three pairs in a column beside the list. It does not need
// to: the six figures are mutually distinct, so a screen carrying all six is a
// screen that drew every row's pair, and a build that reports one row's figures
// for all three, or that reports money without wave counts, is missing four of
// the six.
//
// THE FIGURES COME OFF `DIFFICULTY_TABLE` rather than being written out, so this
// asks for the numbers the case handed the build.
//
// NOTHING IS CONFIRMED. Where a row leads is
// `screens.difficulty-starts-the-run`'s requirement; this reads the list while it
// is still a list.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { DIFFICULTIES, DIFFICULTY_ITEMS, DIFFICULTY_TABLE } from "../constants";
import { captureStill, createHarness, resetTo, type Harness } from "../harness";
import { readScreen, readsNumber, textOf } from "./menu";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws each difficulty's starting money and wave count while the list is still open", async () => {
  resetTo(h);
  h.debug.setScreen("difficultyselect");
  h.debug.setMenuIndex(0);

  const runs = await readScreen(h);
  captureStill(h, "figures");

  assertEqual(
    h.snapshot().screen,
    "difficultyselect",
    "the figures are read before a difficulty is chosen",
  );

  const drawn = textOf(runs).join(" | ");
  for (const [index, difficulty] of DIFFICULTIES.entries()) {
    // specs/screens.md lists `DIFFICULTY_ITEMS` in the order specs/modes.md's
    // table names the difficulties, so the row at index `i` is `DIFFICULTIES[i]`.
    const label = DIFFICULTY_ITEMS[index];
    const row = DIFFICULTY_TABLE[difficulty];
    assertTrue(
      readsNumber(runs, row.money),
      `the difficulty list draws ${label}'s starting money, ${row.money} ` +
        `(specs/modes.md); it drew ${drawn}`,
    );
    assertTrue(
      readsNumber(runs, row.waves),
      `the difficulty list draws ${label}'s wave count, ${row.waves} ` +
        `(specs/modes.md); it drew ${drawn}`,
    );
  }
});
