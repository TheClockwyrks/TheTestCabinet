// presentation/overlay-shows-screen — the overlay reports the screen and the mode.
//
// THE RULE. `specs/instrumentation.md`, "Diagnostics": "The debug overlay is
// read-only and shows the values the game registers with it as diagnostic
// sources. Register at least: the current `screen` and the deal mode; …". Under
// this engine the panel is the build's own as well — "It draws the registered
// values, it is shown and hidden by the key `specs/controls.md` names, it is off
// when the game starts, and it reads the game without changing it" — so what
// this point decides is that both of those values reach it.
//
// WHAT IT DECIDES, AND WHAT IT LEAVES ALONE. The screen and the deal mode. The
// pile counts are `presentation/overlay-shows-pile-counts`, the drag
// `presentation/overlay-shows-drag`, the cascade
// `presentation/overlay-shows-cascade`, and that watching the panel costs the
// game nothing is `presentation/overlay-changes-nothing`. One source per point,
// so a grade says which registration is missing.
//
// THE SCREEN POSED IS `howto`, AND THAT IS THE POINT. It is neither the screen
// `reset` leaves behind (`title`) nor the one every other check opens
// (`playing`), so a panel that reports the screen reports `howto` and a panel
// carrying a screen name it never read reports something else. A source that
// read the state it was handed is the whole of what specs/instrumentation.md
// asks for, and this is what tells one from a constant.
//
// THE DEAL MODE IS READ AS THE BUILD'S OWN TWO SPELLINGS OF IT. specs/stock.md
// fixes an id (`DEAL_MODE`) and a label (`DEAL_MODE_LABEL`) for the variant a
// run is given, and the snapshot reports both, as `dealMode` and
// `dealModeLabel`. The mode is ONE fact and a build may honestly put either
// spelling on the panel, so the pattern is built from what the snapshot reports
// and accepts both. That those two readings are themselves the specification's
// figures is `draw-one.deal-mode-reported` and `draw-three.deal-mode-reported`,
// which is why no turn count, id or label is written here: this suite is common
// to both variants.
//
// THE VALUE IS READ, NEVER THE NAME, where a build separated the two: a source
// NAMED `howto` reporting something else has not reported the screen.
//
// THE WORLD IT POSES. `reset` and `clearTable`, so all thirteen piles are empty
// and nothing on the table can carry a word this point reads.

import { afterEach, beforeEach, it } from "vitest";
import { fail } from "../assert";
import {
  captureStill,
  createHarness,
  toggleOverlay,
  type Harness,
} from "../harness";
import { assertForm, overlayLines } from "./overlay";

/** The screen posed, which no default and no other check leaves behind. */
const SCREEN = "howto";

/** How the screen id may be written: as itself, however it is punctuated. */
const SCREEN_FORM = /how\W*to/i;

/** One reported spelling of the deal mode, as a pattern over any punctuation. */
function spelling(value: string): RegExp {
  return new RegExp(
    value
      .trim()
      .split(/[^A-Za-z0-9]+/)
      .filter((part) => part !== "")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\W*"),
    "i",
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws the current screen and the deal mode on the overlay", async () => {
  await h.debug.reset();
  await h.debug.clearTable();
  await h.debug.setScreen(SCREEN);

  const reported = await h.snapshot();
  const modes = [reported.dealMode, reported.dealModeLabel].filter(
    (value) => typeof value === "string" && value.trim() !== "",
  );
  if (modes.length === 0) {
    fail(
      "a deal mode to look for on the panel: the snapshot's `dealMode` or its " +
        "`dealModeLabel` (specs/stock.md fixes both for this build's variant, " +
        "and specs/instrumentation.md has the snapshot report them)",
      { dealMode: reported.dealMode, dealModeLabel: reported.dealModeLabel },
    );
  }

  const before = await h.frameCalls();
  await toggleOverlay(h);
  const after = await h.frameCalls();
  await captureStill(h, "overlay");
  const lines = overlayLines(before, after);

  assertForm(lines, SCREEN_FORM, `the current screen, '${SCREEN}'`);
  assertForm(
    lines,
    new RegExp(modes.map((mode) => spelling(mode).source).join("|"), "i"),
    `the deal mode, as the id ${JSON.stringify(reported.dealMode)} or as the ` +
      `label ${JSON.stringify(reported.dealModeLabel)} the snapshot reports ` +
      "for it (specs/stock.md)",
  );
});
