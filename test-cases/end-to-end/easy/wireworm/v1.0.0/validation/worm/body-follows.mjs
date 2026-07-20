// Automated validation for worm.body-follows: each segment follows the one ahead,
// so consecutive segments stay orthogonally adjacent (one tile apart, never
// diagonal).
//
// A worm is stepped through several tiles (including a turn at a node); the body
// motion is produced by the real advanceBody. Every consecutive segment pair is
// checked to be exactly one orthogonal tile apart.

import { freshBoard, liveClip, setWorm, straightWorm, wormSteps } from "../_helpers.mjs";

function allOrthogonallyAdjacent(worms) {
  for (const w of worms) {
    for (let i = 0; i < w.segments.length - 1; i++) {
      const a = w.segments[i];
      const b = w.segments[i + 1];
      const d = Math.abs(a.c - b.c) + Math.abs(a.r - b.r);
      if (d !== 1) return false; // diagonal (2) or gap (>1) or overlap (0)
    }
  }
  return true;
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("worm.body-follows");

  await freshBoard(api);
  await api.call("setNode", 15, 10, 0); // force a turn partway through
  await setWorm(api, straightWorm(10, 10, 6, 1), 1, 1);

  const snap = await wormSteps(api, 12);
  check.expectGt("the worm is still on the board", snap.worms.length, 0);
  check.expectOk(
    "every consecutive segment pair stays orthogonally adjacent (never diagonal)",
    allOrthogonallyAdjacent(snap.worms),
  );

  await freshBoard(api);
  await api.call("setNode", 15, 10, 0);
  await setWorm(api, straightWorm(10, 10, 6, 1), 1, 1);
  await liveClip(api, 1600);

  return check.verdict();
}
