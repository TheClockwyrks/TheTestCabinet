// instrumentation/set-menu-index-menu-screens-only — the highlight pose applies
// on the screens that show a menu and does nothing on the four that do not.
//
// `specs/instrumentation.md` § The run and the screens: "The first eight of these
// apply on every screen, `setMenuIndex` aside: it applies on the three screens
// that show a menu — `title`, `select`, and `results` — and does nothing on the
// other four, whatever the index." The general rule above the tables says the
// same of every pose: "Each pose applies on the screens its section names and
// does nothing on any other, exactly as the control it stands for does."
//
// ONE REQUIREMENT, READ FROM BOTH ENDS OF THE SAME CALL. The highlight is first
// posed on `select`, whose menu lists the `SITE_COUNT` (`6`) sites
// (`specs/ui.md`), so `3` is inside the domain `setMenuIndex` states. That
// reading is what makes the four that follow mean anything: without it a build
// whose `setMenuIndex` did nothing anywhere would satisfy every remaining
// assertion. Then each of the four menuless screens — `howto`, `build`,
// `program`, `run` — is shown with `setScreen`, which "sets nothing else", and
// the same operation is called there with a different index. The highlight must
// still read what the select screen left it.
//
// The index posed on the menuless screens is `1`, an index every menu in the game
// carries, so a build cannot be failing the call as out of domain rather than
// ignoring it — what is under test is that it is ignored.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { createHarness, type Harness, type Screen } from "../harness";

/** Inside the six entries the select screen's menu carries (specs/ui.md). */
const HIGHLIGHT = 3;

/** Posed on each menuless screen: a legal index on every menu in the game. */
const IGNORED = 1;

/** The four screens `specs/ui.md` gives no menu. */
const MENULESS: readonly Screen[] = ["howto", "build", "program", "run"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the highlight on a menu screen and does nothing on a menuless one", async () => {
  await h.debug.setScreen("select");
  await h.debug.setMenuIndex(HIGHLIGHT);
  const onMenu = (await h.snapshot()).menuIndex;

  const held: number[] = [];
  for (const screen of MENULESS) {
    await h.debug.setScreen(screen);
    await h.debug.setMenuIndex(IGNORED);
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
      held[index],
      HIGHLIGHT,
      `menuIndex after setMenuIndex(${IGNORED}) on the ${screen} screen, ` +
        "which shows no menu, so the call does nothing whatever the index " +
        "(specs/instrumentation.md)",
    );
  }
});
