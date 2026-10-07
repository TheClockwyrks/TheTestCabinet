// instrumentation/menu-item-rect-off-a-menu-fails-loudly — the reading is
// called where a menu is showing, for an entry that menu has.
//
// `specs/instrumentation.md` § Readings: "The three screens carrying a menu are
// `title`, `select`, and `results`; called on any of the other four it fails
// loudly, and so does an `index` the menu showing has no entry at." That is the
// file's standing rule applied to this reading — "An argument outside the
// domain its operation states is invalid, and the call fails loudly rather than
// guessing what was meant."
//
// A SILENT ANSWER IS THE FAILURE THIS CATCHES. A build that returned a
// rectangle of zeroes, or `null`, for a screen with no menu hands a caller a
// region that selects nothing, and every check that drove it would report a
// menu fault that belongs here.
//
// The title menu is the one probed past its end, because `specs/ui.md` fixes it
// at two entries; the four screens with no menu are all probed at index `0`,
// which is an entry every menu that exists has. The snapshot is read across
// each refused call, because a reading "moves nothing" whether it answers or
// fails.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, fail } from "../assert";
import { TITLE_ITEMS } from "../constants";
import { createHarness, type Harness } from "../harness";

/** The four screens `specs/ui.md` gives no menu. */
const WITHOUT_A_MENU = ["howto", "build", "program", "run"] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** One call that must fail loudly and leave the game exactly as it stands. */
async function refuses(
  what: string,
  call: () => Promise<unknown>,
): Promise<void> {
  const before = await h.snapshot();
  let threw = false;
  try {
    await call();
  } catch {
    threw = true;
  }
  if (!threw) {
    fail(
      `${what} to fail loudly, the argument being outside the domain the ` +
        "operation states (specs/instrumentation.md)",
      "the call returned instead",
    );
  }
  assertDeepEqual(await h.snapshot(), before, `the game across ${what}`);
}

it("fails loudly off a menu and past a menu's last entry", async () => {
  try {
    await h.debug.setScreen("title");
    assertEqual(
      (await h.snapshot()).screen,
      "title",
      "the menu screen the first two calls are made on",
    );

    await refuses(`menuItemRect(${TITLE_ITEMS.length})`, () =>
      h.debug.menuItemRect(TITLE_ITEMS.length),
    );
    await refuses("menuItemRect(-1)", () => h.debug.menuItemRect(-1));

    for (const screen of WITHOUT_A_MENU) {
      await h.debug.setScreen(screen);
      await refuses(`menuItemRect(0) on ${screen}`, () =>
        h.debug.menuItemRect(0),
      );
    }
  } finally {
    // In a `finally`, so a check that fails still leaves the picture that
    // shows why.
    await h.advance(1);
    await h.capture("state", "The driven state this point decides");
  }
});
