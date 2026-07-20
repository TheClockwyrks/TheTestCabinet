// Trains: the same seed and the same steps reproduce identical train positions. Level 3 is
// run twice from the same seed for the same time; every scheduled train's position must match.

import { DT, liveClip } from "../_helpers.mjs";

async function runToPositions(api, seconds) {
  await api.reset({ seed: 7 });
  await api.call("startLevel", 3);
  await api.step(seconds);
  const snap = await api.snapshot();
  return snap.trains
    .map((t) => ({ key: `${t.trackId}:${t.line}`, headPos: t.headPos }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.headPos - b.headPos));
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("trains.deterministic");

  const a = await runToPositions(api, 6.0);
  const b = await runToPositions(api, 6.0);

  check.expectEq("both replays hold the same number of trains", a.length, b.length);
  check.expectGt("there is at least one train to compare", a.length, 0);
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    check.expectEq(`train ${i} is the same lane/track`, a[i].key, b[i].key);
    check.expectClose(`train ${i} is at the same position`, a[i].headPos, b[i].headPos, 1e-6);
  }

  await api.step(DT);
  await liveClip(api, 800);
  return check.verdict();
}
