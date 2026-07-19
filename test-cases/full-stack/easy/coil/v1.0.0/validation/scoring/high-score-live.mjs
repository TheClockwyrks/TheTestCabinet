// Automated validation for the Scoring sub-item `high-score-live`.
//
// The BEST score updates the instant the current score passes it during play, not
// only at the end of the round. A BEST is first established by playing a real round
// (five eats), then a fresh round starts with the score set just below that BEST (a
// precondition) and a real eat drives the score across it — the live update resolves
// through the real tick and is read back the moment it happens.

import { TICK_DT, eatSequence, hLane, liveClip, beginRound } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("scoring.high-score-live");

  // Establish a BEST by really playing a round.
  await beginRound(api);
  await eatSequence(api, { count: 5 });
  const best0 = (await api.snapshot()).best;
  check.expectGt("a BEST was established by the first round", best0, 0);

  // A fresh round, score set just below the established BEST.
  await api.call("startRound");
  await api.call("setSnake", hLane(10, 8, 3), "right");
  await api.call("setScore", best0 - 5);
  await api.call("setPellet", { col: 11, row: 8 }); // one cell ahead
  check.expectEq("the new round's BEST still shows the established value", (await api.snapshot()).best, best0);

  await api.step(TICK_DT); // a real eat pushes the score past BEST
  const s = await api.snapshot();
  check.expectGt("the current score crossed the old BEST", s.score, best0);
  check.expectEq("BEST updated live to the new score", s.best, s.score);
  check.expectGt("BEST rose from its old value", s.best, best0);

  await liveClip(api, { snake: hLane(3, 8, 3), pellet: { col: 4, row: 8 } });
  return check.verdict();
}
