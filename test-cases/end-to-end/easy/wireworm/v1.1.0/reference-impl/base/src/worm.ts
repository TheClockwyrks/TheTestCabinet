// The data-worm's per-step motion (specs/worm.md, specs/charge.md). The worm
// advances one tile per step at the level's cadence: it winds horizontally, drops
// and reverses when blocked (charging a node it is blocked by), oscillates between
// the floor and the top, and dives straight down a column when blocked by a
// critical node. Shooting/splitting and cursor collisions are handled in game.ts.

import type { Game } from "./game";
import type { Tile, Worm } from "./types";
import { BAND_TOP_ROW, CHARGE_MAX, COLS, ROWS } from "./constants";
import { chargeAt } from "./field";

// Shift the body forward one tile along the head's path, then set the new head.
function advanceBody(worm: Worm, newHead: Tile): void {
  for (let i = worm.segs.length - 1; i > 0; i--) worm.segs[i] = worm.segs[i - 1];
  worm.segs[0] = newHead;
}

export function stepWorm(game: Game, worm: Worm): void {
  const head = worm.segs[0];
  const hc = head.c;
  const hr = head.r;

  // Already diving: drive straight down the current column, ignoring nodes and
  // walls, until the bottom row / player band, then resume normal winding.
  if (worm.diving) {
    if (hr >= BAND_TOP_ROW || hr >= ROWS - 1) {
      worm.diving = false;
      worm.dv = -1; // at the floor: resume by climbing
    } else {
      const nr = hr + 1;
      const newHead = { c: hc, r: nr };
      if (nr >= BAND_TOP_ROW || nr >= ROWS - 1) {
        worm.diving = false;
        worm.dv = -1;
      }
      advanceBody(worm, newHead);
      return;
    }
  }

  // Normal winding: try to advance one tile horizontally.
  const tc = hc + worm.dh;
  let blocked = false;
  let chargeNode = false;
  let critNode = false;

  if (tc < 0 || tc >= COLS) {
    blocked = true; // side edge turns the worm but charges nothing
  } else {
    const ch = chargeAt(game.field, tc, hr);
    if (ch >= 0) {
      blocked = true;
      if (ch >= CHARGE_MAX) critNode = true;
      else chargeNode = true;
    } else if (game.segmentAt(tc, hr)) {
      blocked = true; // another worm segment turns it (no charge)
    }
  }

  if (!blocked) {
    worm.facing = worm.dh;
    advanceBody(worm, { c: tc, r: hr });
    return;
  }

  // Blocked by a critical node: charge is already capped, and the worm dives.
  if (critNode) {
    worm.diving = true;
    const nr = hr + 1;
    const newHead = { c: hc, r: nr };
    if (nr >= BAND_TOP_ROW || nr >= ROWS - 1) {
      worm.diving = false;
      worm.dv = -1;
    }
    advanceBody(worm, newHead);
    return;
  }

  // Blocked by a chargeable node: energize it one level (specs/charge.md).
  if (chargeNode) game.chargeNode(tc, hr);

  // Drop one row in the current vertical direction, flipping at the extremes so
  // the worm oscillates; reverse the horizontal heading.
  let ndv = worm.dv;
  if (ndv === 1 && hr + 1 > ROWS - 1) ndv = -1;
  else if (ndv === -1 && hr - 1 < 0) ndv = 1;
  worm.dv = ndv;
  worm.dh = -worm.dh;
  worm.facing = worm.dh;
  advanceBody(worm, { c: hc, r: hr + ndv });
}
