// Automated validation for the per-variant Stock-and-waste sub-item `turn-count`.
//
// A stock turn turns exactly the deal mode's turn count of cards onto the waste
// (Draw Three: three; Draw One: one), or all that remain if fewer than the count
// are left. The check reads the build's own `turnCount` from the snapshot, then
// confirms a real turn moves exactly that many — so the one script validates either
// variant. The waits give the video output the visible turning.

import { pose, someCards } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("stock.turn-count");

  // A full stock: one turn should move exactly the turn count.
  await pose(api, { stock: someCards(6) }, 1);
  const tc = (await api.snapshot()).turnCount;
  check.expectGe("the deal mode turns at least one card", tc, 1);

  await api.wait(200);
  await api.call("turnStock");
  await api.wait(500);
  let s = await api.snapshot();
  check.expectEq("a stock turn turns exactly the deal mode's count onto the waste", s.waste.length, tc);
  check.expectEq("the stock shrinks by exactly that count", s.stock.length, 6 - tc);
  check.expectEq("the fanned waste shows exactly the turned count", s.wasteVisibleCount, tc);

  // Fewer cards than the count remain: the turn takes all that are left.
  await pose(api, { stock: someCards(1) }, 1);
  await api.wait(150);
  await api.call("turnStock");
  await api.wait(400);
  s = await api.snapshot();
  check.expectEq("with fewer cards than the turn count, the turn takes all that remain", s.waste.length, 1);
  check.expectEq("the stock is now empty", s.stock.length, 0);

  return check.verdict();
}
