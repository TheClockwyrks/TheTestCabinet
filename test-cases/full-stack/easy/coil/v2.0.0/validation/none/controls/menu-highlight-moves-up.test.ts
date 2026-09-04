// controls/menu-highlight-moves-up — up moves the highlight back one item.
//
// specs/controls.md, on a menu-bearing screen: `up` "Moves the highlight up one
// item, wrapping at the ends." The wrap is `controls/menu-highlight-wraps-up`;
// what is decided here is the ordinary move, away from either end, which is the
// half of the action a player spends nearly all of their presses on.
//
// THE MENU IS THE PAUSE MENU, whose `PAUSE_ITEMS` specs/ui.md fixes at three
// entries, and the highlight is posed onto the LAST of them. On a two-item menu
// every `up` is also a wrap, so a three-item menu is what separates the move from
// the wrap: index `2` to index `1` touches neither end.
//
// The round behind the pause is posed with the chain held still and nothing on
// the board, so nothing can end it underneath the press.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { KEY, PAUSE_ITEMS } from "../constants";
import {
  HOME_HEAD,
  captureStill,
  chainFrom,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";

/** The last item of the pause menu, which specs/ui.md gives three entries. */
const FROM = PAUSE_ITEMS.length - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the highlight back one item on up, away from the ends", async () => {
  const paused = await poseScene(h, {
    screen: "paused",
    menuIndex: FROM,
    snake: chainFrom(HOME_HEAD, "right", 4),
    dir: "right",
    pellet: null,
    travel: false,
  });
  assertEqual(paused.screen, "paused", "the screen the key is pressed on");
  assertEqual(paused.menuIndex, FROM, "the highlighted item before the press");

  await h.tap(KEY.up);
  await captureStill(h, "moved");

  assertEqual(
    (await h.snapshot()).menuIndex,
    FROM - 1,
    "the highlighted item after up from the last item of a three-item menu",
  );
});
