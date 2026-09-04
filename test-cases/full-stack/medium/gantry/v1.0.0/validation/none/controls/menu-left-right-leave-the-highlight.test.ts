// controls/menu-left-right-leave-the-highlight — `left` and `right` reach a menu
// and leave the highlight where it is.
//
// `specs/ui.md` § The screens: "On every menu `up` and `down` move the highlight
// by one entry and wrap at both ends, `confirm` takes the highlighted entry, and
// `left` and `right` reach the menu but leave the highlight where it is."
// `specs/controls.md` § The actions binds the four directions to the arrow keys
// and gives them "menu navigation; camera orbit on the 3D screens".
//
// THE SITE SELECT, AND AN INTERIOR ENTRY. `specs/ui.md` § Site select lists
// `SITE_COUNT` (`6`) sites, so index `3` has entries on both sides of it: a build
// that walked the highlight sideways moves it whichever way it read the key, and
// either direction is visible. On a two-entry menu, or on the first or last
// entry, a build that moved the highlight one way and clamped or wrapped could
// still read back where it started.
//
// BOTH KEYS, BECAUSE THEY ARE ONE REQUIREMENT read the same way: the rule is that
// the pair reaches the menu and moves nothing, and a build that answers one of
// them is as wrong as a build that answers both.
//
// The screen and the highlight are posed with `setScreen` and `setMenuIndex` —
// "shows a named screen and sets nothing else" and "Sets the highlighted entry of
// the menu on the screen showing" — rather than walked there with `down`: the
// direction actions' own movement is another review point, and a build whose menu
// movement is broken must fail that item and be decided fairly on this one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, SITE_COUNT } from "../constants";
import { createHarness, type Harness } from "../harness";

/** The `left` and `right` bindings, as `specs/controls.md` fixes them. */
const LEFT = BINDINGS.left[0]!;
const RIGHT = BINDINGS.right[0]!;

/** An interior entry of the six-entry site list: entries lie on both sides. */
const ENTRY = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the site select's highlight where it stands under left and right", async () => {
  await h.debug.setScreen("select");
  await h.debug.setMenuIndex(ENTRY);
  const posed = await h.snapshot();
  assertEqual(posed.screen, "select", "the menu screen the presses land on");
  assertEqual(posed.menuIndex, ENTRY, "the entry the menu highlights");
  assertEqual(
    SITE_COUNT,
    6,
    "the entries the site select lists (specs/ui.md § Site select)",
  );

  for (const key of [LEFT, RIGHT]) {
    await h.press(key);
    assertEqual(
      (await h.snapshot()).menuIndex,
      ENTRY,
      `menuIndex after ${key} on a menu: \`left\` and \`right\` reach the ` +
        "menu but leave the highlight where it is " +
        "(specs/ui.md § The screens)",
    );
  }

  await h.advance(1);
  await h.capture("state", "the site select's highlight after left and right");
});
