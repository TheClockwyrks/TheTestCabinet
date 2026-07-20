// Automated validation for the Ordered-runs sub-item `move-unit`.
//
// A descending, alternating-color run of face-up cards moves together as a unit,
// carrying every card above the grabbed card with it. Grabbing the bottom of a
// three-card run (red 9, black 8, red 7) and dropping it onto a black 10 moves all
// three. The real move runs and both columns are read back.

import { card, pose, shoot } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("runs.move-unit");

  // Column 0 holds a valid run 9-8-7 (red/black/red); column 1 exposes a black 10.
  await pose(
    api,
    {
      tableau: [
        [card("hearts", 9, true), card("spades", 8, true), card("diamonds", 7, true)],
        [card("clubs", 10, true)],
      ],
    },
    1,
  );

  // Grab the run at its bottom (row 0) and drop it onto column 1.
  const ok = await api.call(
    "move",
    { pile: "tableau", column: 0, row: 0 },
    { pile: "tableau", column: 1 },
  );
  const s = await api.snapshot();

  check.expectEq("the run is accepted onto the black 10", ok, true);
  check.expectEq("the source column is now empty", s.tableau[0].length, 0);
  check.expectEq("all three cards moved onto column 1 (10 + the run)", s.tableau[1].length, 4);
  const c1 = s.tableau[1];
  check.expectEq("the run's head (9) sits on the 10", c1[1].rank, 9);
  check.expectEq("then the 8", c1[2].rank, 8);
  check.expectEq("then the 7 on top", c1[3].rank, 7);

  await shoot(api, "run");
  return check.verdict();
}
