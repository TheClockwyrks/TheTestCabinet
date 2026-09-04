// pointer/pointer-split-gesture-confirms-nothing — a press and a release in
// different items activate neither.
//
// THE RULE. `specs/controls.md`, Menu navigation, Pointer and touch: "The two
// edges of a gesture land in different regions, or either lands outside every
// region | No item is activated."
//
// WHY IT IS ITS OWN POINT. It is the half of the activation rule that says what
// does NOT happen, and a build that activates on the press alone, or on the
// release alone, passes `pointer/pointer-click-confirms` and fails here: it takes
// a player who slid off a button and let go somewhere else into a screen they did
// not ask for.
//
// THE GESTURE RUNS BETWEEN THE TWO ITEMS OF THE TITLE'S MENU, whose effects reach
// two different screens: a build activating the press's item deals a game and
// reaches `playing`, and one activating the release's item reaches `howto`. Both
// read as a different answer from the `title` this point requires, so neither can
// pass by accident.
//
// THE REGIONS ARE THE BUILD'S OWN, asked for through `menuItemRect`, so any
// layout passes; the gesture goes through the engine's own pointer, so what is
// graded is the build's own input path.
//
// THE CAP IS `passable`. This is an edge case of the general activation rule
// rather than a rule of its own: a build that fires on the release alone still
// starts a game and still reaches every screen with the mouse, and only a player
// who slid off a control and let go elsewhere meets it.
//
// THE SELECTION IS NOT ASSERTED HERE. The same table has a mouse moved onto a
// region select that item whatever its button is doing, so a gesture that ended
// over the second item has legitimately selected it —
// `pointer/pointer-hover-selects` is the point that grades that, and what this
// one decides is that nothing was ACTIVATED.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_HOW_TO_ITEM, TITLE_NEW_GAME_ITEM } from "../constants";
import {
  captureStill,
  createHarness,
  dragBetweenItems,
  openTitle,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("activates neither item when the two edges land in different regions", async () => {
  openTitle(h);
  assertEqual(
    h.snapshot().screen,
    "title",
    "posing: the screen the gesture is made on",
  );

  // Press inside HOW TO PLAY, carry the mouse into NEW GAME, release there.
  await dragBetweenItems(h, TITLE_HOW_TO_ITEM, TITLE_NEW_GAME_ITEM);
  const after = h.snapshot();

  await h.advance(1);
  // Before the assertion, so a gesture that activated something still leaves the
  // picture of the screen it reached.
  captureStill(h, "title");

  assertEqual(
    after.screen,
    "title",
    `the screen a gesture pressed inside item ${TITLE_HOW_TO_ITEM}'s region ` +
      `and released inside item ${TITLE_NEW_GAME_ITEM}'s left the game on — ` +
      `two edges in different regions activate no item (specs/controls.md), ` +
      `so "howto" means the press's item was activated and "playing" means ` +
      `the release's was`,
  );
});
