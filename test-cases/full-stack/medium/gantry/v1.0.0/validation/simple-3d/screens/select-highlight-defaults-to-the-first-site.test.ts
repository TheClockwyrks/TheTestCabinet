// screens/select-highlight-defaults-to-the-first-site — before any site has been
// opened the highlight sits on the first site.
//
// `specs/ui.md` § The screens, Site select: "On arriving, the highlight sits on
// the site the yard screens last showed (`siteIndex`, `specs/state.md`), which is
// the site at index `0`, `menuIndex` `0`, before any site has been opened."
//
// THE EDGE CASE OF THE ARRIVAL RULE, so it is decided on a game that has opened
// nothing. `reset` is what puts the game back there — "the `title` screen with
// `menuIndex` `0`, site `0` open" (`specs/instrumentation.md`) — and the arrival
// is then made the way a player makes it on a fresh game: `SITES` off the title
// menu, the only route to `select` from a game with no open site behind it.
// `setScreen` could not decide it, because it "sets nothing else" and leaves
// `menuIndex` where it stood, and the requirement is about what an arrival sets.
//
// THE ROUTE COSTS THIS ITEM ONE COUPLING, and it is unavoidable: `select` cannot
// be arrived at any other way from a game that has opened no site. A build whose
// title menu does not open `select` fails that item too, and fails here on the
// screen rather than on the highlight, which is what the message says.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, TITLE_ITEMS } from "../constants";
import { createHarness, type Harness } from "../harness";

/** `confirm`'s binding, as `specs/controls.md` fixes it. */
const CONFIRM = BINDINGS.confirm[0]!;

/** `SITES`, the title menu's first entry, which opens `select`. */
const ENTRY = TITLE_ITEMS.indexOf("SITES");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("highlights the first site on arriving with no site opened", async () => {
  await h.debug.reset();
  await h.debug.setScreen("title");
  await h.debug.setMenuIndex(ENTRY);

  await h.press(CONFIRM);
  const arrived = await h.snapshot();
  await h.advance(1);
  await h.capture("select-default", "The default highlight");

  assertEqual(
    arrived.screen,
    "select",
    "the screen TITLE_ITEMS[0], SITES, opens (specs/ui.md)",
  );
  assertEqual(
    arrived.menuIndex,
    0,
    "the highlighted site on arriving before any site has been opened " +
      "(specs/ui.md)",
  );
});
