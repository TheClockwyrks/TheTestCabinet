// Trains: the last train's engine and sealed cars are lethal like any train, even with the
// quota met — only its flat-tops are rideable. Same posed last train as the board check, but
// the worker sits under the ENGINE car, so the real collision kills rather than boards.

import { startFresh, primeQuota, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("trains.last-train-lethal");

  await startFresh(api, 3);
  await primeQuota(api, { delivered: { red: 1, blue: 3 }, uniques: ["u-red"] });
  await api.call("clearCarried");

  // Engine spans x 320..400; the worker sits at x=360, on the sealed engine.
  await api.call("spawnTrain", {
    line: 8, orientation: "horizontal", dir: "east", kind: "freight", headPos: 400,
    isLast: true, consist: ["engine", "flat-top", "flat-top-half", "flat-top"],
  });
  await api.call("setWorker", { x: 360, y: 420 });

  await api.step(1 / 60);
  const snap = await api.snapshot();
  check.expectEq("the sealed engine is lethal even with the quota met", snap.level.lives, 2);
  check.expectOk("the worker died rather than boarded", snap.phase !== "boarding");

  await liveClip(api, 700);
  return check.verdict();
}
