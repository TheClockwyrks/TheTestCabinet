// Automated validation for the Victory-cascade sub-item `retire`.
//
// Every card carries a minimum horizontal speed, so each drifts off a side edge and
// retires; when all 52 have launched and retired, the cascade completes (specs/
// victory.md). A live clip first shows the cards flying off, then the sim is stepped
// far under the manual clock to run the cascade to completion, and the completed
// state is read back.

import { TOTAL_CARDS, winBoard } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("cascade.retire");

  await winBoard(api, 9);

  // Live clip: let the cascade run in real time so the video shows cards launching
  // and drifting off the edges.
  await api.call("setAutoStep", true);
  await api.wait(4000);
  await api.call("setAutoStep", false);

  // Run it to completion deterministically (well past the ~9.4 s of launches plus
  // the last card's flight).
  await api.step(40);
  const s = await api.snapshot();

  check.expectEq("all 52 cards launched", s.cascade.launched, TOTAL_CARDS);
  check.expectEq("the launch total is 52", s.cascade.total, TOTAL_CARDS);
  check.expectEq("no cards remain in flight (all retired)", s.cascade.flyers.length, 0);
  check.expectEq("the cascade is complete", s.cascade.done, true);

  return check.verdict();
}
