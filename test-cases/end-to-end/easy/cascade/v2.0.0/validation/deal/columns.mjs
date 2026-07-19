// Automated validation for the Deal sub-item `columns`.
//
// A fresh deal lays out seven tableau columns of 1..7 cards, with exactly the top
// card of each face-up and the rest face-down. The real deal runs (a seeded
// `newGame`) and the resulting board is read back from the snapshot.

import { deal, shoot } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("deal.columns");

  const s = await deal(api, 4);

  for (let i = 0; i < 7; i += 1) {
    const col = s.tableau[i];
    check.expectEq(`column ${i + 1} holds ${i + 1} cards`, col.length, i + 1);
    check.expectEq(
      `column ${i + 1}'s top card is face-up`,
      col[col.length - 1].faceUp,
      true,
    );
    let buriedAllDown = true;
    for (let j = 0; j < col.length - 1; j += 1) {
      if (col[j].faceUp) buriedAllDown = false;
    }
    check.expectOk(
      `column ${i + 1}'s buried cards are all face-down`,
      buriedAllDown,
    );
  }

  await shoot(api, "layout");
  return check.verdict();
}
