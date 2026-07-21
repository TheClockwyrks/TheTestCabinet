// Automated validation for the Color sub-item `drop-highlight`.
//
// A legal drop target under a held card is drawn in a distinct highlight color. This
// drives real pointer input to hold a King over an empty column (a legal target),
// confirms the game reports that column highlighted, and reads the pixels the build
// actually PAINTS (api.pixel) along the target's outline. To prove it is the HOVER
// that adds the highlight (not merely the column's resting slot outline), the same
// outline is sampled before the drag and while hovering: hovering must introduce a
// pixel that stands clearly farther from the bare felt. The exact highlight hue is
// the model's own; only that a distinct highlight is drawn on hover is scored.
//
// Every pause here is `api.settle`, not `api.advance`: each one exists so a frame can
// PAINT before the outline is sampled, and stepping the simulation produces no frame
// (in the validate pass it consumes no wall clock at all). `settle` is real
// milliseconds in both passes, so the original numbers carry over unconverted. The
// resting sample now comes after its settle rather than before it, so both readings
// are taken from a painted frame — the felt and the resting outline are unchanged
// either way, so no operand moves.

import {
  card,
  COLS_X,
  colorDistance,
  pose,
  sampleColor,
  TABLEAU_Y,
  wasteTopCenter,
} from "../_helpers.mjs";

// The outline of the last column's slot: its top edge, scanned across its width. The
// highlight stroke, if drawn, straddles this line.
const OUTLINE = [];
for (let x = COLS_X[6] + 6; x <= COLS_X[6] + 94; x += 4) {
  for (const y of [
    TABLEAU_Y - 1.5,
    TABLEAU_Y - 0.5,
    TABLEAU_Y + 0.5,
    TABLEAU_Y + 1.5,
  ]) {
    OUTLINE.push([x, y]);
  }
}

async function maxDistanceFromFelt(api, felt) {
  let best = 0;
  for (const [x, y] of OUTLINE) {
    const p = await api.pixel(x / 1280, y / 720);
    const d = colorDistance({ r: p.r, g: p.g, b: p.b }, felt);
    if (d > best) best = d;
  }
  return best;
}

export default function item() {
  let top;
  // The outline's distance from the felt at rest and while hovering, and the
  // highlight the game reports under the held King.
  let restingMax;
  let hoverMax;
  let s;

  return {
    id: "color.drop-highlight",

    // A King on the waste; every column empty (a King's legal target is an empty one).
    async arrange(api) {
      await pose(api, { waste: [card("spades", 13, true)] }, 1);
      top = wasteTopCenter(await api.snapshot());
    },

    async act(api) {
      await api.settle(80); // let the posed table paint before any pixel is read
      const felt = await sampleColor(api, COLS_X[6] + 50, TABLEAU_Y + 200);
      restingMax = await maxDistanceFromFelt(api, felt); // slot outline, no hover

      await api.call("pointerDown", top.x, top.y);
      await api.settle(120); // let the lifted card draw
      await api.call("pointerMove", COLS_X[6] + 50, TABLEAU_Y + 70); // hold over the empty column
      await api.settle(200); // let the highlight draw before sampling it
      s = await api.snapshot();

      hoverMax = await maxDistanceFromFelt(api, felt);

      await api.screenshot("highlight");
      await api.call("pointerUp", COLS_X[6] + 50, TABLEAU_Y + 70);
    },

    async assert(api, check) {
      check.expectEq(
        "the empty column is highlighted as a legal target",
        s.dropHighlight ? s.dropHighlight.column : -1,
        6,
      );

      check.expectGt(
        "a distinct highlight color is drawn around the legal target",
        hoverMax,
        60,
      );
      check.expectGt(
        "the highlight is what the hover adds (beyond the resting slot)",
        hoverMax - restingMax,
        25,
      );
    },
  };
}
