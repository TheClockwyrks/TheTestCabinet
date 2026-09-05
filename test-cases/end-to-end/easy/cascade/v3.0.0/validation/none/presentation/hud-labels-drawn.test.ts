// presentation/hud-labels-drawn — each HUD control draws its own label.
//
// THE RULE. `specs/screens.md` gives the HUD three controls, `HUD_ITEMS`
// (`["NEW GAME", "MENU", "SOUND"]`), and `specs/controls.md` says of every one of
// them: "Each control occupies a rectangular hit region the build lays out, and
// its label is drawn inside that region." The region is what the control answers
// a gesture in, so a label drawn anywhere else points a player at a place that
// does nothing.
//
// THE REGION IS THE BUILD'S OWN AND IS ASKED FOR. `specs/instrumentation.md` has
// the build report each item's region through `menuItemRect`, so this point reads
// the three regions back and holds each label against the one its own item
// reported. Any layout passes; a build that draws its label away from the region
// it answers on fails.
//
// WHAT IT DECIDES, AND WHAT IT LEAVES ALONE. That each of the three labels is
// drawn, and drawn inside its own rectangle. Not how legibly it reads against
// what it sits on, which is the reviewer's; not what a click on it
// DOES, which is `screens.hud-new-game-deals`, `screens.hud-menu-returns` and
// `screens.hud-sound-mutes`; and not the deal-mode label the strip also
// carries, which is `screens.hud-shows-mode-label` and which specs/screens.md
// gives no rectangle of its own.
//
// ALL THREE, BECAUSE THE RULE IS ABOUT A CONTROL and there are three of them;
// the failure names the one whose label was missing or misplaced.
//
// HOW A LABEL IS MATCHED. Case-insensitively, and as part of a run rather than
// as the whole of it: the copy is the case's, fixed in specs/screens.md as
// `HUD_ITEMS`, but how a build presents it is the build's, and a label is
// commonly drawn with a marker or a bullet beside it. Where the run sits is read
// through the transform and the alignment the build drew it with, so a build is
// free to lay its strip out however it likes.
//
// THE WORLD IT POSES. `openTable` and nothing else: an empty table in play,
// which is the screen specs/screens.md draws the HUD on. Nothing is posed onto
// the table, so no card's rank can be read as a label, and the debug overlay is
// off, as specs/controls.md has it when the game starts.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import { HUD_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  menuRect,
  openTable,
  pointInRect,
  textDraws,
  type Harness,
} from "../harness";

/**
 * How far a run's glyphs may reach beyond its control's rectangle and still be
 * read as inside it, as a share of that rectangle.
 *
 * Not a layout tolerance: it is the difference between the advance width a font
 * reports for a run, which is what places the run here, and the ink the glyphs
 * actually lay down, which is a little narrower and can sit a fraction either
 * side of it. `specs/controls.md` leaves the rectangle to the build — "Each
 * control occupies a rectangular hit region the build lays out" — so the
 * allowance is taken from the region the build itself reported rather than from
 * a width the specification no longer fixes. A twentieth of it, never less than
 * one unit, leaves a label drawn in a different control or outside the strip
 * altogether missing by the width of a control.
 */
const OVERHANG_SHARE = 0.05;
const OVERHANG_FLOOR = 1;

/** That allowance for one reported region. */
function overhang(w: number): number {
  return Math.max(OVERHANG_FLOOR, w * OVERHANG_SHARE);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws each of the three HUD labels inside its own rectangle", async () => {
  await openTable(h);
  const spans = textDraws(await h.frameCalls());
  await captureStill(h, "hud");

  const drew =
    spans
      .map(
        (span) =>
          `${JSON.stringify(span.text)} at (${span.x.toFixed(0)}, ` +
          `${span.y.toFixed(0)})`,
      )
      .join(", ") || "no text at all";

  for (const [index, label] of HUD_ITEMS.entries()) {
    const rect = await menuRect(h, index);
    const slack = overhang(rect.w);
    const inside = spans.filter(
      (span) =>
        span.text.toLowerCase().includes(label.toLowerCase()) &&
        pointInRect((span.left + span.right) / 2, span.y, rect) &&
        span.left >= rect.x - slack &&
        span.right <= rect.x + rect.w + slack,
    );
    assertTrue(
      inside.length > 0,
      `the label ${JSON.stringify(label)} drawn inside its own rectangle, ` +
        `{ x: ${String(rect.x)}, y: ${String(rect.y)}, w: ${String(rect.w)}, ` +
        `h: ${String(rect.h)} } (specs/controls.md: each label is drawn inside ` +
        `its own rectangle) — the frame drew ${drew}`,
    );
  }
});
