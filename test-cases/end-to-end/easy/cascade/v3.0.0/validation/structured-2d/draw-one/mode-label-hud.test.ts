// draw-one/mode-label-hud — the HUD draws the literal DRAW ONE during play.
//
// THE RULE. specs/screens.md has the HUD carry `DEAL_MODE_LABEL` beside its
// three controls, "so the deal mode is visible throughout play", and
// specs/stock.md fixes this build's label as the literal `DRAW ONE`. The HUD is
// drawn on the `playing` screen (specs/screens.md), so what is read here is the
// text one frame of live play drew.
//
// THE LITERAL IS THE WHOLE REQUIREMENT. The common point
// `screens.hud-shows-mode-label` holds the drawn label against the
// `dealModeLabel` the build itself reports, so that pair decides CONSISTENCY;
// this one decides that the literal the specification fixes is the one a Draw
// One build draws.
//
// AND THE HUD ALONE. `draw-one/mode-label-title` reads the same literal on the
// title screen, so a build correct there and wrong here misses one requirement
// rather than two. Where in the strip the label sits, and that the strip clears
// the piles, are the `screens` and `table` groups'; nothing here asks where on
// the screen it landed.
//
// HOW THE TEXT IS READ. specs/screens.md fixes the words and leaves the type,
// the case, and the layout to the build, so the frame's runs of text are joined
// and matched on the label's words in order: a build that draws the label as one
// run and one that draws the two words as two both satisfy the requirement.
//
// THE TABLE IS EMPTY, which is what `openTable` leaves. The HUD is drawn on the
// playing screen whatever the piles hold (specs/screens.md), and the label
// concerns no card, so no card is posed.
//
// THE FIGURE IS WRITTEN OUT RATHER THAN IMPORTED. The build writes its own
// `src/constants.ts` — specs/overview.md asks it for "every figure this
// specification fixes" — and the figure IS this item's requirement, so reading
// it back out of that module would decide the point against whatever the build
// says rather than against the specification: a build that turned the wrong
// number and named it consistently would answer a check sized by its own
// mistake and pass. The literal is written here for the same reason
// `draw-three` writes its own, and for the reason every project in this case
// keeps a `constants.ts` of its own. Checks that merely SIZE a scenario to the
// deal mode still read `snapshot().turnCount`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertMatches } from "../assert";
import {
  captureStill,
  createHarness,
  drawnTextLines,
  openTable,
  type Harness,
} from "../harness";
import { DEAL_MODE_LABEL } from "./constants";

/**
 * `DEAL_MODE_LABEL`'s words, in order, however the build spaces or splits them.
 *
 * The label is one literal, and its WORDS are what a player reads; whether the
 * build draws them in one call, in two, or a glyph at a time is a layout
 * decision specs/screens.md leaves to it, which is why the frame's text is read
 * as the logical runs it spells ({@link drawnTextLines}) rather than as its
 * `fillText` calls. The match is case-insensitive for the same reason, and each
 * end is held to a word boundary so a longer word ending in `ONE` is not read as
 * the label.
 */
const LABEL = new RegExp(
  `(^|[^A-Za-z0-9])${DEAL_MODE_LABEL.trim().split(/\s+/).join("\\s+")}($|[^A-Za-z0-9])`,
  "i",
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws DRAW ONE in the HUD while the game is being played", async () => {
  openTable(h);

  const calls = await h.drawFrame();
  captureStill(h, "hud");

  assertEqual(
    h.snapshot().screen,
    "playing",
    "the screen the HUD is drawn on, which is where its label is read " +
      "(specs/screens.md)",
  );
  assertMatches(
    drawnTextLines(calls).join(" "),
    LABEL,
    `the text a frame of live play drew, which carries ${DEAL_MODE_LABEL}, ` +
      "this build's DEAL_MODE_LABEL (specs/screens.md, specs/stock.md)",
  );
});
