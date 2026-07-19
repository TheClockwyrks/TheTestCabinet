// Automated validation for the Deal sub-item `stock-count`.
//
// After the seven tableau columns take 1+2+...+7 = 28 cards, the remaining 24
// cards form the face-down stock. The real deal runs and the stock is read back.

import { deal, shoot } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("deal.stock-count");

  const s = await deal(api, 7);

  check.expectEq("the stock holds 24 cards after the deal", s.stock.length, 24);
  check.expectOk(
    "every stock card is face-down",
    s.stock.every((c) => c.faceUp === false),
  );

  await shoot(api, "stock");
  return check.verdict();
}
