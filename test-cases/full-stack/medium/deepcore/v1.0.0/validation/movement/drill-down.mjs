// Automated validation for movement.drill-down.
//
// Holding down over solid rock drills the tile below: the miner SINKS into it as it cuts
// (drilling.progress rises, the miner's y advances a fraction of a tile — never a whole-tile
// teleport-snap) and the tile becomes open tunnel when it breaks. teleport/setTile only
// arrange a known shaft; the real drill system produces the outcome, read back from
// snapshot()/tileAt().

import {
  K,
  newRun,
  standAt,
  solid,
  TILE,
  TOPSOIL_ROW,
  SPAWN_COL,
} from "../_helpers.mjs";

export default function item() {
  const col = SPAWN_COL;
  const row = TOPSOIL_ROW;
  let pre;
  let y0;
  let mid;
  let cleared = null;
  let after;

  return {
    id: "movement.drill-down",

    // Grounded on a rock floor at (col, row+1), with solid rock below the target too.
    async arrange(api) {
      await newRun(api);
      await standAt(api, col, row); // grounded on a rock floor at (col, row+1)
      await solid(api, col, row + 2); // solid below the target, so the shaft is continuous
      pre = await api.call("tileAt", col, row + 1);
      y0 = (await api.snapshot()).miner.y;
    },

    // The cut is the behavior and the clip: the miner sinking into the tile, then the tile giving
    // way and the miner settling one row lower.
    async act(api) {
      await api.call("keyDown", K.down);
      await api.advance(15); // 15 ticks = 0.25 s, partway through the ~0.5 s topsoil cut
      mid = (await api.snapshot()).miner;

      // Finish THIS tile's cut, then release down the instant it breaks — holding on would start
      // boring the tile below and sink the miner into the next row, so we stop at exactly one row.
      // The sweep stays an explicit loop rather than `api.until` because its predicate reads
      // `tileAt`, not the snapshot.
      for (let i = 0; i < 30; i += 1) {
        await api.advance(3); // 3 ticks = the old 0.05 s chunk
        cleared = await api.call("tileAt", col, row + 1);
        if (cleared && cleared.kind === "tunnel") break;
      }
      await api.call("keyUp", K.down);
      await api.advance(3); // settle onto the freshly exposed floor
      after = await api.snapshot();
    },

    async assert(api, check) {
      check.expectOk(
        "the tile below starts as minable rock",
        pre && pre.kind === "rock",
      );
      check.expectOk(
        "a down cut is under way",
        !!mid.drilling && mid.drilling.dir === "down",
      );
      check.expectGt(
        "the cut has made progress",
        mid.drilling ? mid.drilling.progress : 0,
        0.05,
      );
      check.expectLt(
        "the tile has not broken yet",
        mid.drilling ? mid.drilling.progress : 1,
        0.98,
      );
      const dyMid = mid.y - y0;
      check.expectGt("the miner has sunk into the tile", dyMid, 2);
      check.expectLt(
        "the miner sank a fraction of a tile, not a whole-tile snap",
        dyMid,
        TILE,
      );
      check.expectEq(
        "the drilled tile is now open tunnel",
        cleared ? cleared.kind : null,
        "tunnel",
      );
      check.expectEq("the miner descended one row", after.miner.row, row + 1);
    },
  };
}
