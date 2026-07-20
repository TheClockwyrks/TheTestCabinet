// Scoring: surviving a brush inside the near-miss margin of a moving car awards a
// living-dangerously bonus. The worker is posed just below a train's lethal band (a 2 px
// gap, inside the 10 px margin) with the train's body over its column; one step brushes it.

import { setPos, startFresh, SCORE, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("scoring.near-miss");

  await startFresh(api, 1);
  // Lane 8's lethal band is y 402..438; the worker's foot top sits at y 440 — a 2 px gap.
  await setPos(api, 220, 450);
  await api.call("spawnTrain", { line: 8, orientation: "horizontal", dir: "east", kind: "freight", headPos: 300 });

  await api.step(1 / 60); // brush past within the margin
  const snap = await api.snapshot();
  check.expectEq("the survived brush is counted a near-miss", snap.level.nearMisses, 1);
  check.expectEq("the near-miss bonus is scored", snap.level.scoreParts.nearMiss, SCORE.nearMiss);
  check.expectEq("the worker survived the brush", snap.phase, "playing");

  await liveClip(api, 600);
  return check.verdict();
}
