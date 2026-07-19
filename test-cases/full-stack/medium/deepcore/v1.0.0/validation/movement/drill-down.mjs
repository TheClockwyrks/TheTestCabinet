// Automated validation for movement.drill-down.
//
// Holding down over solid rock drills the tile below: the miner SINKS into it as it cuts
// (drilling.progress rises, the miner's y advances a fraction of a tile — never a whole-tile
// teleport-snap) and the tile becomes open tunnel when it breaks. teleport/setTile only
// arrange a known shaft; the real drill system produces the outcome, read back from
// snapshot()/tileAt().

import { K, newRun, standAt, solid, TILE, TOPSOIL_ROW, SPAWN_COL, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("movement.drill-down");
  const col = SPAWN_COL;
  const row = TOPSOIL_ROW;

  await newRun(api);
  await standAt(api, col, row); // grounded on a rock floor at (col, row+1)
  await solid(api, col, row + 2); // solid below the target, so the shaft is continuous
  const pre = await api.call("tileAt", col, row + 1);
  check.expectOk("the tile below starts as minable rock", pre && pre.kind === "rock");

  const y0 = (await api.snapshot()).miner.y;
  await api.call("keyDown", K.down);
  await api.step(0.25); // partway through the ~0.5s topsoil cut
  const mid = (await api.snapshot()).miner;
  check.expectOk("a down cut is under way", !!mid.drilling && mid.drilling.dir === "down");
  check.expectGt("the cut has made progress", mid.drilling ? mid.drilling.progress : 0, 0.05);
  check.expectLt("the tile has not broken yet", mid.drilling ? mid.drilling.progress : 1, 0.98);
  const dyMid = mid.y - y0;
  check.expectGt("the miner has sunk into the tile", dyMid, 2);
  check.expectLt("the miner sank a fraction of a tile, not a whole-tile snap", dyMid, TILE);

  // Finish THIS tile's cut, then release down the instant it breaks — holding on would start
  // boring the tile below and sink the miner into the next row, so we stop at exactly one row.
  let cleared = null;
  for (let i = 0; i < 30; i += 1) {
    await api.step(0.05);
    cleared = await api.call("tileAt", col, row + 1);
    if (cleared && cleared.kind === "tunnel") break;
  }
  await api.call("keyUp", K.down);
  await api.step(0.05); // settle onto the freshly exposed floor
  const after = await api.snapshot();
  check.expectEq("the drilled tile is now open tunnel", cleared ? cleared.kind : null, "tunnel");
  check.expectEq("the miner descended one row", after.miner.row, row + 1);

  await liveClip(api, 700);
  return check.verdict();
}
