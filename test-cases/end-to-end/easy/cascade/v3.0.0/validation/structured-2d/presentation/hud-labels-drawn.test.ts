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
// `hud-menu-returns`, `hud-sound-toggles`), and whether the labels read against
// the strip is `presentation/text-legible`.
//
// HOW A LABEL IS FOUND. Every `fillText` and `strokeText` the frame made, placed
// in logical units through the transform and the alignment it was drawn with,
// and matched by SUBSTRING, ignoring case: the copy is the specification's, but
// how a build presents it is the build's, and a label commonly carries a marker
// or padding around it. The run must lie inside its own rectangle, which is what
// separates the three: the rectangles do not overlap, so a build that drew all
// three labels in one place answers for one control at most.
//
// THE DEAL-MODE LABEL IS ALSO IN THE STRIP (specs/screens.md), and is neither
// looked for nor disturbed here: it carries none of the three control labels as
// a substring under either deal mode, and `draw-one.mode-label-hud` and
// `draw-three.mode-label-hud` are what decide it.
//
// THE WORLD IT POSES. `openTable` puts the game on the `playing` screen, which
// is the screen the HUD is drawn on, and empties all thirteen piles so nothing
// on the table is drawn near the strip.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import {
  HUD_ITEMS,
  HUD_MENU,
  HUD_NEW_GAME,
  HUD_SOUND,
  type Rect,
} from "../constants";
import {
  captureStill,
  createHarness,
  drawnTextSpans,
  openTable,
  type Harness,
  type TextSpan,
} from "../harness";

/** Each label beside the rectangle specs/screens.md draws it inside. */
const CONTROLS: readonly { label: string; rect: Rect; name: string }[] = [
  { label: HUD_ITEMS[0], rect: HUD_NEW_GAME, name: "HUD_NEW_GAME" },
  { label: HUD_ITEMS[1], rect: HUD_MENU, name: "HUD_MENU" },
  { label: HUD_ITEMS[2], rect: HUD_SOUND, name: "HUD_SOUND" },
];

/**
 * How far a run's glyphs may reach past its rectangle and still be read as
 * inside it, in logical units.
 *
 * Room for the fraction of a unit a face's side bearing and an anti-aliased
 * stem add to a measured run, and nothing more: the narrowest of the three
 * rectangles is `120` units across for a five-letter word, so a build that
 * really set its label inside its control clears this by tens of units, and a
 * build that drew the label somewhere else misses by hundreds.
 */
const INSIDE_SLOP = 4;

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
  const spans = drawnTextSpans(h, calls);
  captureStill(h, "hud");

  const inside = (span: TextSpan, rect: Rect): boolean =>
    span.left >= rect.x - INSIDE_SLOP &&
    span.right <= rect.x + rect.w + INSIDE_SLOP &&
    span.y >= rect.y - INSIDE_SLOP &&
    span.y <= rect.y + rect.h + INSIDE_SLOP;

  for (const control of CONTROLS) {
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
        `${String(control.rect.h)} (specs/screens.md: each label is drawn ` +
        "inside its own rectangle) — the frame's runs of text were " +
        `${JSON.stringify(spans.map((span) => span.text))}`,
    );
  }
});
