// instrumentation/set-menu-index-menu-screens-only — the highlight pose applies
// on the screens that show a menu, and fails loudly on the four that do not.
//
// `specs/instrumentation.md` § The run and the screens: "`setMenuIndex` is the
// one with a screen-dependent domain rather than a screen-dependent effect: the
// entry count it is checked against is the menu the screen showing carries, so on
// one of the four screens carrying no menu — `howto`, `build`, `program`, and
// `run` — there is no entry to name and the call fails loudly." That is the third
// of the three rules above the tables: an operation "fails loudly" on a call that
// names nothing, and what it never does is pass quietly.
//
// ONE REQUIREMENT, READ FROM BOTH ENDS OF THE SAME CALL. The highlight is first
// posed on `select`, whose menu lists the `SITE_COUNT` (`6`) sites
// (`specs/ui.md`), so `3` is inside the domain `setMenuIndex` states. That
// reading is what makes the four that follow mean anything: without it a build
// whose `setMenuIndex` threw everywhere would satisfy every remaining assertion.
// Then each of the four menuless screens — `howto`, `build`, `program`, `run` —
// is shown with `setScreen`, which "sets nothing else", and the same operation is
// called there. It must raise, and the highlight must still read what the select
// screen left it: a build that swallowed the call would leave the same highlight
// and raise nothing, which is the failure this separates out.
//
// The index posed on the menuless screens is `1`, an index every menu in the game
// carries, so what raises can only be that the screen carries no menu at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { createHarness, type Harness, type Screen } from "../harness";

/** Inside the six entries the select screen's menu carries (specs/ui.md). */
const HIGHLIGHT = 3;

/** Posed on each menuless screen: a legal index on every menu in the game. */
const NAMED = 1;

/** The four screens `specs/ui.md` gives no menu. */
const MENULESS: readonly Screen[] = ["howto", "build", "program", "run"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the highlight on a menu screen and fails loudly on a menuless one", async () => {
  await h.debug.setScreen("select");
  await h.debug.setMenuIndex(HIGHLIGHT);
  const onMenu = (await h.snapshot()).menuIndex;

  const raised: boolean[] = [];
  const held: number[] = [];
  for (const screen of MENULESS) {
    await h.debug.setScreen(screen);
    let threw = false;
    try {
      await h.debug.setMenuIndex(NAMED);
    } catch {
      threw = true;
    }
    raised.push(threw);
    held.push((await h.snapshot()).menuIndex);
  }

  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  assertEqual(
    onMenu,
    HIGHLIGHT,
    `the highlight setMenuIndex(${HIGHLIGHT}) sets on the select screen, one ` +
      "of the three that show a menu (specs/instrumentation.md)",
  );
  for (const [index, screen] of MENULESS.entries()) {
    assertEqual(
      raised[index],
      true,
      `setMenuIndex(${NAMED}) on the ${screen} screen to fail loudly: the ` +
        "screen carries no menu, so there is no entry to name " +
        "(specs/instrumentation.md)",
    );
    assertEqual(
      held[index],
      HIGHLIGHT,
      `menuIndex after that refused call on the ${screen} screen: a call that ` +
        "fails reaches nothing (specs/instrumentation.md)",
    );
  }
});
