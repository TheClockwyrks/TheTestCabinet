// Automated validation for camera.lead-descend.
//
// A sustained descent rides the miner toward the top of the view (so what's below shows earlier) and
// a sustained climb toward the bottom, rather than pinning it dead-centre. We measure the miner's
// on-screen vertical position (as a fraction of the mine viewport) after a long fall and a long climb.

import { K, newRun, openColumn, solid, MINER_H, VIEWPORT_Y, TILE, SPAWN_COL, liveClip } from "../_helpers.mjs";

const VIEWPORT_H = 664;

function screenFrac(snap) {
  const centerY = snap.miner.y + MINER_H / 2;
  return (VIEWPORT_Y + centerY - snap.camera.y - VIEWPORT_Y) / VIEWPORT_H;
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("camera.lead-descend");
  const col = SPAWN_COL;

  await newRun(api);

  // Sustained descent.
  await api.call("teleport", col, 120);
  await openColumn(api, col, 121, 170);
  await solid(api, col, 171);
  await api.step(2.5);
  const fall = screenFrac(await api.snapshot());

  // Sustained climb.
  await api.call("teleport", col, 300);
  await openColumn(api, col, 250, 300);
  await solid(api, col, 301);
  await api.call("setFuel", 999);
  await api.call("keyDown", K.thrust);
  await api.step(2.5);
  const climb = screenFrac(await api.snapshot());
  await api.call("keyUp", K.thrust);

  check.expectLt("a sustained fall rides the miner toward the top", fall, 0.45);
  check.expectGt("a sustained climb rides the miner toward the bottom", climb, 0.55);
  check.expectGt("the lead reverses direction with travel", climb - fall, 0.15);
  void TILE;

  await liveClip(api, 600);
  return check.verdict();
}
