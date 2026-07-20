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

import { card, COLS_X, colorDistance, pose, sampleColor, TABLEAU_Y, wasteTopCenter } from "../_helpers.mjs";

// The outline of the last column's slot: its top edge, scanned across its width. The
// highlight stroke, if drawn, straddles this line.
const OUTLINE = [];
for (let x = COLS_X[6] + 6; x <= COLS_X[6] + 94; x += 4) {
  for (const y of [TABLEAU_Y - 1.5, TABLEAU_Y - 0.5, TABLEAU_Y + 0.5, TABLEAU_Y + 1.5]) {
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

export default async function drive(api, ttc) {
  const check = ttc.checkOne("color.drop-highlight");

  // A King on the waste; every column empty (a King's legal target is an empty one).
  await pose(api, { waste: [card("spades", 13, true)] }, 1);
  const top = wasteTopCenter(await api.snapshot());

  const felt = await sampleColor(api, COLS_X[6] + 50, TABLEAU_Y + 200);
  await api.wait(80);
  const restingMax = await maxDistanceFromFelt(api, felt); // slot outline, no hover

  await api.call("pointerDown", top.x, top.y);
  await api.wait(120);
  await api.call("pointerMove", COLS_X[6] + 50, TABLEAU_Y + 70); // hold over the empty column
  await api.wait(200);
  const s = await api.snapshot();
  check.expectEq("the empty column is highlighted as a legal target", s.dropHighlight ? s.dropHighlight.column : -1, 6);

  const hoverMax = await maxDistanceFromFelt(api, felt);
  check.expectGt("a distinct highlight color is drawn around the legal target", hoverMax, 60);
  check.expectGt("the highlight is what the hover adds (beyond the resting slot)", hoverMax - restingMax, 25);

  await api.screenshot("highlight");
  await api.call("pointerUp", COLS_X[6] + 50, TABLEAU_Y + 70);
  return check.verdict();
}
