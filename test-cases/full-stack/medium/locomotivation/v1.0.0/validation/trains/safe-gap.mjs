// Trains: the gap tile between two adjacent parallel tracks is safe. Level 2 has track
// rows 7 and 9 with a safe row-8 gap between them; a worker waiting there survives trains
// passing on either lane (both the scheduled service and a spawned freight).

import { setTile, startFresh, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("trains.safe-gap");

  await startFresh(api, 2);
  await setTile(api, 10, 8); // the safe gap between rows 7 and 9
  await api.call("spawnTrain", { line: 7, orientation: "horizontal", dir: "east", kind: "freight", headPos: 0 });
  await api.call("spawnTrain", { line: 9, orientation: "horizontal", dir: "west", kind: "freight", headPos: 0 });

  await api.step(8.0); // let the trains (and scheduled service) pass right over the worker's column
  const snap = await api.snapshot();
  check.expectEq("the worker survived in the gap (no life lost)", snap.level.lives, 3);
  check.expectEq("the shift is still live", snap.phase, "playing");
  check.expectEq("the worker held its ground in the gap row", Math.floor((snap.worker.y - 80) / 40), 8);

  await liveClip(api, 900);
  return check.verdict();
}
