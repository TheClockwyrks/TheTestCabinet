// navigation/hud-menu-back-inert — `menu-back` does nothing during play.
//
// THE RULE. `specs/controls.md`, Menu navigation, the per-screen table: `playing`
// / `menu-back` — "Nothing." `specs/screens.md` says why there is nothing for it
// to do: "There is no pause screen. The game is untimed and nothing on the table
// moves between one gesture and the next, so play carries nothing to interrupt:
// leaving a game for the title is the whole of stepping away from it."
//
// WHY AN INERT ACTION IS GRADED AT ALL. `Escape` is the key a player reaches for
// to get out of something, and a build that gave it a meaning here would take a
// player off a game in progress — losing the board — on a key the specification
// says does nothing. That affects play without taking a route away, which is what
// its `passable` cap says; the route that DOES leave a game is the HUD's `MENU`,
// graded by `navigation/hud-menu-confirm` and `screens/hud-menu-returns`.
//
// THE BOARD IS READ AS WELL AS THE SCREEN AND THE SELECTION, because the costliest
// way to get this wrong is to deal a fresh game: the table is posed with cards
// whose ids are read before the press and required to be the same cards
// afterwards.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HUD_MENU_ITEM, MENU_BACK_KEY } from "../constants";
import {
  captureStill,
  card,
  createHarness,
  down,
  EIGHT,
  everyCard,
  NINE,
  openTable,
  poseColumn,
  pressKey,
  SEVEN,
  up,
  type CascadeSnapshot,
  type Harness,
} from "../harness";

/** The column posed, and the cards on it: a board a fresh deal would replace. */
const COLUMN = 2;
const CARDS = [
  down(card("clubs", NINE)),
  up(card("diamonds", EIGHT)),
  up(card("spades", SEVEN)),
] as const;

/** Every card on the board, by id and name, so a re-deal reads as a change. */
function board(s: CascadeSnapshot): string {
  return everyCard(s)
    .map((site) => site.card)
    .sort((a, b) => a.id - b.id)
    .map((c) => `${c.id}:${c.suit}-${c.rank}${c.faceUp ? "u" : "d"}`)
    .join(" ");
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the table, the screen and the selection where they were", async () => {
  openTable(h);
  poseColumn(h, COLUMN, [...CARDS]);
  h.debug.setMenuIndex(HUD_MENU_ITEM);

  const before = h.snapshot();
  assertEqual(
    before.menuIndex,
    HUD_MENU_ITEM,
    "posing: menuIndex before the press — a selection that was never posed " +
      "could not say whether the press moved it",
  );
  const standing = board(before);

  await pressKey(h, MENU_BACK_KEY);
  const after = h.snapshot();

  await h.advance(1);
  // Before the assertions, so a press that did something still leaves the
  // picture of what it left.
  captureStill(h, "playing");

  assertEqual(
    after.screen,
    "playing",
    `the screen one press of ${MENU_BACK_KEY} left the game on, which during ` +
      `play does nothing (specs/controls.md) — the game carries no pause ` +
      `screen (specs/screens.md)`,
  );
  assertEqual(
    after.menuIndex,
    HUD_MENU_ITEM,
    `menuIndex after that press, against the ${HUD_MENU_ITEM} it was posed to`,
  );
  assertEqual(
    board(after),
    standing,
    "the cards on the table after that press, against the cards it was posed " +
      "with — a build that dealt a fresh game on Escape has taken the board " +
      "away (specs/controls.md)",
  );
});
