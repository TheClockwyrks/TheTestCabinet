// draw-one/mode-label-title — the title screen draws the literal DRAW ONE.
//
// THE RULE. specs/screens.md gives the title screen a deal-mode label,
// `DEAL_MODE_LABEL`, "drawn somewhere on the screen so a player sees which deal
// the game is played with", and specs/stock.md fixes this build's label as the
// literal `DRAW ONE`. So what is read here is the text one frame of the title
// screen drew.
//
// THE LITERAL IS THE WHOLE REQUIREMENT. The common point
// `screens.title-shows-mode-label` holds the drawn label against the
// `dealModeLabel` the build itself reports, so that pair decides CONSISTENCY; this
// one decides that the literal the specification fixes is what a Draw One build
// draws. A build that draws `DRAW THREE` consistently everywhere passes there and
// fails here, which is where the fault belongs.
//
// AND THE TITLE SCREEN ALONE. `draw-one/mode-label-hud` reads the same literal
// during play, so a build correct on the title screen and wrong in the HUD misses
// one requirement rather than two.
//
// HOW THE TEXT IS READ. specs/screens.md fixes the words and leaves the type, the
// case, and the layout to the build, so the frame's runs of text are joined and
// matched on the label's words in order: a build that draws the label as one run
// and one that centers the two words as two runs both satisfy the requirement, and
// nothing here asks where on the screen it landed.
//
// THE TABLE IS EMPTY. The screen is posed with `setScreen` rather than left to
// whatever `reset` restored, and all thirteen piles are cleared, so the world
// holds only the screen the requirement is about (specs/instrumentation.md). The
// label concerns no card, so no card is posed.
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
  drawFrame,
  drawnText,
  type Harness,
} from "../harness";
import { DEAL_MODE_LABEL } from "./constants";

/**
 * `DEAL_MODE_LABEL`'s words, in order, however the build spaces or splits them.
 *
 * The label is one literal, and its WORDS are what a player reads; whether the
 * build draws them in one call or in two is a layout decision specs/screens.md
 * leaves to it. The match is case-insensitive for the same reason, and each end is
 * held to a word boundary so a longer word ending in `ONE` is not read as the
 * label.
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

it("draws DRAW ONE on the title screen", async () => {
  h.debug.reset();
  h.debug.setScreen("title");
  h.debug.clearTable();

  const calls = await drawFrame(h);
  captureStill(h, "title");

  assertEqual(
    h.snapshot().screen,
    "title",
    "the screen the game was posed on, which is where the title screen's " +
      "label is read (specs/instrumentation.md)",
  );
  assertMatches(
    drawnText(calls).join(" "),
    LABEL,
    `the text the title screen drew, which carries ${DEAL_MODE_LABEL}, this ` +
      "build's DEAL_MODE_LABEL (specs/screens.md, specs/stock.md)",
  );
});
