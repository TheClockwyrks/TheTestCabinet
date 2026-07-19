// Automated validation for the Drag-and-drop sub-item `follows-cursor`.
//
// A held card follows the cursor and floats above the table (detached from its
// source). This drives real pointer input (pointerDown then pointerMove, see
// specs/instrumentation.md): pressing the waste's top card and moving the cursor,
// the drag's reported position must track the cursor and the card must leave its
// source pile. The waits give the video output the card gliding under the cursor.

import { card, pose, wasteTopCenter } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("dragdrop.follows-cursor");

  await pose(api, { waste: [card("spades", 13, true)] }, 1);
  const snap = await api.snapshot();
  const top = wasteTopCenter(snap);
  // Pressing at the card's center offsets the grab by half the card, so the drag's
  // top-left tracks the cursor minus (CARD_W/2, CARD_H/2) = (50, 70).
  const gx = 50;
  const gy = 70;

  await api.call("pointerDown", top.x, top.y);
  await api.wait(150);

  await api.call("pointerMove", 700, 400);
  await api.wait(300);
  let s = await api.snapshot();
  check.expectNe("a card is held after pressing the waste and moving", s.drag, null);
  check.expectEq("the held card is the King", s.drag ? s.drag.cards[0].rank : 0, 13);
  check.expectEq("the card left its source (waste is now empty while held)", s.waste.length, 0);
  check.expectClose("the held card's x tracks the cursor", s.drag ? s.drag.x : NaN, 700 - gx, 0.5);
  check.expectClose("the held card's y tracks the cursor", s.drag ? s.drag.y : NaN, 400 - gy, 0.5);

  await api.call("pointerMove", 950, 220);
  await api.wait(300);
  s = await api.snapshot();
  check.expectClose("the held card follows to a second point (x)", s.drag ? s.drag.x : NaN, 950 - gx, 0.5);
  check.expectClose("the held card follows to a second point (y)", s.drag ? s.drag.y : NaN, 220 - gy, 0.5);

  await api.call("pointerUp", 950, 220);
  await api.wait(150);

  return check.verdict();
}
