// instrumentation/reset-restores-the-title-screen — reset puts the player back at
// the top of the game.
//
// THE RULE. "`reset()` — Restores every declared field of the game's state to its
// title-screen value: the title screen with its first menu item highlighted, `mode`
// `campaign`, no challenge open, an empty editor with empty histories, no run, the
// pointer reported as up, `simTime` `0`, the completion switch on, and all progress
// cleared, so nothing is solved, every record and stash is empty, only the first
// campaign challenge is unlocked, and both select screens land on their first row"
// (`specs/instrumentation.md`, Session). The resting values the same file tabulates
// name the rest of what this point reads: `howtoPage` is `0` "away from `howto`",
// and `campaign.last`, `extras.last` and `selectIndex` are `0`.
//
// THIS POINT IS THE SCREEN THE PLAYER IS LOOKING AT and the fields that decide where
// they are: the screen, the highlight on it, the mode, the how-to's page, the row
// each select screen lands on, and the pointer. What reset does to the editor and to
// progress are the two points next door.
//
// THE POSE MOVES EVERY ONE OF THEM FIRST, and off its restored value, so that no
// reading below can pass because it never moved: another mode, another screen,
// another menu item, another how-to page, another select row, another landing row
// for each mode, and the pointer pressed. A build that restored six of the seven
// fails on the seventh.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNotEqual } from "../assert";
import { STAGE_CX, STAGE_CY } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";

/** The menu item, how-to page and select row the pose moves off `0`. */
const POSED_MENU = 2;
const POSED_PAGE = 3;
const POSED_SELECT = 1;

/** The row each mode's select screen is posed to land on. */
const POSED_LAST = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shows the title screen, at its first item, in campaign, with the pointer up", async () => {
  await h.debug.reset();
  const fresh = await h.snapshot();
  assertGreaterThan(
    fresh.campaign.count,
    POSED_LAST,
    "the course has a row after its first for the pose to land on",
  );
  assertGreaterThan(
    fresh.extras.count,
    POSED_LAST,
    "and so does the Extras shelf",
  );

  // Every field this point reads, moved off the value reset restores.
  await h.debug.setMode("extras");
  await h.debug.setScreen("title");
  await h.debug.setMenuIndex(POSED_MENU);
  await h.debug.setScreen("howto");
  await h.debug.setHowtoPage(POSED_PAGE);
  // Read on the how-to itself: `howtoPage` rests at `0` away from that screen.
  assertEqual(
    (await h.snapshot()).howtoPage,
    POSED_PAGE,
    "the how-to is posed on another page",
  );
  await h.debug.setLast("campaign", POSED_LAST);
  await h.debug.setLast("extras", POSED_LAST);
  await h.debug.setScreen("select");
  await h.debug.setSelectIndex(POSED_SELECT);
  await h.debug.pointerDown(STAGE_CX, STAGE_CY);
  await h.advance(1);

  const posed = await h.snapshot();
  assertNotEqual(
    posed.screen,
    "title",
    "the pose is somewhere other than the title",
  );
  assertEqual(posed.mode, "extras", "in the other mode");
  assertEqual(
    posed.campaign.last,
    POSED_LAST,
    "and each select screen landing elsewhere",
  );
  assertEqual(posed.extras.last, POSED_LAST);
  assertEqual(posed.pointer.down, true, "and the pointer pressed");

  await h.debug.reset();
  const reset = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "title");

  assertEqual(reset.screen, "title", "reset shows the title screen");
  assertEqual(reset.menuIndex, 0, "with its first menu item highlighted");
  assertEqual(reset.mode, "campaign", "and the mode back to campaign");
  assertEqual(reset.howtoPage, 0, "the how-to back to its first page");
  assertEqual(
    reset.campaign.last,
    0,
    "the campaign select screen landing on its first row",
  );
  assertEqual(
    reset.extras.last,
    0,
    "and the Extras select screen on its first row",
  );
  assertEqual(reset.selectIndex, 0, "with the highlight on that row");
  assertEqual(reset.pointer.down, false, "and the pointer reported as up");
});
