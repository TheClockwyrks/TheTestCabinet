// Automated validation for the Ordered-runs sub-item `king-run-empty`.
//
// A run headed by a King may move onto an empty column (the empty-column rule
// applies to the run's head). Grabbing a King-Queen run and dropping it onto an
// empty column moves both. The real move runs and both columns are read back.

import { card, pose, shoot } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("runs.king-run-empty");

  // Column 0 holds a King-Queen run (black K, red Q); column 1 is empty.
  await pose(
    api,
    { tableau: [[card("spades", 13, true), card("hearts", 12, true)]] },
    1,
  );

  const ok = await api.call(
    "move",
    { pile: "tableau", column: 0, row: 0 },
    { pile: "tableau", column: 1 },
  );
  const s = await api.snapshot();

  check.expectEq("the King-headed run is accepted onto the empty column", ok, true);
  check.expectEq("the source column is now empty", s.tableau[0].length, 0);
  check.expectEq("both cards moved onto column 1", s.tableau[1].length, 2);
  check.expectEq("the King leads", s.tableau[1][0].rank, 13);
  check.expectEq("the Queen follows", s.tableau[1][1].rank, 12);

  await shoot(api, "king-run");
  return check.verdict();
}
