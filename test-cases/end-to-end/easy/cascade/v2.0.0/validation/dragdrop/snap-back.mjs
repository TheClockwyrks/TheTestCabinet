// Automated validation for the Drag-and-drop sub-item `snap-back`.
//
// Releasing a card over an illegal spot returns it to its origin. This drives real
// pointer input: holding a red 6 over a column showing a RED 7 (an illegal target —
// same color) and releasing there, the card must snap back to the waste, leaving
// both piles unchanged. The waits give the video output the pick-up, the illegal
// hover, and the snap-back.

import { card, cardCenter, COLS_X, pose, TABLEAU_Y, wasteTopCenter } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("dragdrop.snap-back");

  // A red 6 on the waste; column 0 exposes a red 7 (an illegal, same-color target).
  await pose(api, { tableau: [[card("hearts", 7, true)]], waste: [card("hearts", 6, true)] }, 1);
  const top = wasteTopCenter(await api.snapshot());

  await api.call("pointerDown", top.x, top.y);
  await api.wait(150);

  const target = cardCenter(COLS_X[0], TABLEAU_Y);
  await api.call("pointerMove", target.x, target.y);
  await api.wait(350);
  const held = await api.snapshot();
  check.expectEq("no legal target is highlighted over the same-color card", held.dropHighlight, null);

  // Release over the illegal target: the card snaps back to the waste.
  await api.call("pointerUp", target.x, target.y);
  await api.wait(300);
  const s = await api.snapshot();
  check.expectEq("nothing is held after the release", s.drag, null);
  check.expectEq("the card snapped back to the waste", s.waste.length, 1);
  check.expectEq("it is the red 6 again", s.waste[s.waste.length - 1].rank, 6);
  check.expectEq("the illegal target column is unchanged", s.tableau[0].length, 1);

  return check.verdict();
}
