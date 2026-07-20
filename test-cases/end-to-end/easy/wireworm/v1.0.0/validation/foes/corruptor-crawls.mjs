// Automated validation for foes.corruptor-crawls: the corruptor crawls horizontally
// across an upper row, holding its row (it does not descend).
//
// A corruptor posed on an upper row is the precondition; its motion is produced by
// the real updateFoe corruptor branch. Its horizontal position advances while its
// vertical position holds at the row.

import { freshBoard, liveClip, tileCY } from "../_helpers.mjs";

const ROW = 3;

export default async function drive(api, ttc) {
  const check = ttc.checkOne("foes.corruptor-crawls");

  await freshBoard(api);
  await api.call("spawnFoe", "corruptor", { row: ROW, x: 100, vx: 130 });

  const before = (await api.snapshot()).foes[0];
  await api.step(1.5);
  const after = (await api.snapshot()).foes[0];

  check.expectGt("the corruptor crawls horizontally", after.x, before.x + 100);
  check.expectClose("it holds its row (does not descend)", after.y, tileCY(ROW), 1);

  await freshBoard(api);
  await api.call("spawnFoe", "corruptor", { row: ROW, x: -16, vx: 130 });
  await liveClip(api, 2000);

  return check.verdict();
}
