// Trains: the freight (slow, long), commuter (medium), and bullet (fast, short) each run
// at their own speed and length. One of each is spawned on a distinct lane and advanced a
// real second; the displacement of each head confirms its speed and the snapshot its length.

import { startFresh, TRAIN, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("trains.speed-length");

  await startFresh(api, 1);
  await api.call("spawnTrain", { line: 3, orientation: "horizontal", dir: "east", kind: "freight", headPos: 0 });
  await api.call("spawnTrain", { line: 6, orientation: "horizontal", dir: "east", kind: "commuter", headPos: 0 });
  await api.call("spawnTrain", { line: 12, orientation: "horizontal", dir: "east", kind: "bullet", headPos: 0 });

  await api.step(1.0); // one real second of travel from headPos 0
  const snap = await api.snapshot();
  const byLine = (line) => snap.trains.find((t) => t.line === line);

  for (const [line, kind] of [[3, "freight"], [6, "commuter"], [12, "bullet"]]) {
    const t = byLine(line);
    check.expectOk(`the ${kind} is on its lane`, !!t);
    if (!t) continue;
    check.expectEq(`the ${kind} kind`, t.kind, kind);
    check.expectClose(`${kind} speed`, t.speed, TRAIN[kind].speed, 0.01);
    check.expectClose(`${kind} length`, t.length, TRAIN[kind].length, 0.01);
    check.expectClose(`${kind} advanced one second at its speed`, t.headPos, TRAIN[kind].speed, 0.5);
  }

  await liveClip(api, 900);
  return check.verdict();
}
