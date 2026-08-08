// Automated validation for movement.climb-after-drill.
//
// A drilled shaft is a real hole the miner can fly back out of. Holding down cuts three rows of
// solid rock away — each tile genuinely becoming open tunnel — and then holding thrust carries the
// miner back UP that same shaft to the row it started from. This is the round trip the whole game
// is built on (specs/overview.md, specs/gameplay.md): going down is cheap, and the jetpack through
// the tunnels already carved is the only way home (specs/character.md).
//
// Two defects this catches, both of which can leave a build looking right on screen. A drill that
// reports progress and plays its animation but never turns the tile into open tunnel: the miner
// appears to descend while the grid behind it stays solid, so `drill-down`'s single-tile cut can
// still pass while nothing is really being removed. And a shaft the miner cannot get back out of:
// collision resolved against the pre-drill grid, a carved tunnel narrower than the miner's box, or
// a lip it snags on — the miner is stranded at the bottom of a hole it dug, which is an unwinnable
// game however good the descent looks.
//
// setTile only guarantees there is solid rock to cut and a floor to land on. The descent, the
// broken tiles, and the climb are all produced by the real drill, physics, and jetpack, and read
// back from snapshot()/tileAt().

import {
  K,
  newRun,
  standAt,
  solid,
  TILE,
  TOPSOIL_ROW,
  SPAWN_COL,
} from "../_helpers.mjs";

/** Rows cut before flying back up — deep enough that the climb is a real ascent through a shaft. */
const DEPTH = 3;

export default function item() {
  const col = SPAWN_COL;
  const row = TOPSOIL_ROW;
  const pre = [];
  const cut = [];
  let start;
  let dug;
  let climb;
  let top;

  return {
    id: "movement.climb-after-drill",

    // Grounded on a rock floor, with solid rock for the whole shaft and a floor beneath it, so the
    // cut is continuous and nothing but plain rock is drilled.
    async arrange(api) {
      await newRun(api);
      await standAt(api, col, row);
      for (let i = 1; i <= DEPTH + 1; i += 1) await solid(api, col, row + i);
      // A full tank (clamped to the tier-1 max), so a failed climb is never just an empty one.
      await api.call("setFuel", 999999);
      for (let i = 1; i <= DEPTH; i += 1) {
        pre.push(await api.call("tileAt", col, row + i));
      }
      start = await api.snapshot();
    },

    // The dig and the flight home are both the behavior and the clip: three rows cut away, then
    // the miner riding the jetpack back up the hole it just made.
    async act(api) {
      await api.call("keyDown", K.down);
      // Sweep until the LAST tile of the shaft has actually broken. The sweep stays an explicit
      // loop rather than `api.until` because its predicate reads `tileAt`, not the snapshot — and
      // the tile is what matters here: mid-cut the miner SINKS into the tile it is boring
      // (specs/character.md), so its reported row reaches the bottom of the shaft a moment before
      // that tile gives way, and stopping on the row alone would release down mid-cut and leave
      // the last tile standing. 300 x 3 ticks = 15 s, an order of magnitude past the ~1.5 s three
      // topsoil cuts take, since the specs pin no drill duration.
      for (let i = 0; i < 300; i += 1) {
        await api.advance(3);
        const t = await api.call("tileAt", col, row + DEPTH);
        if (t && t.kind === "tunnel") break;
      }
      await api.call("keyUp", K.down);
      await api.advance(6); // settle onto the floor of the finished shaft
      dug = await api.snapshot();
      for (let i = 1; i <= DEPTH; i += 1) {
        cut.push(await api.call("tileAt", col, row + i));
      }

      // Now fly straight back up the shaft the cut left behind.
      await api.call("keyDown", K.thrust);
      climb = await api.until((s) => s.miner.row <= row, { max: 600, poll: 3 });
      await api.advance(15); // keep the thrust on a beat longer, so a miner snagged on the way up
      top = await api.snapshot(); // reads as one that stalled below where it started
      await api.call("keyUp", K.thrust);
    },

    async assert(api, check) {
      pre.forEach((t, i) => {
        check.expectEq(
          `the shaft starts as solid rock at row +${i + 1}`,
          t ? t.kind : null,
          "rock",
        );
      });

      // The descent is a drilled one: three rows down, and the rock is really gone.
      check.expectEq(
        "the miner drilled all the way down the shaft",
        dug.miner.row,
        row + DEPTH,
      );
      cut.forEach((t, i) => {
        check.expectEq(
          `the drilled tile at row +${i + 1} is now open tunnel`,
          t ? t.kind : null,
          "tunnel",
        );
      });

      // And the shaft is flyable: the jetpack brings the miner back up out of it.
      check.expectOk(
        "the miner flew back up out of the shaft it drilled",
        climb.hit,
      );
      check.expectLe(
        "the climb reached the row the dig started from",
        top.miner.row,
        row,
      );
      check.expectLe(
        "the miner regained the height it set out from",
        top.miner.y,
        start.miner.y + TILE / 2,
      );
      // The way up is the jetpack through carved tunnel, never an upward cut (specs/character.md).
      check.expectEq("no upward cut was made", top.miner.drilling, null);
      check.expectGt(
        "fuel remained — the climb was not fuel-limited",
        top.miner.fuel,
        0,
      );
    },
  };
}
