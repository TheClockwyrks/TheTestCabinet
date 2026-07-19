// Automated validation for the Stock-and-waste sub-item `recycle-unlimited`.
//
// Recycling has no pass limit: the stock can be emptied and recycled again and
// again. A small stock is turned down to empty and recycled three separate times;
// each recycle must restore the full stock. The real stock code runs each pass, and
// the waits give the video output the visible turning and recycling.

import { pose, someCards } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("stock.recycle-unlimited");

  const count = 3;
  await pose(api, { stock: someCards(count) }, 1);

  for (let pass = 0; pass < 3; pass += 1) {
    // Turn the stock down to empty (one or more clicks, by deal mode).
    let guard = 0;
    while ((await api.snapshot()).stock.length > 0 && guard < 12) {
      await api.call("turnStock");
      await api.wait(240);
      guard += 1;
    }
    // The empty stock recycles the whole waste back for another pass.
    await api.call("turnStock");
    await api.wait(320);
    const s = await api.snapshot();
    check.expectEq(`pass ${pass + 1}: the empty stock recycled the full waste`, s.stock.length, count);
    check.expectEq(`pass ${pass + 1}: the waste emptied on recycle`, s.waste.length, 0);
  }

  return check.verdict();
}
