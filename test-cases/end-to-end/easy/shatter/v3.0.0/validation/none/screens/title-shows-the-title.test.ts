// Shatter — screens/title-shows-the-title: the screen the game opens on draws its
// name and its tagline.
//
// THE RULE. `specs/ui.md` gives the `title` screen a table of elements and fixes the
// copy of two of them: `TITLE_TEXT` (`SHATTER`) and `TAGLINE_TEXT`
// (`GRAVITY WELL SHOOTER`). `title` is also "where the game opens", and
// `specs/instrumentation.md` has `reset()` restore `screen` to `"title"`, so the
// arrangement this reads is the one every player sees first.
//
// TWO READINGS OF ONE FRAME. The game's own state says which screen it is on, and
// the frame's draw calls say what it put on the canvas, so a build that reports a
// title it never draws — or draws one it does not report — fails here rather than
// passing on either half alone.
//
// THE FRAME IS PRESENTED, NOT STEPPED. `presentCalls` redraws the state as it stands
// without running a tick, which is what a check about a SCREEN wants: advancing
// would run the screen's own timers and grade something the item is not about.
//
// MATCHING IS BY SUBSTRING, because how the copy is presented is the build's:
// `specs/ui.md` fixes the words and leaves the palette, the type and the layout
// alone, so a build drawing `SHATTER` inside a longer run has drawn the title the
// specification named. What is NOT allowed to vary is the words themselves.
//
// WHAT THIS ITEM DOES NOT DECIDE. The menu under them — `screens/title-menu-entries`
// — nor which entry is highlighted (`screens/title-menu-highlight`), nor where
// either entry leads.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TAGLINE_TEXT, TITLE_TEXT } from "../constants";
import {
  captureStill,
  createHarness,
  drewText,
  presentCalls,
  type Harness,
} from "../harness";
import { reachTitle } from "./screens";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the title and the tagline on the screen the game opens on", async () => {
  await reachTitle(h);

  const calls = await presentCalls(h);
  await captureStill(h, "title");

  assertEqual(
    drewText(calls, TITLE_TEXT),
    true,
    `the title screen draws "${TITLE_TEXT}" (specs/ui.md)`,
  );
  assertEqual(
    drewText(calls, TAGLINE_TEXT),
    true,
    `the title screen draws "${TAGLINE_TEXT}" (specs/ui.md)`,
  );
});
