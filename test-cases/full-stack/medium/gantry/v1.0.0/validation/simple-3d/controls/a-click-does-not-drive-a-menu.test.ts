// controls/a-click-does-not-drive-a-menu — a press on a menu screen moves no
// highlight and takes no entry.
//
// `specs/controls.md` § The actions: "Every action applies where the table says
// and does nothing elsewhere; the menus are driven by the four directions,
// `confirm`, and `back` alone." `specs/ui.md` says the same from the screen's
// side: "The menus are driven by the key actions alone: the pointer operates the
// 3D scene and the tape editor, never a menu."
//
// WHY A GRID RATHER THAN ONE POINT. Where a build draws `select`'s six entries is
// the build's own design, so a check that pressed one chosen point would decide
// nothing about a build that laid its list out somewhere else: it would pass by
// missing. The stage is 1280 by 720 logical units, so a press at each point of a
// sixteen-by-nine grid at eighty-unit spacing lands within forty units of every
// point on it — inside any entry a player could read, wherever the build put it.
// A build that drives its menu with the pointer is pressed on its own entries by
// one of these, and the highlight or the screen moves.
//
// The screen is `select` because it carries the longest menu (`SITE_COUNT`, six
// entries, `specs/ui.md`), so a build that moved its highlight by a row per press
// has the most room to show it. The highlight is put on entry `2`, which is
// neither end: a stray press that moved it either way is visible, and one that
// took the entry would leave `select` for that site's `build` screen.
//
// Each press is a click rather than an orbit drag — the pointer never moves
// between the down and the up, so it never reaches `CLICK_SLOP`
// (`specs/controls.md`) — and a frame runs inside it and after it, so a build
// that acts on the event and a build that acts on the frame that reads it are
// both given their press (`specs/instrumentation.md`).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import { createHarness, runTicks, type Harness } from "../harness";

/** The spacing of the grid of presses, in logical stage units. */
const SPACING = 80;

/** The highlighted entry the presses must leave where it stands. */
const HIGHLIGHT = 2;

/** Every point pressed: the centre of each cell of the grid over the stage. */
const POINTS: readonly (readonly [number, number])[] = Array.from(
  { length: Math.floor(STAGE_W / SPACING) * Math.floor(STAGE_H / SPACING) },
  (_unused, index) => {
    const columns = Math.floor(STAGE_W / SPACING);
    return [
      SPACING / 2 + (index % columns) * SPACING,
      SPACING / 2 + Math.floor(index / columns) * SPACING,
    ] as const;
  },
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the highlight and the screen alone under a press anywhere", async () => {
  await h.debug.setScreen("select");
  await h.debug.setMenuIndex(HIGHLIGHT);
  const posed = await h.snapshot();
  assertEqual(posed.screen, "select", "the menu screen the presses land on");
  assertEqual(posed.menuIndex, HIGHLIGHT, "the highlight the presses start at");

  for (const [x, y] of POINTS) {
    // A click, delivered as `specs/instrumentation.md` states one: "a click is a
    // `pointerDown` followed by a `pointerUp`". The frame inside the press is
    // what a build reading the pointer once a frame sees; the frame after the
    // release is the one such a build acts on.
    await h.pointerDown(x, y);
    await h.advance(1);
    await h.pointerUp();
    const s = await runTicks(h, 1);
    assertEqual(
      s.menuIndex,
      HIGHLIGHT,
      `menuIndex after a press at (${x}, ${y}), which no pointer act reaches ` +
        "(specs/ui.md)",
    );
    assertEqual(
      s.screen,
      "select",
      `the screen after a press at (${x}, ${y}), which takes no menu entry ` +
        "(specs/controls.md)",
    );
  }

  await h.advance(1);
  await h.capture("state", "the select menu after a press at every point");
});
