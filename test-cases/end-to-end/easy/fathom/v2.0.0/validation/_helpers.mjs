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

/**
 * Open to a PREDATOR: corridor ('.'), the den interior ('d'), or the den gate ('g') —
 * mirrors the reference `Maze.predOpen`. Predators path through all three (den → gate →
 * corridors); the forager is confined to corridors and cannot pass the gate. Used to
 * trace whether a released predator can actually reach the forager rather than being
 * sealed into a walled-off den.
 */
export const isPredOpen = (tiles, c, r) =>
  Boolean(tiles[r]) &&
  (tiles[r][c] === "." || tiles[r][c] === "d" || tiles[r][c] === "g");

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

/**
 * The error a geometry finder throws when the maze offered no spot to pose its
 * scenario — deciding, from the maze itself, whether that is the build's fault.
 *
 * A conforming maze can legitimately lack a scenario's geometry, and that is an unmet
 * precondition (exempt). But the corridor proportions (openness / mazing / density) are
 * exactly the properties that FORCE the geometry the sensing and cornering checks look
 * for — occlusion behind rock, real bends and junctions — to exist. So when a finder
 * comes up empty AND the build breaks one of those bounds, the missing scenario is the
 * build's own doing: this returns a HARD (gating) failure to throw instead of an exempt
 * precondition. Only a maze that passes every proportion yet still lacks the geometry
 * stays exempt. See `mazeProportionChecks`.
 */
export function unconstructibleOr(snap, reason) {
  const violations = mazeProportionChecks(snap).filter((m) => !m.ok);
  if (violations.length) {
    const detail = violations
      .map(
        (m) => `${m.name} ${m.value.toFixed(2)} outside [${m.min}, ${m.max}]`,
      )
      .join("; ");
    return new Error(
      `${reason}, and the maze breaks a required corridor proportion that would force it ` +
        `to exist: ${detail}`,
    );
  }
  return unmetPrecondition(reason);
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

/**
 * The most WALLED-IN open tile on the board — the one with the fewest open neighbours,
 * so a bystander parked there has the least corridor to slip away down.
 *
 * WHY A BYSTANDER NEEDS THIS AND `findOpenWithNeighbor` IS THE WRONG TOOL FOR IT. The
 * finders above pick a tile by ONE side: `findOpenWithNeighbor(snap, "right")` promises
 * an open corridor to the right and says nothing about the other three. That is exactly
 * right for a check that drives the forager that way, and exactly wrong for one that
 * needs it to stand still — it guarantees the one thing a resting forager can swim off
 * down. A build whose forager keeps going when no key is held (a reading
 * `specs/movement.md` allows; see `parkForager`) then grazes its way along that corridor
 * for the whole measurement, re-arming the brightness hold at every pellet.
 *
 * `parkForager` answers that by facing the forager at a wall, which pins it under either
 * reading — but only if the tile HAS a wall to face, and it is the caller who chose the
 * tile. So choose one that does, and while at it the one with the most walls available.
 * A conforming maze has no dead ends (`specs/maze.md`), so the best on offer is two open
 * sides and two walls; this returns whichever tile comes closest.
 */
export function findEnclosedTile(snap) {
  let best = null;
  let bestOpen = 5;
  for (const [c, r] of openTiles(snap)) {
    const n = openNeighborDirs(snap, c, r).length;
    if (n < bestOpen) {
      bestOpen = n;
      best = { tx: c, ty: r };
      if (n <= 2) break; // nothing tighter exists in a maze with no dead ends
    }
  }
  if (!best) throw unmetPrecondition("no open tile to park a bystander on");
  return best;
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
  throw unconstructibleOr(snap, "no corner/junction found");
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
 * How much of the straight line between two tile centers runs through rock, in px.
 *
 * `losClear` answers a yes/no question — does the supercover walk hit a wall — and two
 * conforming builds can honestly disagree about it, because the spec fixes only that
 * "a wall breaks it" and not how a sight line is traced. The case that splits them is
 * the CORNER CLIP: two tiles diagonally offset around a bend, where the segment between
 * their centers passes through the very tip of one wall tile. A supercover walk calls
 * that blocked; a build that samples its ray every few pixels can step straight over
 * the corner and call it clear. Neither is wrong.
 *
 * This measures the same geometry as a quantity instead, so a scenario can ask for a
 * pair that is occluded by a margin no reasonable tracer can disagree about, rather
 * than one that merely satisfies this file's own tie-break. See `findOccludedPair`.
 */
export function wallSpan(snap, fc, fr, tc, tr) {
  const { grid } = snap;
  const a = tileCenter(grid, fc, fr);
  const b = tileCenter(grid, tc, tr);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  // 2 px steps: fine enough that a sliver of rock is not stepped over, coarse enough
  // that the longest line in the band is a few hundred samples.
  const n = Math.max(1, Math.round(len / 2));
  let inside = 0;
  for (let i = 1; i < n; i++) {
    const x = a.x + ((b.x - a.x) * i) / n;
    const y = a.y + ((b.y - a.y) * i) / n;
    const c = Math.floor((x - grid.originX) / grid.tile);
    const r = Math.floor((y - grid.originY) / grid.tile);
    if (isWall(snap.tiles, c, r)) inside++;
  }
  return (inside / n) * len;
}

/**
 * The CLOSEST pair of open tiles whose straight line of sight is SOLIDLY BLOCKED by
 * rock — a forager tile and a predator tile with a wall between them — within a
 * euclidean distance band (tile-center to tile-center, in logical pixels). This is the
 * general OCCLUSION the sensing checks need: light and line-of-sight are stopped by
 * walls, so a predator behind rock is neither lit nor sensed. It requires no particular
 * corner shape (an L bend, two parallel corridors one wall apart, a bend around the den
 * — any wall on the sight line does), which is why it works on any real one-wide maze
 * rather than only one that happens to have a tight blind corner. Returns { forager,
 * pred, tiles } (tiles = manhattan distance), matching the old findBlindPair shape.
 *
 * `minDist` defaults low (a pair comfortably inside any sensing radius); raise it past
 * the Gloamfin's 64 px hearing when a check must isolate SIGHT from hearing. `maxDist`
 * keeps the pair inside the relevant sensing range, so the wall — not distance — is the
 * only thing between them.
 *
 * WHY A WALL-SPAN FLOOR AND NOT JUST `losClear`. Taking the closest blocked pair used
 * to hand these checks a CORNER CLIP: tiles two steps apart around a bend, whose sight
 * line grazes the tip of one wall tile for a few pixels (see `wallSpan`). Two things go
 * wrong there, and both were real. A build whose own sight tracer steps over that
 * corner is scored as lighting a predator through rock when it did nothing of the sort.
 * And the predator is posed a single step out of view, so the moment the scenario runs
 * its own wander carries it around the corner and into the light within a tenth of a
 * second — which turns the verdict into a race against the pose and leaves the captured
 * still showing a predator standing in plain sight, the opposite of what the item says.
 * Requiring a full tile of rock on the line fixes both at once: the occlusion is one no
 * tracer disagrees about, and the predator starts far enough back that nothing it does
 * in the measurement window can expose it. A conforming maze has thousands of such
 * pairs; this is not a scarce shape.
 *
 * When no such pair exists in the band, the maze is locally open where this check
 * needed rock. That is legitimate only on a conforming maze, so this distinguishes the
 * two causes: if the build ALSO breaks a required corridor proportion (openness /
 * mazing / density — the properties that force occlusion to exist; see
 * mazeProportionChecks), the missing scenario is the build's fault and this throws a
 * HARD failure; otherwise the scenario was simply unconstructible and it throws an
 * unmet precondition (exempt).
 */
export function findOccludedPair(
  snap,
  { minDist = 40, maxDist = 150, minWallSpan } = {},
) {
  const { tiles, grid } = snap;
  // One whole tile of rock on the sight line, in the build's own tile size.
  const wallFloor = minWallSpan ?? grid.tile;
  const opens = [];
  for (let r = 1; r < grid.rows - 1; r++) {
    for (let c = 1; c < grid.cols - 1; c++) {
      if (isOpen(tiles, c, r)) opens.push([c, r]);
    }
  }
  let best = null;
  let bestD = Infinity;
  for (const [fc, fr] of opens) {
    const a = tileCenter(grid, fc, fr);
    for (const [pc, pr] of opens) {
      if (fc === pc && fr === pr) continue;
      const b = tileCenter(grid, pc, pr);
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < minDist || d > maxDist || d >= bestD) continue;
      if (losClear(snap, fc, fr, pc, pr)) continue; // want sight BLOCKED
      if (wallSpan(snap, fc, fr, pc, pr) < wallFloor) continue; // and solidly so
      best = {
        forager: { tx: fc, ty: fr },
        pred: { tx: pc, ty: pr },
        tiles: Math.abs(fc - pc) + Math.abs(fr - pr),
      };
      bestD = d;
    }
  }
  if (best) return best;
  throw unconstructibleOr(
    snap,
    `no pair in the ${minDist}-${maxDist} px band with ${wallFloor} px of rock on the sight line`,
  );
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
 * A straight-corridor standoff for the ink items: the tile the forager drops its cloud
 * on, the tile the predator waits on `gap` tiles further along that same corridor, and
 * the direction the forager then swims to get CLEAR of its own cloud — which leaves the
 * cloud squarely between the two.
 *
 * WHY THE RETREAT IS PART OF THE GEOMETRY. Ink is released "centered on the forager"
 * (`specs/gameplay.md`) and nothing else can place it, so a scenario that poses the two
 * a couple of tiles apart and inks has BOTH of them standing inside the same `80 px`
 * cloud. The check still decides correctly, but the evidence it captures shows a
 * predator and a forager swallowed by one blot, which is not what "ink between them"
 * looks like and is not what a reviewer needs to see. Swimming the forager `clearTiles`
 * back afterwards is what separates them: `80 px` is 2.5 tiles, so three tiles of
 * retreat is the least that puts the forager outside its own cloud, and the corridor
 * must be long enough to hold that retreat, the ink tile, and the gap.
 *
 * The line is kept STRAIGHT so the cloud is the only thing between them — a bent route
 * would put rock on the sight line too, and a sight-based predator losing its fix would
 * no longer be attributable to the ink. The wrap-tunnel row is skipped so a retreat
 * cannot slip through the seam and re-emerge on the far side of the maze.
 *
 * Returns `{ ink, pred, dir, flee, clearTiles }` — `dir` points from the ink tile at the
 * predator, `flee` is the way the forager swims out of the cloud.
 */
export function findInkStandoff(snap, { gap, clearTiles = 3 }) {
  const { tiles, grid } = snap;
  const need = clearTiles + 1 + gap;
  const wrap = wrapRow(snap);
  const run = (cells, dir) => {
    let len = 0;
    for (let i = 0; i < cells.length; i++) {
      len = isOpen(tiles, cells[i][0], cells[i][1]) ? len + 1 : 0;
      if (len >= need) {
        const start = cells[i - need + 1];
        const [dc, dr] = DIRS[dir];
        const ink = {
          tx: start[0] + dc * clearTiles,
          ty: start[1] + dr * clearTiles,
        };
        return {
          ink,
          pred: { tx: ink.tx + dc * gap, ty: ink.ty + dr * gap },
          dir,
          flee: OPP[dir],
          clearTiles,
        };
      }
    }
    return null;
  };
  for (let r = 1; r < grid.rows - 1; r++) {
    if (r === wrap) continue;
    const cells = [];
    for (let c = 1; c < grid.cols - 1; c++) cells.push([c, r]);
    const found = run(cells, "right");
    if (found) return found;
  }
  for (let c = 1; c < grid.cols - 1; c++) {
    const cells = [];
    for (let r = 1; r < grid.rows - 1; r++) cells.push([c, r]);
    const found = run(cells, "down");
    if (found) return found;
  }
  throw unmetPrecondition(
    `no straight corridor run of ${need} tiles to stand an ink cloud between a forager ` +
      `and a predator ${gap} tiles away`,
  );
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

/**
 * An open tile at least `minMan` tiles (manhattan) from `from` ({tx, ty}) — and, when
 * `minPx` is given, at least that far in a straight line as well.
 *
 * WHY THERE IS A PIXEL FLOOR AS WELL AS A TILE ONE. A manhattan count and a sensing
 * RADIUS are different shapes, so a caller that means "outside the Flarefish's `192 px`
 * flare" cannot say so in tiles: a tile 8 apart on the manhattan grid sits as close as
 * `8 / sqrt(2)` ≈ 5.66 tiles ≈ `181 px` when the offset is diagonal, which is INSIDE the
 * bloom. A check that poses a predator "far, so it flares harmlessly" and picks the tile
 * by manhattan alone is therefore betting on where the maze happened to leave its open
 * tiles — it holds on one layout and quietly stops holding on the next, which is the
 * worst way for a precondition to fail. Every radius the spec fixes (the flare, the
 * light detection ranges, the Kindle vision circle) is euclidean, so a caller that means
 * one of them passes it here in px and gets a tile that is actually outside it.
 */
export function findFarTile(snap, from, minMan, { minPx = 0 } = {}) {
  const a = tileCenter(snap.grid, from.tx, from.ty);
  for (const [c, r] of openTiles(snap)) {
    if (Math.abs(c - from.tx) + Math.abs(r - from.ty) < minMan) continue;
    if (minPx > 0) {
      const p = tileCenter(snap.grid, c, r);
      if (Math.hypot(p.x - a.x, p.y - a.y) < minPx) continue;
    }
    return { tx: c, ty: r };
  }
  throw unmetPrecondition(
    `no open tile at least ${minMan} tiles away` +
      (minPx > 0 ? ` and ${minPx} px clear in a straight line` : ""),
  );
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** Distance in px from point (px, py) to the segment (ax, ay)-(bx, by). */
export function distToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : clamp01(((px - ax) * vx + (py - ay) * vy) / len2);
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

/**
 * An open tile to SLIP AWAY to while a predator is pathing to a stale fix: far enough
 * from every point the predator can occupy on its way there that a shrunken detection
 * range cannot re-find the forager, yet still within `maxFromFix` of the fix itself.
 *
 * `pred` is where the predator started and `fix` the tile it is pathing to; while it
 * lingers it can be anywhere on that run, so the clearance is measured against the whole
 * segment, not just its endpoints. Keeping the tile inside `maxFromFix` (the range the
 * predator HAD while the forager was bright) is what makes a lost fix attributable to the
 * dimming rather than to the distance alone.
 */
export function findSlipTile(snap, { pred, fix, minClear, maxFromFix }) {
  const a = tileCenter(snap.grid, pred.tx, pred.ty);
  const b = tileCenter(snap.grid, fix.tx, fix.ty);
  let best = null;
  let bestClear = -Infinity;
  for (const [c, r] of openTiles(snap)) {
    const p = tileCenter(snap.grid, c, r);
    if (Math.hypot(p.x - b.x, p.y - b.y) > maxFromFix) continue;
    const clear = distToSegment(p.x, p.y, a.x, a.y, b.x, b.y);
    if (clear < minClear) continue;
    // Prefer the roomiest tile, so a build whose predator overshoots the fix slightly
    // still cannot stumble back into range.
    if (clear > bestClear) {
      bestClear = clear;
      best = { tx: c, ty: r };
    }
  }
  if (!best) {
    throw unmetPrecondition(
      `no open tile at least ${minClear} px clear of the run to the fix and still ` +
        `within ${maxFromFix} px of it`,
    );
  }
  return best;
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
//
// Hard PASS/FAIL bounds on the corridor proportions the spec fixes (specs/maze.md):
// a conforming board reads as corridors, not rooms, and is dense enough that wall
// occlusion — the thing light-vs-line-of-sight sensing turns on — is guaranteed to
// exist somewhere. These are the outer limits (the spec's "aim for" targets sit well
// inside them); the reference maze measures openness ~2.16, mazing ~3.82, density ~0.53.
export const MAZE_OPENNESS_MIN = 2.0; // <2 is impossible without a dead end
export const MAZE_OPENNESS_MAX = 2.8; // above this the board reads as rooms, not corridors
export const MAZE_MAZING_MIN = 2.0; // below this it is a grid: a junction at nearly every tile
export const MAZE_MAZING_MAX = 8.0; // far above the ~5 target: long sparse hallways, few choices
export const MAZE_DENSITY_MIN = 0.4; // corridors must fill a substantial share of the interior
export const MAZE_DENSITY_MAX = 1.0; // no real upper (one-wide + no-2x2 caps it well below 1)

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
 * chamber is exempt from the symmetry requirement (specs/maze.md): its single gate
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

/**
 * Tiles a PREDATOR can reach from any of `sources` ([c, r] pairs) over the
 * predator-traversable graph — corridors, the den interior, and the gate ('.'/'d'/'g') —
 * wrap-aware, mirroring the reference `Maze.predOpen` adjacency the chase pathfinder
 * uses. Returns a Set of "c,r" keys. Seeded from the den, this is the set of tiles a
 * released predator can actually get to; if the forager's spawn is not in it, the den is
 * walled off from the corridors and the predators are stranded.
 */
export function predatorReachable(snap, sources) {
  const seen = new Set();
  const key = (c, r) => `${c},${r}`;
  const stack = [];
  for (const [c, r] of sources) {
    if (isPredOpen(snap.tiles, c, r) && !seen.has(key(c, r))) {
      seen.add(key(c, r));
      stack.push([c, r]);
    }
  }
  while (stack.length) {
    const [c, r] = stack.pop();
    for (const d of ["up", "down", "left", "right"]) {
      const [nc, nr] = stepTile(snap, c, r, d);
      if (isPredOpen(snap.tiles, nc, nr) && !seen.has(key(nc, nr))) {
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

/**
 * Mean corridor run length ("mazing", specs/maze.md): a run is a maximal chain of
 * corridor tiles that each have exactly two open neighbors — the straightaways and
 * bends between one junction and the next — and this is the mean run length in tiles.
 * A grid with a junction at almost every tile trends toward 1; long sparse hallways
 * trend high. Returns 0 when there are no two-neighbor tiles at all (a pure grid),
 * which reads as maximally grid-like.
 */
export function meanCorridorRun(snap) {
  const key = (c, r) => `${c},${r}`;
  const deg2 = new Set(
    openTiles(snap)
      .filter(([c, r]) => openNeighborDirs(snap, c, r).length === 2)
      .map(([c, r]) => key(c, r)),
  );
  const seen = new Set();
  const runs = [];
  for (const [c, r] of openTiles(snap)) {
    if (!deg2.has(key(c, r)) || seen.has(key(c, r))) continue;
    let size = 0;
    const stack = [[c, r]];
    seen.add(key(c, r));
    while (stack.length) {
      const [x, y] = stack.pop();
      size++;
      for (const d of ["up", "down", "left", "right"]) {
        const [nx, ny] = stepTile(snap, x, y, d);
        if (
          isOpen(snap.tiles, nx, ny) &&
          deg2.has(key(nx, ny)) &&
          !seen.has(key(nx, ny))
        ) {
          seen.add(key(nx, ny));
          stack.push([nx, ny]);
        }
      }
    }
    runs.push(size);
  }
  return runs.length ? runs.reduce((a, b) => a + b, 0) / runs.length : 0;
}

/** Corridor tiles as a fraction of the non-border interior cells (density). */
export function corridorDensity(snap) {
  const { grid } = snap;
  const interior = (grid.rows - 2) * (grid.cols - 2);
  return interior > 0 ? openTiles(snap).length / interior : 0;
}

/** The three corridor proportions the spec bounds: { openness, mazing, density }. */
export function mazeProportions(snap) {
  return {
    openness: avgOpenNeighbors(snap),
    mazing: meanCorridorRun(snap),
    density: corridorDensity(snap),
  };
}

/**
 * Each corridor proportion measured against its hard [min, max], as
 * { name, value, min, max, ok }. The single source of truth shared by the
 * maze.proportions checklist item and the occlusion finder's fallback, so a build that
 * defeats an occlusion scenario BY breaking one of these is judged against the same
 * bounds either way.
 */
export function mazeProportionChecks(snap) {
  const p = mazeProportions(snap);
  return [
    {
      name: "openness",
      value: p.openness,
      min: MAZE_OPENNESS_MIN,
      max: MAZE_OPENNESS_MAX,
    },
    {
      name: "mazing",
      value: p.mazing,
      min: MAZE_MAZING_MIN,
      max: MAZE_MAZING_MAX,
    },
    {
      name: "density",
      value: p.density,
      min: MAZE_DENSITY_MIN,
      max: MAZE_DENSITY_MAX,
    },
  ].map((m) => ({ ...m, ok: m.value >= m.min && m.value <= m.max }));
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
 * Hold the forager still on a tile, as a BYSTANDER, for a scenario that reads
 * something else (a predator's patrol, a drifter's persistence, a cue).
 *
 * WHY THIS EXISTS. `specs/movement.md` and `specs/instrumentation.md` disagree about
 * what a forager with no key held does. Movement describes the arcade rule — it
 * "keeps going straight until it can either turn that way or reaches a wall and
 * stops", and a direction key only "sets the desired direction" — so a conforming
 * build may well swim on its own. Instrumentation describes `setForager` as leaving
 * it "at rest (as if no movement key is held)", which reads as stopped. Both are
 * legitimate; a check must not silently require one.
 *
 * A drifting bystander wrecks these scenarios outright: it grazes plankton (which
 * re-brightens `G` and moves every light-range threshold), and once `poseLastPlankton`
 * has stripped the board to a single adjacent pellet, its very first step eats it,
 * clears the maze and descends — re-denning every predator mid-measurement.
 *
 * So pose the forager FACING A WALL. Its heading leads nowhere, so it cannot leave the
 * tile under either reading, using nothing but the documented `setForager`. On a build
 * that already rests, this is a no-op beyond the facing.
 *
 * `tile` defaults to wherever the forager already stands. Returns the snapshot taken
 * after parking. Only for scenarios where the forager's own facing does not matter —
 * a check that reads its heading must pose that heading itself.
 */
export async function parkForager(api, tile) {
  const snap = await api.snapshot();
  const tx = tile ? tile.tx : snap.forager.tx;
  const ty = tile ? tile.ty : snap.forager.ty;
  const open = openNeighborDirs(snap, tx, ty);
  // A one-wide maze leaves nearly every tile with at least one walled side; a full
  // crossroads has none, in which case the best available is to leave the facing
  // alone (a resting build still holds, and the caller's finder picked the tile).
  const walled = ["up", "down", "left", "right"].filter(
    (d) => !open.includes(d),
  );
  await api.call(
    "setForager",
    walled.length ? { tx, ty, dir: walled[0] } : { tx, ty },
  );
  return api.snapshot();
}

/**
 * Strip the board to one plankton for a scenario the forager only watches: park it
 * facing a wall FIRST, so the single pellet `poseLastPlankton` leaves adjacent to it
 * cannot be eaten, and the maze cannot clear out from under the measurement.
 *
 * Pair this with `parkForager` (see there for why a bystander forager may drift). Use
 * plain `poseLastPlankton` — never this — in a check that is ABOUT clearing the maze.
 */
export async function quietBoard(api, tile) {
  const snap = await parkForager(api, tile);
  await api.call("poseLastPlankton");
  return snap;
}

/**
 * Frame a still on the DEN: hold every predator inside it, stand the forager on the
 * corridor tile just outside the gate facing in, and open the light right up.
 *
 * The two den-structure items (`maze/den-enclosed`, `maze/den-one-exit`) decide their
 * verdicts by reading `snapshot.tiles`, so nothing here can change what they conclude.
 * What it changes is the evidence: Fathom's maze is drawn only where the forager's light
 * falls (`specs/gameplay.md`), so a still captured from the spawn tile is a picture of
 * some other corner of the board, and a reviewer checking "is the den walled in, with one
 * way out" has nothing to look at. Walking the forager to the gate and setting `G = 1`
 * puts the chamber, its wall, and its single entrance in the frame.
 *
 * The forager is faced INTO the gate, which it cannot pass (`specs/movement.md`), so it
 * stays put whether or not this build lets a forager with no key held swim on (see
 * `parkForager`). The predators are held in the den by `setPredator(…, "den")` — they
 * are the den's occupants, so this both keeps them off the forager standing at their
 * doorway and shows what the chamber is for.
 *
 * Best effort: a maze with no gate simply keeps the default framing rather than turning a
 * structural verdict into a precondition failure.
 */
export async function arrangeDenView(api, snap) {
  await denAllExcept(api, []);
  let approach;
  try {
    approach = findGateApproach(snap);
  } catch {
    return; // no gate to stand outside; the structural read still stands on its own
  }
  await api.call("setForager", {
    tx: approach.tx,
    ty: approach.ty,
    dir: approach.dir,
  });
  await api.call("setBrightness", 1);
}

/**
 * Park every predator in the den (a clean baseline), except the ones named in
 * `except`. Used so a scenario reads one predator's behavior undisturbed.
 *
 * `setPredator(kind, { mode: "den" })` HOLDS a predator there for as long as the
 * scenario runs (specs/instrumentation.md), so this is what makes the rest of the board
 * quiet. Returns a token to hand to `boardDisturbance` — the kinds it denned, and the
 * lives and screen it left behind — so a scenario that later finds its subject in an
 * unexpected state can say WHICH predator broke the quiet rather than blaming the one
 * it was watching.
 */
export async function denAllExcept(api, except = []) {
  const denned = [];
  for (const kind of ["lanternjaw", "gloamfin", "flarefish"]) {
    if (!except.includes(kind)) {
      await api.call("setPredator", kind, { mode: "den" });
      denned.push(kind);
    }
  }
  const snap = await api.snapshot();
  return { denned, lives: snap.lives, screen: snap.screen };
}

/**
 * What broke the quiet board `denAllExcept` posed, as a sentence, or null if nothing
 * did. `quiet` is that helper's return value and `snap` the state to judge.
 *
 * WHY A SCENARIO NEEDS THIS. When a long-running item finds its subject somewhere
 * unexpected, the honest question is whether the SUBJECT did something or whether the
 * scenario stopped holding. A predator that was posed into the den and is now loose has
 * broken the precondition; a life lost re-dens every predator at once
 * (specs/predators.md), which drops the subject into `den` through no fault of its own.
 * Reported as "the subject left its wander", both of those read as a finding about the
 * subject, which is exactly the wrong diagnosis — so an item that is about to give up
 * asks this first and names the real cause.
 */
export function boardDisturbance(snap, quiet) {
  if (!quiet) return null;
  if (snap.lives < quiet.lives) {
    const held = quiet.denned.filter((k) => pred(snap, k));
    return (
      `the forager was caught and lost a life mid-measurement, which returned every ` +
      `predator to the den` +
      (held.length
        ? ` — and the ${held.join(" and ")} had been posed into the den, so nothing ` +
          `should have been loose to catch it`
        : "")
    );
  }
  const out = quiet.denned.filter((k) => {
    const p = pred(snap, k);
    return p && p.state !== "den";
  });
  if (out.length) {
    return `the ${out.join(" and ")} left the den it was posed into and disturbed the scenario`;
  }
  if (snap.screen !== quiet.screen) {
    return `the dive left ${quiet.screen} for ${snap.screen} mid-measurement`;
  }
  return null;
}

/**
 * Eat the single plankton `poseLastPlankton` left on the board, whichever open neighbor
 * the build put it on, and return the `until` result of the maze clearing.
 *
 * `poseLastPlankton` (specs/instrumentation.md) promises only "a single one placed on an
 * open tile adjacent to the forager" — WHICH neighbor is the build's own choice, and
 * `snapshot` does not report plankton positions, so a check cannot read it off the board.
 * Guessing one direction only tests builds that happen to break the tie the same way the
 * reference does, so this tries each open neighbor in turn instead: it returns the forager
 * to its home tile between attempts (a control op, arranging the retry) and lets the real
 * eat-and-clear path decide the outcome. Nothing here fabricates the clear.
 *
 * Call it with the forager still standing where `poseLastPlankton` was called, since that
 * is the tile the plankton was placed adjacent to.
 */
export async function actEatLastPlankton(api, { perTry = 60 } = {}) {
  const snap = await api.snapshot();
  const home = { tx: snap.forager.tx, ty: snap.forager.ty };
  const dirs = openNeighborDirs(snap, home.tx, home.ty);
  if (!dirs.length) {
    throw unmetPrecondition(
      "the forager's tile has no open neighbor to pose a plankton on",
    );
  }
  let last = null;
  for (const dir of dirs) {
    // Back to the tile the plankton was posed around, facing the neighbor under test, so
    // each attempt starts from the same place regardless of where the last one wandered.
    await api.call("setForager", { tx: home.tx, ty: home.ty, dir });
    await api.call("keyDown", DIR_KEY[dir]);
    // `perTry` defaults to 60 ticks = 0.5 s, twice the ~0.25 s the forager needs to cross
    // one tile at 128 px/s; poll 2 pins down the moment the maze clears.
    last = await api.until(
      (s) => s.screen !== "playing" || s.planktonRemaining === 0,
      { max: perTry, poll: 2 },
    );
    await api.call("keyUp", DIR_KEY[dir]);
    if (last.hit) return last;
  }
  return last;
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
 * soft amber glow with a bright, near-white hot core (specs/maze.md), so the very
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

/**
 * The radii, in px out from a mote's center, that `sampleMoteProfile` reads it at.
 *
 * WHY A PROFILE AND NOT ONE RING. `sampleAmberOrb` reads a single ring 5 px out, which
 * is where the REFERENCE implementation happens to keep its amber: it draws a 14 px orb
 * whose inner 4 px blow out to near-white, so 5 px lands just outside that core, in the
 * halo. But the spec fixes the mote's COLOR and, in words, its shape — "a soft amber mote
 * with a bright core (the amber palette color `#ffd166`)" (specs/gameplay.md,
 * specs/assets.md) — and nothing else: not the orb's radius, not how bright its core is,
 * not how fast the glow falls off. A build that draws the same light tighter (an amber
 * core a couple of px across under a fainter halo) paints an unmistakable amber mote that
 * a 5 px ring reads as dark fog, and a build that draws it wider blows the 5 px ring out
 * to white. Both are the mote the spec asks for.
 *
 * So a mote is read across a spread of radii instead, and "is it amber" is asked of the
 * profile rather than of one arbitrary ring. That still fails a build that draws no amber
 * light at all — nothing in the fog reads amber at ANY radius (see `fog/unrevealed-black`
 * for how dark the unlit ground is) — while leaving a conforming build free to shape its
 * own glow.
 */
export const MOTE_RADII = [0, 2, 4, 6, 8, 10];

/**
 * The rendered color at `radius` px out from (x, y): the center pixel itself at radius
 * 0, otherwise the mean of a 6-point ring at that radius.
 */
export async function sampleMoteRing(api, x, y, radius) {
  if (radius === 0) {
    const [u, v] = uvOf(x, y);
    const p = await api.pixel(u, v);
    return { r: p.r, g: p.g, b: p.b };
  }
  return sampleAmberOrb(api, x, y, radius);
}

/**
 * A mote's rendered color profile: `{ radius, color }` at each of {@link MOTE_RADII},
 * innermost first. Like every pixel read, call it from `act` after an `api.settle` (see
 * the section header above).
 */
export async function sampleMoteProfile(api, x, y) {
  const profile = [];
  for (const radius of MOTE_RADII) {
    profile.push({ radius, color: await sampleMoteRing(api, x, y, radius) });
  }
  return profile;
}

/** The innermost sample of `profile` that reads as a warm amber light, or null. */
export function amberInProfile(profile) {
  return profile.find((sample) => isAmber(sample.color)) ?? null;
}

/**
 * How far apart two motes are drawn, as the LARGEST color distance between their samples
 * at the same radius. Comparing like radius with like keeps the reading honest — two
 * motes drawn identically match at every radius, and one drawn differently (a wider halo,
 * a colder core) separates somewhere in the profile even if it happens to agree on one
 * ring.
 */
export function profileDistance(a, b) {
  let worst = 0;
  for (let i = 0; i < a.length && i < b.length; i++) {
    worst = Math.max(worst, colorDistance(a[i].color, b[i].color));
  }
  return worst;
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
 * Pair with `arrangeMoveKey`. Returns `{ before, after, code, grid }` — the forager
 * states either side of the held key, plus the grid frame `movedAlong` measures in.
 */
export async function actMoveKey(
  api,
  code,
  { ticks = 30, tailTicks = 60 } = {},
) {
  const start = await api.snapshot();
  const before = start.forager;
  await api.call("keyDown", code);
  await api.advance(ticks); // 30 ticks = the old 0.25s, ~one tile at 128 px/s
  const after = (await api.snapshot()).forager;
  await api.advance(tailTicks); // 60 ticks (0.5s) of visible travel for the clip
  await api.call("keyUp", code);
  return { before, after, code, grid: start.grid };
}

/**
 * ARRANGE half of the three "one plankton" items (the score it pays, the brightness it
 * adds, the light that widens with it): stand the forager at the head of a straight
 * corridor with pellets ahead of it, in the dark, ready to swim.
 *
 * WHY IT DOES NOT SIMPLY STAND ON A PELLET. A corridor tile carries a plankton, so a
 * forager posed onto one eats it where it stands, on the first tick, before anything is
 * filmed — the item's whole subject resolves in the instant the scenario is set up, and
 * the clip that is supposed to show a forager grazing shows a forager that has already
 * grazed. So the pellet under the start tile is eaten HERE, instantly and off camera
 * (`skip` runs the real eat but films nothing), and the eat the item measures is the
 * next one: the one the forager swims into while the reviewer watches.
 *
 * Brightness is then returned to `0` — a documented precondition op
 * (`specs/instrumentation.md`), not a fabricated result. That matters for more than the
 * picture: `G` saturates at `1`, so an item that measures "one eat" from wherever the
 * approach happened to leave the forager can land on an eat that raises `G` by almost
 * nothing and widens the light not at all, and fail a build that did exactly what the
 * spec asks. Starting dark means the measured eat always has its full headroom.
 *
 * Returns `{ snap, run }` — the snapshot the corridor was found in, and that corridor
 * (`run.dir` is the way the forager will swim). Pair with `actGrazeOne`.
 */
export async function arrangeGraze(api) {
  const snap = await startPlaying(api);
  // Four tiles: the start pellet, the one the item measures, and room to keep swimming
  // through two more while the clip runs.
  const run = findStraightRun(snap, 4);
  await api.call("setForager", { tx: run.tx, ty: run.ty, dir: run.dir });
  // 12 ticks = 0.1 s: long enough for the real eat on the start tile, far short of the
  // 30 ticks the forager needs to reach the next one.
  await api.skip(12);
  await api.call("setBrightness", 0);
  return { snap, run };
}

/**
 * ACT half of the "one plankton" items: hold the direction key and let the forager swim
 * into the next pellet, returning `{ before, after, hit }` — the snapshots either side
 * of that single eat.
 *
 * The read is taken on the tick the pellet went, found by sweeping at `poll: TICK`. A
 * coarser sweep could step over two pellets at once (they sit one tile — 30 ticks —
 * apart at `128 px/s`) and report one eat paying twice, so the resolution is what makes
 * "one plankton" mean one.
 *
 * The key stays held through the tail, which is what the clip is for: the forager keeps
 * grazing and keeps brightening, so the light visibly opens up around it rather than the
 * whole subject being a single frame's step change.
 */
export async function actGrazeOne(api, dir, { tailTicks = 120 } = {}) {
  const before = await api.snapshot();
  await api.call("keyDown", DIR_KEY[dir]);
  // 90 ticks = 0.75 s, three times the 30 ticks one tile takes.
  const r = await api.until(
    (s) => s.planktonRemaining < before.planktonRemaining,
    { max: 90, poll: TICK },
  );
  const after = r.snap;
  await api.advance(tailTicks);
  await api.call("keyUp", DIR_KEY[dir]);
  return { before, after, hit: r.hit };
}

/**
 * True if the forager's move went the expected way: its POSITION advanced at least half
 * a tile along `dir`.
 *
 * WHY POSITION AND NOT THE TILE INDEX. This used to compare `tx`/`ty` either side of the
 * hold, and that made the verdict a coin flip. The window is 30 ticks, and at the
 * forager's fixed `128 px/s` (specs/movement.md) 30 ticks is 32 px — with a 32 px tile,
 * EXACTLY one tile. So the read landed precisely on the tile boundary, and which side of
 * it the index had reached came down to floating-point accumulation: a build that
 * integrates to y = 128.0000000000001 rather than 128.0 has not "arrived" at the next
 * centre by a 1e-13 margin, reports the tile it came from, and failed a movement it had
 * performed perfectly. Widening the window would only move the coin flip somewhere else,
 * because builds legitimately differ on WHEN the index flips: on crossing the boundary
 * geometrically, or on arriving at the next centre. `snapshot` pins neither ("the tile it
 * is on/nearest"), so no tile-index comparison can be the honest signal here.
 *
 * Position is exact, convention-free, and sits in the same snapshot. Half a tile is the
 * threshold because it is unambiguous in both directions: far more than any jitter or
 * sub-pixel drift, and comfortably under the 32 px a conforming build covers in the
 * window — so this reads "it went that way", and leaves how fast to
 * `maze-movement/constant-speed`. A held key that does nothing still measures 0.
 *
 * No wrap guard is needed: `findOpenWithNeighbor` never places the forager on a border
 * column, so half a tile of travel cannot cross the wrap tunnel's seam.
 */
export function movedAlong(before, after, dir, grid) {
  const [dc, dr] = DIRS[dir];
  const min = grid.tile / 2;
  if (dc !== 0) return (after.x - before.x) * dc >= min;
  return (after.y - before.y) * dr >= min;
}

// The staggered den release (specs/predators.md): the order the predators leave in, and
// the gap between one leaving and the next.
export const DEN_ORDER = ["lanternjaw", "gloamfin", "flarefish"];
export const DEN_RELEASE_GAP = 5;

/**
 * How far a measured release gap may sit from `DEN_RELEASE_GAP`.
 *
 * The spec states the `5 s` flatly, so the band is not there to admit a different
 * schedule — it is sampling slack (a sweep resolves an event to its poll chunk) plus room
 * for a build that arms its timers a beat off. It still fails the two ways a build
 * actually breaks this: releasing everything at once (gap ~0, which is what an absolute
 * release time compared against a clock that is never reset produces after a life is
 * lost), or spacing them out on some other schedule entirely.
 */
export const DEN_RELEASE_SLACK = 1;

/**
 * How soon after live play is running the FIRST predator must be out to count as leaving
 * "immediately" (specs/predators.md: release time `0`).
 *
 * This is what stops a build passing on the gaps alone. Gaps fix the SPACING but leave
 * the origin free, and a den that holds everyone for half a minute and then lets them out
 * `5 s` apart has the spacing exactly right and the schedule entirely wrong. Anchoring the
 * first release closes that: with the head pinned and each gap pinned, the whole schedule
 * is pinned.
 *
 * HALF A SLOT, not a second. Leaving the den is a journey rather than a flag, and builds
 * differ on when they stop calling a predator denned — mid-walk, or once it is clear of
 * the gate. The reference takes about `0.7 s` over that walk and another build could
 * reasonably take longer without being late in any sense the spec cares about, so a
 * one-second bound would fail a conforming build for the pace of its gate animation. Half
 * a slot is the widest bound that still cannot be confused with the NEXT predator's slot
 * at `5 s`, which is the only thing this needs to tell apart.
 */
export const DEN_IMMEDIATE = DEN_RELEASE_GAP / 2;

/** The sweep resolution the den watch runs at, in ticks. */
export const DEN_POLL = 6;

/**
 * How far BEFORE live play resuming the first release may land: ONE SAMPLE, and nothing
 * more.
 *
 * No predator leaves the den while the countdown runs (`specs/predators.md`), so there is
 * no behaviour to be lenient about here — a predator loose before play resumes has spent
 * the player's reorientation moment hunting, and that is the whole point of the check.
 * This is purely the measurement's own resolution: the resume and each release are dated
 * to the first sweep that caught them, so two events one tick apart can be read in either
 * order across a sweep boundary. A build that flips its screen the tick after it starts
 * play would otherwise read as jumping the gun by a hundredth of a second.
 *
 * Deriving it from the poll rather than picking a round number keeps it honest: it can
 * only ever be as large as the uncertainty it exists to absorb.
 */
export const DEN_RESUME_TOLERANCE = DEN_POLL / TICK_HZ;

/**
 * ACT half of the den-release checks: watch the den and return
 * `{ releases, resumedAt }` — the moment each predator left, as `[{ kind, t }]` in the
 * order they came out (`t` is the snapshot's simTime), and the simTime at which live play
 * was first seen running. Stops once all three are out, or once a release is overdue.
 *
 * WHY THE RESUME IS MEASURED ALONGSIDE. The callers assert the GAPS between releases
 * rather than their absolute instants, because the spec fixes the spacing (`5 s` apart, in
 * a fixed order) while leaving one thing open: whether the countdown that precedes live
 * play counts against the first timer. Both readings are conforming and they differ by the
 * whole countdown, so an assertion anchored to the death would fail half of them for a
 * choice the spec never made.
 *
 * But gaps alone under-check the schedule, and it is worth being precise about how: they
 * pin the spacing and leave the ORIGIN free, so a den that holds every predator for half a
 * minute and then releases them `5 s` apart satisfies every gap while breaking the
 * schedule outright. What closes that without re-importing the countdown question is this
 * resume time: whichever way a build reads the countdown, once live play is actually
 * running the first predator is due (release time `0`), so the head of the schedule is
 * anchored to `resumedAt` and every following release to the one before it. A build that
 * releases during its countdown reads as a NEGATIVE offset from the resume, which is
 * early, not late, and passes — as it should.
 *
 * HOW LONG IT WAITS, AND WHY THAT IS NOT A WINDOW. Each release is waited for against its
 * OWN deadline, taken from the schedule: the first until `DEN_RELEASE_GAP` past the resume
 * (if a whole slot goes by with the den still shut, nothing is coming), and each one after
 * it until two slots past the release before it. Miss a deadline and the watch stops
 * there, so `releases` ends where the schedule broke down.
 *
 * The deadlines are deliberately LOOSER than the assertions the callers make — a slot
 * where the check allows a second, two slots where it allows one gap plus slack. That gap
 * between the two is the point. A deadline exists only to stop the watch when nothing is
 * ever coming; if it were tight enough to judge, then a build that releases a little late
 * would trip the deadline instead of the assertion, and the item would report "the
 * Gloamfin never left the den" about a Gloamfin that left a second after the check would
 * have liked. The deadline says whether there is anything to measure; the assertion says
 * whether it was right.
 */
export async function actDenReleases(api, { poll = DEN_POLL, resumeMax } = {}) {
  const releases = [];
  const seen = new Set();
  let resumedAt = null;
  const note = (s) => {
    if (resumedAt === null && s.screen === "playing") resumedAt = s.simTime;
    for (const kind of DEN_ORDER) {
      const p = pred(s, kind);
      if (p && p.state !== "den" && !seen.has(kind)) {
        seen.add(kind);
        releases.push({ kind, t: s.simTime });
      }
    }
  };

  // To live play, so the first slot has something to be due from. A predator that leaves
  // during a build's countdown is caught here too, and reads as early rather than late.
  let last = await api.snapshot();
  note(last);
  let waited = 0;
  const resumeBudget = resumeMax ?? ticksFor(2 * DEN_RELEASE_GAP);
  while (resumedAt === null && waited < resumeBudget) {
    await api.advance(poll);
    waited += poll;
    last = await api.snapshot();
    note(last);
  }
  if (resumedAt === null) return { releases, resumedAt };

  while (releases.length < DEN_ORDER.length) {
    const due =
      releases.length === 0
        ? resumedAt + DEN_RELEASE_GAP
        : releases[releases.length - 1].t + 2 * DEN_RELEASE_GAP;
    const had = releases.length;
    while (releases.length === had) {
      if (last.simTime > due) return { releases, resumedAt };
      await api.advance(poll);
      last = await api.snapshot();
      note(last);
    }
  }
  return { releases, resumedAt };
}

/**
 * ACT half of the den-release checks: park the forager clear of the den, so it is a
 * bystander to a measurement that is about the den's own clock.
 *
 * The forager is not what is being timed here, but it is what a released predator hunts,
 * and a forager caught mid-measurement re-dens every predator and restarts the very
 * schedule being read (specs/predators.md). Standing it well away from the gate — and
 * facing a wall, so it does not drift or graze (see `parkForager`) — leaves the release
 * timers untouched and simply keeps the scenario alive long enough to read them.
 */
export async function parkClearOfDen(api) {
  const snap = await api.snapshot();
  const gate = gateTiles(snap)[0];
  const away = gate
    ? findFarTile(snap, { tx: gate[0], ty: gate[1] }, 10)
    : undefined;
  return parkForager(api, away);
}

/**
 * ACT half of the Gloamfin ping checks: watch for `ticks` and return the distinct
 * pings it emitted, each `{ t, tint, lit }` (`t` is the snapshot's simTime, `lit`
 * whether the Gloamfin's own body was being drawn as the ping left it). Sweeps in
 * `poll`-tick chunks and counts only a FRESH wavefront (one whose front has barely
 * left the source), so a single expanding pulse seen across several samples is one
 * event rather than many; pings within 1 s of each other coalesce, and a violet ping
 * upgraded to orange ("lost you") in that window updates the tint in place.
 *
 * `lit` is carried because "the ping does not draw the Gloamfin itself"
 * (`specs/predators/gloamfin.md`) is a property of the ping, not of one tint: it is
 * stated once, of the wavefront the periodic ping and the guaranteed "lost you" ping
 * both use. Recording it per event lets an item that drove a particular ping assert it
 * without a second scenario.
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
        events.push({
          t: s.simTime,
          tint: p.tint,
          lit: pred(s, "gloamfin").lit,
        });
      } else if (p.tint === "orange") {
        last.tint = "orange";
        last.lit = pred(s, "gloamfin").lit;
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

// ---- Audio (reads the Web Audio cues the build actually schedules) ----------
//
// Fathom's cues are synthesized with the Web Audio API (specs/progression.md), so the
// driver reports every source the build starts (see `api.audio`). The game must not
// autoplay: it creates (or resumes) its AudioContext only on the first real user
// interaction, so before driving an event whose cue is checked, arm audio with a
// GENUINE browser gesture. A build may feed the debug API through a purely logical
// input path and unlock audio only from a real DOM event (a keydown OR a pointer), so
// arming uses both `api.userKey` and a corner `api.userClick` rather than a debug
// `press` — a debug press would leave a conformant build's AudioContext uncreated, so
// no cue would ever be scheduled though it plays fine for a real player. `KeyZ` has no
// game binding (specs/instrumentation.md: movement, confirm/back, pause, mute, sonar,
// and ink each bind other keys) and the (4, 4) click lands in the top-left corner of
// the stage, off the HUD's own readouts and short of any interactive control — Fathom
// takes no pointer input at all (keyboard only, specs/progression.md), so arming never
// disturbs game state. From there a cue is confirmed by the audio log growing across
// the driven event.
export async function armAudio(api) {
  await api.userKey("KeyZ");
  await api.userClick(4, 4);
}

// How long to let the page paint before reading the audio log. See `audioCount`.
const AUDIO_SETTLE_MS = 120;

/**
 * The number of Web Audio sources the build has started so far, read after letting the
 * page paint.
 *
 * THE PAUSE IS THE WHOLE POINT. Scheduling a cue and stepping the simulation are not the
 * same act, and nothing requires them to happen together: `specs/progression.md` asks for
 * a distinct cue on each event and says nothing about which turn of the build's own
 * machinery starts it, while `specs/instrumentation.md`'s render-free rule governs how
 * game STATE advances, not when its sound is handed to Web Audio. A build that raises a
 * sound the moment its simulation decides one is due has started the source by the time
 * `step` returns; an equally conformant build queues the events its step produced and
 * plays them from its render loop, which cannot have run yet — the validate pass holds
 * the manual clock and steps between driver round trips, so no frame has been painted
 * since the event happened. Reading the log straight after the step scores the second
 * build as silent for a cue every player hears, and does it as a RACE: it depends on
 * whether an animation frame happened to land in the microseconds between two driver
 * calls, so the same build fails the items that read straight back and passes the one
 * whose cue happens to precede a long sweep, on the incidental latency of that sweep's
 * round trips.
 *
 * `api.settle` is a real pause in both passes but moves no simulation (see
 * `packages/browser-driver/validation.mjs`), so it gives the render loop its frame
 * without letting the game reach any further event that could confuse the reading. Both
 * ends of a cue measurement go through here, so the count either side is a settled one
 * and the delta belongs to the event that was driven between them — settling only the
 * second read would let a cue queued during setup drain into it and pass an item that
 * never made its own sound.
 */
export async function audioCount(api) {
  await api.settle(AUDIO_SETTLE_MS);
  return (await api.audio()).length;
}
