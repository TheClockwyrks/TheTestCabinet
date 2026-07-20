// Scoring: boarding the last train awards its one-off bonus. The quota is pre-satisfied, a
// last train is posed with a flat-top over the worker, and a real step boards it.

import { startFresh, primeQuota, SCORE, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("scoring.last-train");

  await startFresh(api, 3);
  await primeQuota(api, { delivered: { red: 1, blue: 3 }, uniques: ["u-red"] });
  await api.call("clearCarried");
  await api.call("spawnTrain", {
    line: 8, orientation: "horizontal", dir: "east", kind: "freight", headPos: 400,
    isLast: true, consist: ["engine", "flat-top", "flat-top-half", "flat-top"],
  });
  await api.call("setWorker", { x: 280, y: 420 }); // over the flat-top car

  await api.step(1 / 60);
  const snap = await api.snapshot();
  check.expectEq("boarding awards the last-train bonus", snap.level.scoreParts.lastTrain, SCORE.lastTrain);
  check.expectGe("the total score includes the bonus", snap.level.score, SCORE.lastTrain);

  await liveClip(api, 700);
  return check.verdict();
}
