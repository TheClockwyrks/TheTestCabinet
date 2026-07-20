// Automated validation for foes.dropper-reseeds: the packet-dropper falls straight
// down a column, laying a fresh inert node in each empty tile it passes.
//
// A dropper posed at the top of an empty column is the precondition; the reseeding is
// produced by the real updateFoe dropper branch (game.dropNode) as the sim steps.
// After it falls through, the column holds a run of fresh inert nodes.

import { freshBoard, liveClip, tileCX } from "../_helpers.mjs";

const COL = 10;

export default async function drive(api, ttc) {
  const check = ttc.checkOne("foes.dropper-reseeds");

  await freshBoard(api);
  await api.call("spawnFoe", "dropper", { x: tileCX(COL) });

  check.expectEq("the column starts empty", (await api.snapshot()).nodes.filter((n) => n.c === COL).length, 0);

  await api.step(4.2); // let the dropper fall through the reseed rows
  const laid = (await api.snapshot()).nodes.filter((n) => n.c === COL);
  check.expectGt("the dropper lays a run of nodes down its column", laid.length, 8);
  check.expectOk("every laid node is inert (charge 0)", laid.every((n) => n.charge === 0));

  // A live clip of a dropper reseeding a column.
  await freshBoard(api);
  await api.call("spawnFoe", "dropper", { x: tileCX(COL) });
  await liveClip(api, 2200);

  return check.verdict();
}
