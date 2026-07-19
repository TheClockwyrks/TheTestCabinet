// Scoring: completing a shift adds a time bonus per second of clock left and a bonus per
// unused life. Level 1 is won with the clock pre-set to 30 s and all three lives intact;
// the completion bonuses are the derived amounts.

import { setTile, startFresh, DT, SCORE } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("scoring.time-lives");

  await startFresh(api, 1);
  await api.call("setDelivered", "red", 2);
  await api.call("setClock", 30);
  await api.call("givePackage", { color: "red", weightClass: "parcel", archetype: "dispenser" });

  await setTile(api, 4, 2); // deliver the winning red
  await api.step(DT);
  const snap = await api.snapshot();
  check.expectEq("the shift completed", snap.phase, "won");
  check.expectEq("the time bonus is 20 per remaining second (~30 s)", snap.level.scoreParts.time, 30 * SCORE.timePerSec);
  check.expectEq("the lives bonus is 500 per unused life (3)", snap.level.scoreParts.lives, 3 * SCORE.livesEach);

  await api.wait(600);
  return check.verdict();
}
