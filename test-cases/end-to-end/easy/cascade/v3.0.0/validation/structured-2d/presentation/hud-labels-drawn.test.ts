// presentation/hud-labels-drawn — each HUD control draws its label.
//
// THE RULE. specs/screens.md, "The HUD": the strip carries three controls,
// `HUD_ITEMS` is `["NEW GAME", "MENU", "SOUND"]`, and "each label is drawn inside
// its own rectangle". The rectangles are `HUD_NEW_GAME`, `HUD_MENU` and
// `HUD_SOUND`, which specs/controls.md fixes and this project's `constants.ts`
// transcribes. A control a player cannot read is a control a player cannot use.
//
// WHAT IT DECIDES, AND WHAT IT LEAVES ALONE. That each of the three literal
// labels is drawn, and drawn inside the rectangle that control answers. What
// each control DOES is the `screens` group's (`hud-new-game-deals`,
// `hud-menu-returns`, `hud-sound-mutes`), and how legibly the labels read
// against the strip is the reviewer's.
//
// HOW A LABEL IS FOUND. Every run of text the frame spelled — its `fillText`
// and `strokeText` calls coalesced into the logical runs they spell, so a label
// letter-spaced a glyph per call is read as the label (`drawnRunSpans`) —
// placed in logical units through the transform and the alignment it was drawn
// with, and matched by SUBSTRING, ignoring case: the copy is the
// specification's, but how a build presents it is the build's, and a label
// commonly carries a marker or padding around it. The run must lie inside its
// own rectangle, which is what separates the three: the rectangles do not
// overlap, so a build that drew all three labels in one place answers for one
// control at most.
//
// THE DEAL-MODE LABEL IS ALSO IN THE STRIP (specs/screens.md), and is neither
// looked for nor disturbed here: it carries none of the three control labels as
// a substring under either deal mode, and `draw-one.mode-label-hud` and
// `draw-three.mode-label-hud` are what decide it.
//
// THE WORLD IT POSES. `openTable` puts the game on the `playing` screen, which
// is the screen the HUD is drawn on, and empties all thirteen piles so nothing
// on the table is drawn near the strip.
// THE REGION IS THE BUILD'S OWN AND IS ASKED FOR. specs/controls.md leaves each
// item's hit region to the build — "Each control occupies a rectangular hit
// region the build lays out, and its label is drawn inside that region" — and
// specs/instrumentation.md has the build report it through `menuItemRect`, so
// this point reads the three regions back and holds each label against the one
// its own item reported. Any layout passes; a build that draws its label away
// from the region it answers on fails.
//

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import { HUD_ITEMS, type Rect } from "../constants";
import {
  captureStill,
  createHarness,
  drawnRunSpans,
  menuRect,
  openTable,
  type Harness,
  type TextSpan,
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

afterEach(() => {
  h?.dispose();
});

it("draws each of the three HUD labels inside its own control's rectangle", async () => {
  openTable(h);
  const calls = await h.drawFrame();
  const spans = drawnRunSpans(h, calls);
  captureStill(h, "hud");

  const inside = (span: TextSpan, rect: Rect): boolean => {
    const slack = overhang(rect.w);
    return (
      span.left >= rect.x - slack &&
      span.right <= rect.x + rect.w + slack &&
      span.y >= rect.y - slack &&
      span.y <= rect.y + rect.h + slack
    );
  };

  for (const [index, label] of HUD_ITEMS.entries()) {
    const control = { label, rect: menuRect(h, index), name: label };
    const wanted = control.label.toLowerCase();
    const found = spans.filter(
      (span) =>
        span.text.toLowerCase().includes(wanted) && inside(span, control.rect),
    );
    assertTrue(
      found.length > 0,
      `a run of text carrying ${JSON.stringify(control.label)} drawn inside ` +
        `${control.name}, the rectangle at (${String(control.rect.x)}, ` +
        `${String(control.rect.y)}) measuring ${String(control.rect.w)} x ` +
        `${String(control.rect.h)} (specs/controls.md: each label is drawn ` +
        "inside its own rectangle) — the frame's runs of text were " +
        `${JSON.stringify(spans.map((span) => span.text))}`,
    );
  }
});
