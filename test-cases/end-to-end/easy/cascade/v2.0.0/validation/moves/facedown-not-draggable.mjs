// Automated validation for the Auto-move-and-flip sub-item `facedown-not-draggable`.
//
// A face-down card is never draggable. This drives the game the way a player does —
// through injected pointer input (pointerDown / pointerMove, see
// specs/instrumentation.md) — pressing on a buried face-down card's exposed strip
// and dragging: nothing must lift. As a contrast (so a build that lifts nothing at
// all does not pass by accident), it then grabs the column's face-up bottom card,
// which MUST lift. The waits give the video output visible motion.

import { card, pose, tableauCardCenter, tableauCardTopLeft } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("moves.facedown-not-draggable");

  // Column 0: two buried face-down cards under a face-up 7.
  const col = [card("clubs", 9, false), card("clubs", 8, false), card("spades", 7, true)];
  await pose(api, { tableau: [col] }, 1);
  const cards = (await api.snapshot()).tableau[0];

  // Press on the exposed strip of the upper face-down card (index 1) and drag.
  const downTL = tableauCardTopLeft(0, cards, 1);
  await api.call("pointerDown", downTL.x + 50, downTL.y + 10);
  await api.wait(250);
  await api.call("pointerMove", 700, 400);
  await api.wait(350);
  await api.call("pointerMove", 900, 300);
  await api.wait(300);
  const s1 = await api.snapshot();
  check.expectEq("pressing a face-down card lifts nothing", s1.drag, null);
  await api.call("pointerUp", 900, 300);
  await api.wait(200);

  // Contrast: the face-up bottom card (index 2) IS draggable.
  const upCenter = tableauCardCenter(0, cards, 2);
  await api.call("pointerDown", upCenter.x, upCenter.y);
  await api.wait(200);
  await api.call("pointerMove", 650, 420);
  await api.wait(350);
  const s2 = await api.snapshot();
  check.expectNe("the face-up bottom card DOES lift when dragged", s2.drag, null);
  check.expectEq("and it is the face-up 7", s2.drag ? s2.drag.cards[0].rank : 0, 7);
  await api.call("pointerUp", 650, 420);
  await api.wait(200);

  return check.verdict();
}
