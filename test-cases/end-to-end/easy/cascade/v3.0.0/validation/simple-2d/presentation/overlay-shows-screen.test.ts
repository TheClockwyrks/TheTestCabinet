// presentation/overlay-shows-screen — the overlay reports the screen and the mode.
//
// THE RULE. specs/instrumentation.md, "Diagnostics": "The debug overlay is
// read-only and shows the values the game registers with it as diagnostic
// sources. Register at least: the current `screen` and the deal mode; …". Under
// this engine "Registering those values is the whole of Cascade's part, through
// `InitApi.diagnostics`" — the panel, its `Backquote` key, its default-off state
// and the formatting of every line are the engine's — so what this point decides
// is that the build registered these two sources.
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
// carrying a screen name it never read reports something else. A source that read
// the state it was handed is the whole of what specs/instrumentation.md asks for,
// and this is what tells one from a constant.
//
// THE VALUE IS READ, NEVER THE NAME. A line is `${name}: ${value}` and the name
// is the build's own word, so both readings below are of the value: the screen id
// `specs/screens.md` fixes, and the deal mode `specs/stock.md` fixes for the
// variant this run was given.
//
// THE DEAL MODE COMES OFF THE SNAPSHOT, NOT OUT OF A CONSTANT. This suite is
// common to both variants, so it cannot spell one variant's id, and it must not
// take one from the build's own `src/constants` either — a build with the wrong
// id would then be looked up by its own wrong id and pass. It reads
// `snapshot().dealMode`, the reading `draw-one.deal-mode-reported` and
// `draw-three.deal-mode-reported` separately pin to the specification's figure,
// and asks whether the panel shows that same fact.
//
// THE WORLD IT POSES. `reset` and `clearTable`, so all thirteen piles are empty
// and nothing on the table can carry a figure this point reads.

import { afterEach, beforeEach, it } from "vitest";
import {
  captureStill,
  createHarness,
  drawFrame,
  toggleOverlay,
  type Harness,
} from "../harness";
import { assertForm, overlayLines } from "./overlay";

/** The screen posed, which no default and no other check leaves behind. */
const SCREEN = "howto";

/** How the screen id may be written: as itself, however it is punctuated. */
const SCREEN_FORM = /how\W*to/i;

/**
 * How a deal mode may be written on the panel: as itself, whichever punctuation
 * and case a build chose.
 *
 * Built from the id the snapshot reports rather than written out, so the same
 * pattern reads either variant's build and neither variant's figure is spelled
 * here.
 */
function modeForm(mode: string): RegExp {
  return new RegExp(mode.split(/[^A-Za-z0-9]+/).join("\\W*"), "i");
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the current screen and the deal mode on the overlay", async () => {
  h.debug.reset();
  h.debug.clearTable();
  h.debug.setScreen(SCREEN);

  const dealMode = h.snapshot().dealMode;

  const before = await drawFrame(h);
  const after = await toggleOverlay(h);
  captureStill(h, "overlay");
  const lines = overlayLines(before, after);

  assertForm(lines, SCREEN_FORM, `the current screen, '${SCREEN}'`);
  assertForm(
    lines,
    modeForm(dealMode),
    `the deal mode, as its id ${dealMode} or as the label it draws for it ` +
      "(specs/stock.md)",
  );
});
