// Automated validation for foes.glitch-eats: the glitch removes any node it passes
// over, of any charge (even a critical node).
//
// A row of critical nodes is the precondition and a glitch is released a few rows
// above it; the eat is produced by the real updateFoe glitch branch (game.eatNode)
// as the glitch's own zig-zag carries it down onto the row, and is read back as the
// disappearance of the node on the tile it actually crossed.
//
// The glitch ARRIVES rather than appearing on its meal. The old scenario posed it
// directly onto a single critical node, one sim beat before the eat, which is the
// only way to make one specific node deterministic: a glitch re-picks a random
// horizontal dart several times a second (foes.glitch-zigzag checks exactly that),
// so a glitch released above one node would wander tiles clear of its column and
// this item would be deciding on a coin toss. But it made the clip read as though
// the glitch were BORN from the node — the node is there, and then it is a glitch —
// which says nothing about a foe passing over terrain and eating it.
//
// Widening the target fixes that without giving up determinism. A critical node on
// every column of one row means there is no column the glitch can dart to that
// misses: wherever it crosses the row, it crosses a node. The item then reads the
// tile it actually crossed out of the snapshot and checks THAT node — the eat is
// still decided on a specific node the real systems chose, and the clip now shows
// the glitch skittering down the board and stripping the charged line it lands on.

import {
  BOARD_Y,
  COLS,
  TICK,
  TILE,
  chargeAt,
  foesOf,
  freshBoard,
  tileCX,
  tileCY,
} from "../_helpers.mjs";

// The charged line, and where the glitch is released above it. Three rows of fall
// is around a second and a half at the reference's 62 px/s — enough to read the
// glitch as a separate thing arriving, without spending the clip on the descent.
const ROW = 12;
const DROP_ROWS = 3;
const RELEASE_C = 20;

/** The grid row a foe's centre is on. */
const foeRow = (f) => Math.floor((f.y - BOARD_Y) / TILE);
/** The grid column a foe's centre is on. */
const foeCol = (f) => Math.floor(f.x / TILE);

export default function item() {
  let crossedC;
  let before;
  let after;

  return {
    id: "foes.glitch-eats",

    async arrange(api) {
      await freshBoard(api);
      // A critical node on every column of ROW: whichever way the glitch darts, the
      // tile it crosses on holds one.
      for (let c = 0; c < COLS; c++) await api.call("setNode", c, ROW, 3);
      await api.call("setCursor", 16, 704); // out of the glitch's way
    },

    async act(api) {
      // A beat and a half of the charged line standing on its own, so the reviewer
      // reads the board before anything is on it.
      await api.advance(180);

      await api.call("spawnFoe", "glitch", {
        x: tileCX(RELEASE_C),
        y: tileCY(ROW - DROP_ROWS),
        vx: 0,
      });

      // Follow it down. `prev` trails one sample behind so the BEFORE charge is read
      // from the last instant the glitch was still above the row — on the sample it
      // arrives, a build that eats on entry has already taken the node.
      let prev = await api.snapshot();
      const arrival = await api.until(
        (s) => {
          const g = foesOf(s, "glitch")[0];
          if (!g) return false;
          if (foeRow(g) >= ROW) return true;
          prev = s;
          return false;
        },
        { max: 600, poll: TICK }, // 600 ticks = 5s, ample for a 3-row fall
      );
      const glitch = foesOf(arrival.snap, "glitch")[0];
      crossedC = glitch ? foeCol(glitch) : -1;
      before = chargeAt(prev, crossedC, ROW);

      // Let the eat land and the glitch skitter on, so the gap it tore in the line
      // is legible at the end of the clip.
      await api.advance(120); // 1s of visible play
      after = chargeAt(await api.snapshot(), crossedC, ROW);
    },

    async assert(api, check) {
      check.expectEq(
        "the critical node stands before the glitch passes",
        before,
        3,
      );
      check.expectEq("the glitch eats the node, of any charge", after, -1);
    },
  };
}
