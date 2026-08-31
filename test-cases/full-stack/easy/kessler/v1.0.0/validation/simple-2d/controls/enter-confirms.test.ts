// controls/enter-confirms — Enter accepts the highlighted menu entry.
//
// specs/controls.md binds `confirm` to `Space` and `Enter` and, on `title`,
// has "`confirm` accepts it" — the highlighted entry. specs/screens.md fixes
// what accepting the title's first entry does: "`confirm` on `START` starts a
// fresh session and sets `screen` to `playing`".
//
// The title is opened by resetting, so the highlight rests on `START` exactly
// as specs/screens.md says a menu-bearing screen opens, and nothing but the
// one Enter press acts on it. What is decided is the acceptance itself; what
// the fresh session holds is the session-start points' business, so the one
// reading here is the screen the press landed the game on.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { KEYS } from "../constants";
import { openHarness, type Harness } from "../harness";
import { confirmStart } from "./menu";

/** The key this point is about, as `specs/controls.md` binds it. */
const KEY = KEYS.confirm[1];

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("starts a session with Enter on the title's START entry", async () => {
  assertEqual(KEY, "Enter", "the binding this point presses");
  const press = await confirmStart(h, KEY, "start");
  assertEqual(
    press.after.screen,
    "playing",
    "the screen after Enter accepts START",
  );
});
