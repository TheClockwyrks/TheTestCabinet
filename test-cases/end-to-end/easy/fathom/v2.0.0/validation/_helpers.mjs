// Case-specific helpers for Fathom's automated-validation items.
//
// Every helper here drives the real, deterministic simulation through window.__fathom
// (see specs/instrumentation.md): control ops only ESTABLISH a precondition, then time
// runs the real fixed-step core forward and `snapshot`/`pixel` read the outcome back.
// Nothing here fabricates a result.
//
// The helpers are split along the runtime's arrange/act seam (see
// `packages/browser-driver/validation.mjs`). An item runs TWICE — once with time
// instant to decide the verdict, once in real time to record the media — and the
// runtime enforces the split by throwing if `arrange` consumes time:
//
//   * `arrangeX(api, ...)` — control ops and instant reads only. Callable from
//     `arrange`, runs in BOTH passes, so the record pass reaches `act` in exactly
//     the state the check saw.
//   * `actX(api, ...)` — consumes time via `api.advance` / `api.until` and returns
//     the outcome the assertions read. Callable from `act`, and the only part filmed.
//
// A helper that only poses state (`startPlaying`, `denAllExcept`) is unpaired: it is
// arrange-callable on its own. The pure geometry/color functions below touch no clock
// at all and are callable from any phase.
//
// UNITS ARE TICKS. Fathom is a 120 Hz fixed timestep and the debug API's `step` takes
// whole ticks, so every duration passed to `api.advance` / `api.until` is a tick count
// (the runtime converts to wall-clock for the record pass). The seconds these replace
// are noted inline. The spec-valued constants below stay in SECONDS — they are
// assertion targets read back from `snapshot` (which reports cooldowns in seconds),
// not durations to advance by; use `ticksFor` to turn one into a tick count.
//
// Because the maze is the model's own invention (only its rules are fixed by the
// spec), these helpers are maze-AGNOSTIC: they parse `snapshot.tiles` to locate the
// geometry a scenario needs (an open tile, a straight corridor run, a corner, the
// wrap tunnel, a tile behind a blind corner) rather than assuming any fixed layout.
//
// The assertion primitives are NOT here — they are the reporter-side `ttc` kit
// (packages/browser-driver/ttc.mjs), the single source of truth shared by every case.
// This file holds only what is specific to Fathom.

// ---- Canonical constants (mirrored from specs / the reference constants) ------
// The rendered stage is a fixed 1280x720 logical space; a logical (x, y) maps to a
// normalized canvas fraction by dividing by these (see api.pixel).
export const STAGE_W = 1280;
export const STAGE_H = 720;

// The simulation rate, and the finest granularity a sweep can poll at. One tick is
// one fixed simulation step (this replaces the old `FIXED = 1/120` seconds
// constant); pass `poll: TICK` to `api.until` when the exact instant of an event
// matters, and a coarser count when the value read is constant between events.
export const TICK_HZ = 120;
export const TICK = 1;

/**
 * The exact number of ticks in `seconds` of game time, for turning one of the
 * SECONDS-valued spec constants below into something `api.advance` can take
 * (`ticksFor(SONAR_COOLDOWN)` = 180, `ticksFor(INK_COOLDOWN)` = 960).
 *
 * It THROWS rather than rounding when the duration is not a whole number of ticks.
 * That is the point of the ticks contract: a rounded step silently moves the sim a
 * different distance than the caller asked for, so a duration that does not land on a
 * tick boundary is a decision for the caller to make deliberately — pick the whole
 * tick count that preserves what the check is probing and pass it directly, with a
 * comment saying why that value.
 */
export function ticksFor(seconds) {
  const t = seconds * TICK_HZ;
  if (!Number.isInteger(t) || t < 0) {
    throw new Error(
      `ticksFor(${seconds}): ${seconds}s is ${t} ticks, not a whole non-negative number of ` +
        `simulation ticks — choose the tick count deliberately and pass it directly`,
    );
  }
  return t;
}

// Speeds (px/s) and ranges the spec fixes, used as assertion targets.
export const FORAGER_SPEED = 128;
export const PREDATOR_SPEED = 116; // ordinary wander speed (Lanternjaw hunt, Gloamfin/Flarefish wander)
export const DRIFTER_SPEED = 64; // the drifter, and a DISGUISED Lanternjaw
export const GLOAMFIN_CHASE = 134; // chase cap (~5% over the forager)
export const GLOAMFIN_CORNER = 115; // corner floor (~10% below the forager)
export const GLOAMFIN_HEAR = 64; // close-range hearing (~2 tiles)
export const GLOAMFIN_PING_INTERVAL = 4;
export const GLOAMFIN_PING_MIN_GAP = 3;
export const LANTERN_RANGE_BASE = 128; // R = 128 + 192*G
export const LANTERN_RANGE_GAIN = 192;
export const VISION_MIN = 96; // V = 96 + 64*G (base passive light)
export const VISION_GAIN = 64;
export const KINDLE_VISION_MIN = 192; // R = 192 + 128*G (Kindle vision circle)
export const KINDLE_VISION_GAIN = 128;
export const BRIGHT_PER_EAT = 0.34;
export const BRIGHT_HOLD = 1.0;
export const BRIGHT_HALFLIFE = 0.9;
export const SONAR_COOLDOWN = 1.5;
export const SONAR_RANGE_BASE = 9; // E at depth 1, in tiles
export const SONAR_MARK_TIME = 1.5;
export const SONAR_WAVE_SPEED = 14; // corridor tiles/sec the wavefront advances
export const INK_COOLDOWN = 8;
export const INK_RADIUS = 80;
export const INK_LIFE = 3;
export const FLARE_RADIUS = 192;
export const FLARE_INTERVAL = 7;
export const SCORE_PLANKTON = 10;
export const SCORE_DRIFTER = 200;
export const SCORE_CLEAR = 500;
export const START_LIVES = 3;

// The always-visible amber light (drifter + Lanternjaw bulb), COLOR.lanternjaw.
export const AMBER = { r: 255, g: 209, b: 102 }; // #ffd166

// ---- Directions --------------------------------------------------------------
export const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
export const OPP = { up: "down", down: "up", left: "right", right: "left" };
export const DIR_KEY = {
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
};

// ---- Tile / geometry ---------------------------------------------------------
export const isOpen = (tiles, c, r) => Boolean(tiles[r]) && tiles[r][c] === ".";
export const isWall = (tiles, c, r) =>
  !tiles[r] || tiles[r][c] === undefined || tiles[r][c] === "#";

/** The logical-pixel center of tile (tx, ty), from the snapshot's grid frame. */
export function tileCenter(grid, tx, ty) {
  return {
    x: grid.originX + tx * grid.tile + grid.tile / 2,
    y: grid.originY + ty * grid.tile + grid.tile / 2,
  };
}

/** A logical (x, y) as normalized canvas fractions for api.pixel. */
export function uvOf(x, y) {
  return [x / STAGE_W, y / STAGE_H];
}

/** The row of the horizontal wrap tunnel (both border columns open), or -1. */
export function wrapRow(snap) {
  const { tiles, grid } = snap;
  for (let r = 0; r < grid.rows; r++) {
    if (isOpen(tiles, 0, r) && isOpen(tiles, grid.cols - 1, r)) return r;
  }
  return -1;
}

/** One tile step in `dir` from (c, r), applying the horizontal wrap tunnel. */
export function stepTile(snap, c, r, dir) {
  const [dc, dr] = DIRS[dir];
  let nc = c + dc;
  const nr = r + dr;
  if (r === wrapRow(snap)) {
    if (nc < 0) nc = snap.grid.cols - 1;
    else if (nc >= snap.grid.cols) nc = 0;
  }
  return [nc, nr];
}

/** Which of the four directions have an open corridor neighbor from (c, r). */
export function openNeighborDirs(snap, c, r) {
  const out = [];
  for (const d of ["up", "down", "left", "right"]) {
    const [nc, nr] = stepTile(snap, c, r, d);
    if (isOpen(snap.tiles, nc, nr)) out.push(d);
  }
  return out;
}

/**
 * Throw an UNMET PRECONDITION: this build is conformant, but its world has no spot
 * where the scenario can be posed.
 *
 * The maze is the model's own invention (only its rules are fixed by the spec), so
 * every search below can legitimately come up empty against a build that answered
 * every debug-API call correctly. Marking the throw tells the driver the difference:
 * an unmarked throw means the API misbehaved and fails the run, while this one is
 * recorded as inconclusive and does not. See `PRECONDITION_UNMET` in
 * `packages/browser-driver/validation.mjs` for why this is a plain property rather
 * than a shared error class (this file is loaded by path and cannot import it).
 */
export function unmetPrecondition(reason) {
  const err = new Error(reason);
  err.ttcPreconditionUnmet = true;
  return err;
}

/** An open tile whose neighbor in `dir` is also open (a mover can go that way). */
export function findOpenWithNeighbor(snap, dir) {
  const { tiles, grid } = snap;
  for (let r = 1; r < grid.rows - 1; r++) {
    for (let c = 1; c < grid.cols - 1; c++) {
      if (!isOpen(tiles, c, r)) continue;
      const [nc, nr] = stepTile(snap, c, r, dir);
      if (isOpen(tiles, nc, nr)) return { tx: c, ty: r };
    }
  }
  throw unmetPrecondition(`no open tile with an open ${dir} neighbor`);
}

/** An open tile whose neighbor in `dir` is a wall (a mover cannot go that way). */
export function findOpenWithWall(snap, dir) {
  const { tiles, grid } = snap;
  for (let r = 1; r < grid.rows - 1; r++) {
    for (let c = 1; c < grid.cols - 1; c++) {
      if (!isOpen(tiles, c, r)) continue;
      const [nc, nr] = stepTile(snap, c, r, dir);
      if (isWall(tiles, nc, nr)) return { tx: c, ty: r };
    }
  }
  throw unmetPrecondition(`no open tile with a ${dir} wall`);
}

/**
 * A straight run of `len` open tiles in one axis-aligned direction. Returns the
 * run's start tile and its direction, so a mover placed at the start and driven in
 * `dir` travels the run without turning or stopping.
 */
export function findStraightRun(snap, len) {
  const { tiles, grid } = snap;
  for (let r = 1; r < grid.rows - 1; r++) {
    let run = 0;
    for (let c = 0; c < grid.cols; c++) {
      run = isOpen(tiles, c, r) ? run + 1 : 0;
      if (run >= len) return { tx: c - len + 1, ty: r, dir: "right" };
    }
  }
  for (let c = 1; c < grid.cols - 1; c++) {
    let run = 0;
    for (let r = 0; r < grid.rows; r++) {
      run = isOpen(tiles, c, r) ? run + 1 : 0;
      if (run >= len) return { tx: c, ty: r - len + 1, dir: "down" };
    }
  }
  throw unmetPrecondition(`no straight corridor run of length ${len}`);
}

/**
 * A corner/junction: a tile J open in an approach axis (a tile behind it to start
 * from) AND a perpendicular open arm, so a mover approaching J and then turning
 * takes a genuine perpendicular corner at J's center.
 */
export function findCorner(snap) {
  const { tiles, grid } = snap;
  for (let r = 2; r < grid.rows - 2; r++) {
    for (let c = 2; c < grid.cols - 2; c++) {
      if (!isOpen(tiles, c, r)) continue;
      const dirs = openNeighborDirs(snap, c, r);
      for (const approach of ["right", "down", "left", "up"]) {
        const back = OPP[approach];
        if (!dirs.includes(back)) continue;
        const perps =
          approach === "right" || approach === "left"
            ? ["up", "down"]
            : ["left", "right"];
        for (const perp of perps) {
          if (!dirs.includes(perp)) continue;
          const [bc, br] = stepTile(snap, c, r, back);
          const [pc, pr] = stepTile(snap, c, r, perp);
          return {
            junction: { tx: c, ty: r },
            approach,
            back: { tx: bc, ty: br },
            perp,
            perpTile: { tx: pc, ty: pr },
          };
        }
      }
    }
  }
  throw unmetPrecondition("no corner/junction found");
}

/** Straight-line tile visibility, mirroring the reference supercover (walls block). */
export function losClear(snap, fc, fr, tc, tr) {
  const { tiles } = snap;
  let x = fc;
  let y = fr;
  const dx = Math.abs(tc - fc);
  const dy = Math.abs(tr - fr);
  const xi = tc > fc ? 1 : -1;
  const yi = tr > fr ? 1 : -1;
  let n = dx + dy;
  let err = dx - dy;
  const dx2 = dx * 2;
  const dy2 = dy * 2;
  while (n > 0) {
    if (err > 0) {
      x += xi;
      err -= dy2;
    } else if (err < 0) {
      y += yi;
      err += dx2;
    } else {
      if (isWall(tiles, x + xi, y) && isWall(tiles, x, y + yi)) return false;
      x += xi;
      y += yi;
      err -= dy2;
      err += dx2;
      n--;
    }
    n--;
    if (x === tc && y === tr) break;
    if (isWall(tiles, x, y)) return false;
  }
  return true;
}

/**
 * A pair of open tiles close together (small manhattan distance) whose straight
 * line of sight is BLOCKED — a forager tile and a predator tile around a blind
 * corner. Returns { forager, pred, tiles } (manhattan distance).
 */
export function findBlindPair(snap, maxManhattan = 4) {
  const { tiles, grid } = snap;
  const opens = [];
  for (let r = 1; r < grid.rows - 1; r++) {
    for (let c = 1; c < grid.cols - 1; c++) {
      if (isOpen(tiles, c, r)) opens.push([c, r]);
    }
  }
  for (const [fc, fr] of opens) {
    for (const [pc, pr] of opens) {
      const m = Math.abs(fc - pc) + Math.abs(fr - pr);
      // >=3 so the euclidean gap exceeds the Gloamfin's 64 px hearing (a blind
      // pair is L-shaped, so m=3 is ~71 px), isolating the line-of-sight cause.
      if (m < 3 || m > maxManhattan) continue;
      if (!losClear(snap, fc, fr, pc, pr)) {
        return {
          forager: { tx: fc, ty: fr },
          pred: { tx: pc, ty: pr },
          tiles: m,
        };
      }
    }
  }
  throw unmetPrecondition("no blind-corner pair found");
}

/**
 * A pair of open tiles on the SAME straight corridor a chosen number of tiles
 * apart, with clear line of sight between them. Returns { forager, pred, dir, tiles }.
 */
export function findSightLine(snap, gapTiles) {
  const run = findStraightRun(snap, gapTiles + 1);
  const [dc, dr] = DIRS[run.dir];
  return {
    forager: { tx: run.tx, ty: run.ty },
    pred: { tx: run.tx + dc * gapTiles, ty: run.ty + dr * gapTiles },
    dir: run.dir,
    tiles: gapTiles,
  };
}

/**
 * An open tile whose center is well BEYOND the passive light (euclidean > 140 px, so
 * past both V and the g=0 light-sense range) yet within the sonar flood's reach
 * (manhattan <= 6 tiles from `from`). Used to place a predator that the light cannot
 * touch but a sonar pulse will sweep over. `from` is a tile {tx, ty}.
 */
export function findSonarTarget(snap, from) {
  const { grid } = snap;
  const a = tileCenter(grid, from.tx, from.ty);
  let best = null;
  let bestD = Infinity;
  for (const [c, r] of openTiles(snap)) {
    const man = Math.abs(c - from.tx) + Math.abs(r - from.ty);
    if (man > 6) continue;
    const p = tileCenter(grid, c, r);
    const d = Math.hypot(p.x - a.x, p.y - a.y);
    if (d <= 140 || d >= 260) continue;
    // Prefer the closest qualifying tile, so it is comfortably inside the flood.
    if (d < bestD) {
      bestD = d;
      best = { tx: c, ty: r };
    }
  }
  if (!best)
    throw new Error("no sonar target beyond the light but inside the flood");
  return best;
}

/**
 * Corridor (BFS) distance in tiles from `from` to every reachable open tile, wrap-
 * aware, matching the sonar flood's adjacency (Maze.floodBuckets). Returns a Map of
 * "c,r" -> distance.
 */
export function corridorDistances(snap, from, maxDist = 12) {
  const key = (c, r) => `${c},${r}`;
  const dist = new Map([[key(from.tx, from.ty), 0]]);
  let frontier = [[from.tx, from.ty]];
  let d = 0;
  while (frontier.length && d < maxDist) {
    const next = [];
    for (const [c, r] of frontier) {
      for (const dir of ["up", "down", "left", "right"]) {
        const [nc, nr] = stepTile(snap, c, r, dir);
        if (isOpen(snap.tiles, nc, nr) && !dist.has(key(nc, nr))) {
          dist.set(key(nc, nr), d + 1);
          next.push([nc, nr]);
        }
      }
    }
    frontier = next;
    d++;
  }
  return dist;
}

/**
 * `count` open tiles a sonar pulse WILL sweep over — inside the flood (corridor
 * distance 3..7, comfortably within the E=9-tile reach at depth 1) yet BEYOND the
 * forager's passive light (straight-line sight blocked, so the tile is unlit and no
 * light-sensing predator on it acquires the forager first). Nearest first. `from` is
 * a tile {tx, ty}. Distinct tiles.
 */
export function findSonarSenseTiles(snap, from, count = 1) {
  const dist = corridorDistances(snap, from, 9);
  const cand = [];
  for (const [k, dd] of dist) {
    if (dd < 3 || dd > 7) continue;
    const [c, r] = k.split(",").map(Number);
    if (losClear(snap, from.tx, from.ty, c, r)) continue; // want sight BLOCKED (unlit)
    cand.push({ tx: c, ty: r, d: dd });
  }
  cand.sort((a, b) => a.d - b.d);
  if (cand.length < count) {
    throw unmetPrecondition(
      `need ${count} sonar sense tile(s) beyond the light but inside the flood`,
    );
  }
  return cand.slice(0, count);
}

/** An open tile at least `minMan` tiles (manhattan) from `from` ({tx, ty}). */
export function findFarTile(snap, from, minMan) {
  for (const [c, r] of openTiles(snap)) {
    if (Math.abs(c - from.tx) + Math.abs(r - from.ty) >= minMan)
      return { tx: c, ty: r };
  }
  throw unmetPrecondition(`no open tile at least ${minMan} tiles away`);
}

// ---- The den (central predator chamber) --------------------------------------
// The snapshot tiles mark the den interior as 'd' and the den gate as 'g'
// (specs/instrumentation.md). The maze is the build's own invention, so these reads
// locate the den wherever the build placed it rather than assuming a fixed spot.

/** Every den-interior ('d') tile as [c, r]. */
export function denTiles(snap) {
  const { tiles, grid } = snap;
  const out = [];
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      if (tiles[r] && tiles[r][c] === "d") out.push([c, r]);
    }
  }
  return out;
}

/** Every den-gate ('g') tile as [c, r]. */
export function gateTiles(snap) {
  const { tiles, grid } = snap;
  const out = [];
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      if (tiles[r] && tiles[r][c] === "g") out.push([c, r]);
    }
  }
  return out;
}

/**
 * Den-interior tiles that border an OPEN corridor ('.') directly — a breach in the
 * den wall that is not the gate. A fully enclosed den has none: its interior meets
 * the corridors only through a gate tile ('g'), never open rock.
 */
export function denCorridorBreaches(snap) {
  const { tiles } = snap;
  const out = [];
  for (const [c, r] of denTiles(snap)) {
    for (const d of ["up", "down", "left", "right"]) {
      const [nc, nr] = stepTile(snap, c, r, d);
      if (isOpen(tiles, nc, nr)) {
        out.push([c, r]);
        break;
      }
    }
  }
  return out;
}

/**
 * An open corridor tile adjacent to a den gate ('g'), paired with the direction that
 * points from that tile INTO the gate — so a forager placed there and driven that way
 * is pushed straight at the closed gate. Returns { tx, ty, dir }.
 */
export function findGateApproach(snap) {
  const { tiles, grid } = snap;
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      if (!tiles[r] || tiles[r][c] !== "g") continue;
      for (const d of ["up", "down", "left", "right"]) {
        const [nc, nr] = stepTile(snap, c, r, d);
        if (isOpen(tiles, nc, nr)) return { tx: nc, ty: nr, dir: OPP[d] };
      }
    }
  }
  throw unmetPrecondition("no open corridor tile adjacent to a den gate");
}

// ---- Structural maze metrics (pure reads of snapshot.tiles) ------------------
export function openTiles(snap) {
  const { tiles, grid } = snap;
  const out = [];
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++)
      if (isOpen(tiles, c, r)) out.push([c, r]);
  }
  return out;
}

/** Count of 2x2 blocks whose four cells are all open corridor. */
export function count2x2Open(snap) {
  const { tiles, grid } = snap;
  let n = 0;
  for (let r = 0; r < grid.rows - 1; r++) {
    for (let c = 0; c < grid.cols - 1; c++) {
      if (
        isOpen(tiles, c, r) &&
        isOpen(tiles, c + 1, r) &&
        isOpen(tiles, c, r + 1) &&
        isOpen(tiles, c + 1, r + 1)
      ) {
        n++;
      }
    }
  }
  return n;
}

/**
 * Columns c and cols-1-c disagree on wall-ness — a mirror-symmetry mismatch. The den
 * chamber is exempt from the symmetry requirement (specs/trench.md): its single gate
 * is one tile on the centerline, so a cell is skipped whenever it or its mirror is a
 * den-interior ('d') or den-gate ('g') tile.
 */
export function symmetryMismatches(snap) {
  const { tiles, grid } = snap;
  const isDenCell = (c, r) =>
    Boolean(tiles[r]) && (tiles[r][c] === "d" || tiles[r][c] === "g");
  let n = 0;
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const m = grid.cols - 1 - c;
      if (isDenCell(c, r) || isDenCell(m, r)) continue;
      if (isWall(tiles, c, r) !== isWall(tiles, m, r)) n++;
    }
  }
  return n;
}

/** Open tiles reachable from (sc, sr) over open corridors, wrap-aware. */
export function floodReachable(snap, sc, sr) {
  const seen = new Set();
  const key = (c, r) => `${c},${r}`;
  const stack = [[sc, sr]];
  seen.add(key(sc, sr));
  while (stack.length) {
    const [c, r] = stack.pop();
    for (const d of ["up", "down", "left", "right"]) {
      const [nc, nr] = stepTile(snap, c, r, d);
      if (isOpen(snap.tiles, nc, nr) && !seen.has(key(nc, nr))) {
        seen.add(key(nc, nr));
        stack.push([nc, nr]);
      }
    }
  }
  return seen;
}

/** Open tiles with fewer than 2 open neighbors (a dead end). */
export function deadEnds(snap) {
  return openTiles(snap).filter(
    ([c, r]) => openNeighborDirs(snap, c, r).length < 2,
  );
}

/** Average number of open neighbors per open tile (2 = pure corridor, 4 = room). */
export function avgOpenNeighbors(snap) {
  const opens = openTiles(snap);
  if (!opens.length) return 0;
  let sum = 0;
  for (const [c, r] of opens) sum += openNeighborDirs(snap, c, r).length;
  return sum / opens.length;
}

/** Open tiles with 3+ open neighbors (junctions — the branching of the maze). */
export function junctions(snap) {
  return openTiles(snap).filter(
    ([c, r]) => openNeighborDirs(snap, c, r).length >= 3,
  );
}

// ---- State-only helpers (arrange) --------------------------------------------
//
// These pose the world with control ops and consume no time, so they are callable
// straight from `arrange` and need no act half.

/**
 * Reset (seeded), begin a dive, and enter live play. Returns the snapshot, which is
 * how a scenario reads the maze it must locate its geometry in (the layout is the
 * build's own invention, so every `findX` below takes this snapshot).
 */
export async function startPlaying(api, seed = 1) {
  await api.reset({ seed });
  await api.call("startDive");
  await api.call("beginPlay");
  return api.snapshot();
}

export const pred = (snap, kind) => snap.predators.find((p) => p.kind === kind);

/**
 * Park every predator in the den (a clean baseline), except the ones named in
 * `except`. Used so a scenario reads one predator's behavior undisturbed.
 */
export async function denAllExcept(api, except = []) {
  for (const kind of ["lanternjaw", "gloamfin", "flarefish"]) {
    if (!except.includes(kind))
      await api.call("setPredator", kind, { mode: "den" });
  }
}

// NOTE: the old `clip(api, ms)` helper is GONE. It switched the build to wall-clock
// stepping and waited, to append a few seconds of real motion to the recording after
// the assertions had already run. `act` IS the clip now — the record pass replays the
// same `act` in real time — so a scenario needs no separate live tail, and the runtime
// owns the clock (an item must never call `setAutoStep`). Whatever the old clip tail
// depicted belongs in `act`, and where the two disagreed, `act` shows what the
// assertions actually drove.

// ---- Pixel / color -----------------------------------------------------------
//
// These read the pixels the build actually PAINTS, through the driver's `api.pixel`,
// so a build cannot pass by reporting a color it does not draw. They consume no
// simulation time, but they must be called from `act`: a sample needs a frame to have
// been painted since the scene was posed, and in the validate pass `advance` is
// instant and produces no frame at all. Precede the first sample with
// `await api.settle(ms)` — a REAL pause in both passes, and the only way to get that
// frame (see `api.settle` in packages/browser-driver/validation.mjs).

/** Average the rendered color over a small 5-point cluster around (x, y). */
export async function sampleColor(api, x, y) {
  const offsets = [
    [0, 0],
    [3, 0],
    [-3, 0],
    [0, 3],
    [0, -3],
  ];
  let r = 0;
  let g = 0;
  let b = 0;
  for (const [dx, dy] of offsets) {
    const [u, v] = uvOf(x + dx, y + dy);
    const p = await api.pixel(u, v);
    r += p.r;
    g += p.g;
    b += p.b;
  }
  const n = offsets.length;
  return { r: r / n, g: g / n, b: b / n };
}

export function colorDistance(a, b) {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

export function luminance(c) {
  return (c.r + c.g + c.b) / 3;
}

/**
 * A warm amber light (the drifter orb / Lanternjaw bulb). The mote is drawn as a
 * soft amber glow with a bright, near-white hot core (specs/trench.md), so the very
 * center of the additive glow saturates toward white; the amber HUE reads in the
 * halo around it (use `sampleAmberOrb`, which samples that ring). A warm amber pixel
 * leans red, with green above blue and a clear red-over-blue warmth, and is lit
 * (not black fog). Deliberately hue-based, not an exact-color match, since an
 * additive glow's brightness rides on whatever it is drawn over.
 */
export function isAmber(c) {
  return (
    c.r > 110 && // a lit warm mote, not black fog
    c.r >= c.g && // red-leaning
    c.g > c.b && // the amber cast (green above blue)
    c.r - c.b > 40 && // clearly warm, not a neutral or bluish glow
    luminance(c) > 40
  );
}

/**
 * Average the rendered color over a small ring (default radius 5 px) around the amber
 * mote's center. The mote's hot core blows out to near-white by design, so the amber
 * hue is read from the halo just outside it, not from the saturated center.
 */
export async function sampleAmberOrb(api, x, y, radius = 5) {
  let r = 0;
  let g = 0;
  let b = 0;
  const n = 6;
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2;
    const [u, v] = uvOf(x + radius * Math.cos(ang), y + radius * Math.sin(ang));
    const p = await api.pixel(u, v);
    r += p.r;
    g += p.g;
    b += p.b;
  }
  return { r: r / n, g: g / n, b: b / n };
}

/** Near the pitch-black fog / blackout (very low luminance). */
export function isDark(c) {
  return luminance(c) < 26;
}

// ---- Input-driven movement ---------------------------------------------------
//
// These drive the game the way a player does — through injected keyboard input
// (window.__fathom keyDown/keyUp/press, see specs/instrumentation.md) — rather than
// posing the forager with a control op. Because the drive itself never calls a
// control op, the forager stays under normal keyboard control and responds to the
// held movement key, which is exactly what a controls check must confirm.

/**
 * ARRANGE half of a movement-key check: enter live play and place the forager on a
 * tile that has an open corridor neighbor in `dir`, so a held key in that direction
 * has somewhere to go. Returns `{ snap, spot }` — the snapshot the maze geometry was
 * read from, and the tile the forager was placed on.
 *
 * Pair with `actMoveKey`.
 */
export async function arrangeMoveKey(api, dir) {
  const snap = await startPlaying(api);
  const spot = findOpenWithNeighbor(snap, dir);
  await api.call("setForager", { tx: spot.tx, ty: spot.ty });
  return { snap, spot };
}

/**
 * ACT half of a movement-key check: HOLD the movement key `code` and run the real sim
 * so the held key drives the forager through the game's normal movement code. The
 * verdict is read after exactly `ticks` of held input, so the measured displacement is
 * the same in both passes; the extra `tailTicks` are held afterwards purely so the
 * recorded clip shows the forager swimming for a readable moment before the key is
 * released (they cannot affect the returned states, which were already captured).
 *
 * Pair with `arrangeMoveKey`. Returns `{ before, after, code }` forager states — what
 * the old `driveMoveKey` returned — for `movedAlong` to judge.
 */
export async function actMoveKey(
  api,
  code,
  { ticks = 30, tailTicks = 60 } = {},
) {
  const before = (await api.snapshot()).forager;
  await api.call("keyDown", code);
  await api.advance(ticks); // 30 ticks = the old 0.25s, ~one tile at 128 px/s
  const after = (await api.snapshot()).forager;
  await api.advance(tailTicks); // 60 ticks (0.5s) of visible travel for the clip
  await api.call("keyUp", code);
  return { before, after, code };
}

/** True if the forager's move went the expected way (tile changed along `dir`). */
export function movedAlong(before, after, dir) {
  const [dc, dr] = DIRS[dir];
  if (dc !== 0) return Math.sign(after.tx - before.tx) === Math.sign(dc);
  return Math.sign(after.ty - before.ty) === Math.sign(dr);
}

/**
 * ACT half of the Gloamfin ping checks: watch for `ticks` and return the distinct
 * pings it emitted, each `{ t, tint }` (`t` is the snapshot's simTime). Sweeps in
 * `poll`-tick chunks and counts only a FRESH wavefront (one whose front has barely
 * left the source), so a single expanding pulse seen across several samples is one
 * event rather than many; pings within 1 s of each other coalesce, and a violet ping
 * upgraded to orange ("lost you") in that window updates the tint in place.
 *
 * This has no arrange half of its own — the caller poses the Gloamfin and the forager
 * however the scenario needs, then calls this. Returns the event array (what the old
 * `collectGloamPings` returned).
 */
export async function actGloamPings(api, ticks, { poll = 6 } = {}) {
  // poll 6 = the old 0.05s chunk. The freshness window is a distance, so it is
  // computed from the chunk in SECONDS against the wavefront's tiles/sec speed.
  const events = [];
  const chunkSeconds = poll / TICK_HZ;
  const freshFront = SONAR_WAVE_SPEED * chunkSeconds * 2.5;
  const sweeps = Math.ceil(ticks / poll);
  for (let i = 0; i < sweeps; i++) {
    await api.advance(poll);
    const s = await api.snapshot();
    for (const p of s.pulses) {
      if (p.source !== "gloamfin") continue;
      if (p.front > freshFront) continue;
      const last = events[events.length - 1];
      if (!last || s.simTime - last.t > 1.0) {
        events.push({ t: s.simTime, tint: p.tint });
      } else if (p.tint === "orange") {
        last.tint = "orange";
      }
    }
  }
  return events;
}

// NOTE: the old `stepUntil(api, predicate, maxSeconds, chunk)` helper is GONE — the
// runtime's `api.until(predicate, { max, poll })` supersedes it exactly, and does the
// one thing this file cannot: in the record pass it samples the running game in real
// time instead of stepping it. It returns `{ snap, hit, spent }` (a superset of the
// old `{ snap, hit }`), with `max`/`poll` in TICKS — the old `maxSeconds` and the old
// 0.05s default `chunk` become `max: ticksFor(seconds)` and `poll: 6`.
