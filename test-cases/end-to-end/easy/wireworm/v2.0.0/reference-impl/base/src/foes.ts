// The three support foes (specs/foes.md): the glitch (eats nodes in a restless
// zig-zag), the packet-dropper (falls a column, reseeding empty tiles, two hits),
// and the corruptor (crawls an upper row, slamming nodes to critical). Spawning is
// gated and paced in game.ts; these build the foes and advance them each step.

import type { Game } from "./game";
import type { Foe } from "./types";
import type { Rng } from "./rng";
import {
  BOARD_Y,
  COLS,
  ROWS,
  SCATTER_BOTTOM_ROW,
  SCATTER_TOP_ROW,
  STAGE_W,
  GLITCH_H_SPEED,
  GLITCH_V_SPEED,
  GLITCH_TURN_INTERVAL,
  DROPPER_SPEED,
  CORRUPTOR_SPEED,
  tileCX,
  tileCY,
} from "./constants";

function newFoe(kind: Foe["kind"], x: number, y: number): Foe {
  return {
    kind,
    x,
    y,
    vx: 0,
    vy: 0,
    turnTimer: 0,
    hitOnce: false,
    lastDropRow: -99,
    row: 0,
    lastSlamCol: -99,
  };
}

export function spawnGlitch(rng: Rng): Foe {
  const fromLeft = rng.chance(0.5);
  const r = rng.int(8, 17);
  const f = newFoe("glitch", fromLeft ? -16 : STAGE_W + 16, tileCY(r));
  f.vx = fromLeft ? GLITCH_H_SPEED : -GLITCH_H_SPEED;
  f.vy = GLITCH_V_SPEED;
  f.turnTimer = GLITCH_TURN_INTERVAL;
  return f;
}

export function spawnDropper(rng: Rng): Foe {
  const c = rng.int(0, COLS - 1);
  const f = newFoe("dropper", tileCX(c), BOARD_Y - 16);
  f.vy = DROPPER_SPEED;
  return f;
}

export function spawnCorruptor(rng: Rng): Foe {
  const fromLeft = rng.chance(0.5);
  const r = rng.int(1, 4);
  const f = newFoe("corruptor", fromLeft ? -16 : STAGE_W + 16, tileCY(r));
  f.vx = fromLeft ? CORRUPTOR_SPEED : -CORRUPTOR_SPEED;
  f.row = r;
  return f;
}

const boardBottom = BOARD_Y + ROWS * 32;

// Advance one foe. Returns false when it has left the board and should despawn.
export function updateFoe(game: Game, f: Foe, dt: number): boolean {
  switch (f.kind) {
    case "glitch": {
      f.turnTimer -= dt;
      if (f.turnTimer <= 0) {
        // Dart: re-pick a horizontal direction at random for the restless zig-zag.
        f.vx = (game.rng.chance(0.5) ? -1 : 1) * GLITCH_H_SPEED;
        f.turnTimer = GLITCH_TURN_INTERVAL * (0.6 + game.rng.next() * 0.8);
      }
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      // Bounce off the side edges rather than leaving through them.
      if (f.x < 16) {
        f.x = 16;
        f.vx = Math.abs(f.vx);
      } else if (f.x > STAGE_W - 16) {
        f.x = STAGE_W - 16;
        f.vx = -Math.abs(f.vx);
      }
      // Eat any node under it (of any charge — defusing charge you were building).
      const c = Math.floor(f.x / 32);
      const r = Math.floor((f.y - BOARD_Y) / 32);
      game.eatNode(c, r);
      return f.y < boardBottom + 20; // roams down into the band, then exits
    }

    case "dropper": {
      f.vy = f.hitOnce ? game.dropperHitSpeed : DROPPER_SPEED;
      f.y += f.vy * dt;
      const c = Math.floor(f.x / 32);
      const r = Math.floor((f.y - BOARD_Y) / 32);
      // Lay a fresh inert node in each empty tile it passes (rows 1..17: never the
      // entry row or the player band, specs/playfield.md).
      if (
        r !== f.lastDropRow &&
        r >= SCATTER_TOP_ROW &&
        r <= SCATTER_BOTTOM_ROW
      ) {
        f.lastDropRow = r;
        game.dropNode(c, r);
      }
      return f.y < boardBottom + 20;
    }

    case "corruptor": {
      f.x += f.vx * dt;
      f.y = tileCY(f.row);
      const c = Math.floor(f.x / 32);
      if (c !== f.lastSlamCol) {
        f.lastSlamCol = c;
        game.slamNode(c, f.row); // straight to critical
      }
      return f.x > -24 && f.x < STAGE_W + 24;
    }
  }
}
