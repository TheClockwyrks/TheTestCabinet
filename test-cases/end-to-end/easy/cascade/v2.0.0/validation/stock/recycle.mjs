// Automated validation for the Stock-and-waste sub-item `recycle`.
//
// When the stock is empty, clicking it recycles the whole waste back into the stock,
// face-down, preserving order for another pass. The real stock code runs (an empty
// stock + a non-empty waste), and the recycled stock is read back: the same cards,
// all face-down, in the order that re-emerges as the original sequence next pass.

import { card, pose, shoot } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("stock.recycle");

  // An empty stock and a three-card waste (bottom -> top).
  const waste = [card("hearts", 5, true), card("clubs", 9, true), card("spades", 2, true)];
  await pose(api, { waste }, 1);

  await api.call("turnStock"); // stock is empty -> recycle the waste
  const s = await api.snapshot();

  check.expectEq("the whole waste recycled into the stock", s.stock.length, 3);
  check.expectEq("the waste is now empty", s.waste.length, 0);
  check.expectOk("every recycled card is face-down", s.stock.every((c) => c.faceUp === false));

  // Order is preserved for the next pass: turning the stock again re-emerges the
  // cards in the original order, so the recycled stock (bottom -> top) is the
  // reverse of the original waste (bottom -> top).
  const stockOrder = s.stock.map((c) => `${c.suit}${c.rank}`).join(",");
  const expected = waste.slice().reverse().map((c) => `${c.suit}${c.rank}`).join(",");
  check.expectEq("the recycled order is preserved for the next pass", stockOrder, expected);

  await shoot(api, "recycle");
  return check.verdict();
}
