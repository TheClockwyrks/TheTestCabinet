// presentation/text-legible — text reads against what it sits on.
//
// THE RULE. specs/overview.md's legibility table, the row "Text": "Every
// screen's text, and the label of every HUD control, is legible against its
// background at the logical stage size." specs/screens.md says the same of every
// screen: "Every piece of text a screen shows is legible against whatever sits
// behind it at the logical stage size."
//
// WHAT IT DECIDES, AND WHAT IT LEAVES ALONE. The CONTRAST of every run of text
// the title screen draws and of every run the HUD strip draws. WHICH strings are
// drawn is the `screens` group's question — `screens.title-shows-title`,
// `title-shows-tagline`, `title-shows-new-game`, `hud-shows-mode-label` — and is
// deliberately not decided again here, so a build that draws no text at all is
// docked there and once. This point is the legibility table's Text row, which no
// other item carries.
//
// HOW A RUN IS READ. Every `fillText` and `strokeText` the frame made, placed in
// logical units through the transform and the alignment it was drawn with, so a
// build is free to set its type in any face, at any size, anywhere on the
// screen. The reading is taken inside the run's own box and nowhere else,
// because what a build draws a string ON is the build's: felt on one screen, a
// panel on another. The colour the box is MOSTLY painted in is what the run sits
// on — glyphs cover a minority of a line of text at any size — and the sample
// furthest from it is the ink. A build that drew its text in the colour behind
// it reads `0`, whatever that colour was.
//
// THE TWO SCREENS ARE READ SEPARATELY, because "its background" differs between
// them and a run has to be read against what is actually behind it. The title
// screen is read whole; on the playing screen only the HUD strip is, which
// specs/table.md fixes as the band `STAGE_W` wide at `HUD_Y` (`680`), `HUD_H`
// (`36`) tall. The cards' own ranks are drawn on the table above that band and
// are the "A card face" row's business, not this one's.
//
// THE WORLD IT POSES. `reset` for the title screen, which leaves every pile
// empty, and `openTable` for the HUD, which empties them again. So nothing on
// the table can sit behind a run of text and change what it is read against.
//
// THE STILL is the title screen, which carries most of the strings; the HUD's
// three labels are pictured by `presentation/hud-labels-drawn`.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { HUD_H, HUD_Y } from "../constants";
import {
  captureStill,
  createHarness,
  drawnTextSpans,
  openTable,
  resetTo,
  type Harness,
  type TextSpan,
} from "../harness";
import { spanContrast } from "./reading";

/**
 * How far a run of text must read from what it was drawn on, in RGB distance out
 * of `441`.
 *
 * The review item's own figure. specs/overview.md requires every string to be
 * "legible against its background at the logical stage size" and fixes no
 * colour, so the bar is what a measurement can honestly call readable rather
 * than a shade on a shade: `60` is about a seventh of the scale. Type carries
 * its meaning in thin strokes, so this is a floor a build clears by a wide
 * margin whenever it has chosen an ink and a ground at all. The `none` and
 * `simple-2d` suites hold the same requirement to the same figure.
 */
const LEGIBLE_MIN = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws every title-screen string and every HUD label against a background it reads on", async () => {
  const assertLegible = (span: TextSpan, where: string): void => {
    assertGreaterThanOrEqual(
      spanContrast(h, span),
      LEGIBLE_MIN,
      `the contrast of ${JSON.stringify(span.text)} against what it was drawn ` +
        `on ${where}, out of 441 (specs/overview.md: every screen's text, and ` +
        "the label of every HUD control, is legible against its background at " +
        "the logical stage size)",
    );
  };

  resetTo(h);
  const title = await h.drawFrame();
  captureStill(h, "text");
  for (const span of drawnTextSpans(h, title)) {
    assertLegible(span, "on the title screen");
  }

  openTable(h);
  const playing = await h.drawFrame();
  const onStrip = drawnTextSpans(h, playing).filter(
    (span) => span.y >= HUD_Y && span.y <= HUD_Y + HUD_H,
  );
  for (const span of onStrip) {
    assertLegible(span, "in the HUD strip");
  }
});
