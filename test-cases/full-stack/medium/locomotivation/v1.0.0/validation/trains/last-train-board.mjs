// Trains: with the quota met, stepping onto a rideable flat-top car boards the last train,
// awards the bonus, and moves the worker to a boarding state while the sim runs on. The
// quota is pre-satisfied; a last train is posed with a flat-top over the worker; a real step
// boards it through the last-train collision code.

import { startFresh, primeQuota, SCORE, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("trains.last-train-board");

  await startFresh(api, 3);
  await primeQuota(api, { delivered: { red: 1, blue: 3 }, uniques: ["u-red"] });
  check.expectEq("the quota is met (but not yet won, a last train is due)", (await api.snapshot()).level.quotaMet, true);
  await api.call("clearCarried");

  // A last train with a flat-top car (spanning x 240..320) over the worker at x=280.
  await api.call("spawnTrain", {
    line: 8, orientation: "horizontal", dir: "east", kind: "freight", headPos: 400,
    isLast: true, consist: ["engine", "flat-top", "flat-top-half", "flat-top"],
  });
  await api.call("setWorker", { x: 280, y: 420 });

  await api.step(1 / 60); // resolve the board through the real collision code
  const boarded = await api.snapshot();
  check.expectEq("stepping onto the flat-top boards the last train", boarded.phase, "boarding");
  check.expectEq("boarding awards the last-train bonus", boarded.level.scoreParts.lastTrain, SCORE.lastTrain);

  const t0 = boarded.simTime;
  await api.step(0.3);
  check.expectGt("the simulation keeps running while the worker rides off", (await api.snapshot()).simTime, t0);

  await liveClip(api, 900);
  return check.verdict();
}
