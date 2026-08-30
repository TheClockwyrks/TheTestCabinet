// showcase-capture — record REAL GAMEPLAY media for the case showcase.
//
// Not a validator: a temporary capture driver staged beside the harness to
// (re)record `showcase/base/`'s clip and its stills from the ENGINELESS
// reference implementation. It opens a run through the title menu and then
// plays the defrag cursor with scripted keyboard input, in Chromium, against
// the game's own rules — nothing is posed once play has begun — and records
// the whole stretch with the recorder the harness injects.
//
// WHY `references/none`. All three references play the same game, but only the
// engineless project runs in a real browser, where a sprite is a real
// `ImageBitmap` the recorder can capture into the recording's image table. The
// two engine-backed projects render headless over `@napi-rs/canvas`, whose
// decoded images the recorder cannot carry, so their recordings name every
// `drawImage` source as an opaque handle: fine for a validator's evidence,
// which is read beside a baseline drawn exactly the same way, and wrong for a
// showcase, whose whole job is to show a visitor the board as a player sees
// it. So the clip is taken here, where the worm, the nodes, the cursor and the
// foes are the seeded art rather than gaps.
//
// The player has two layers. EXECUTION is bang-bang key input — hold
// ArrowLeft/ArrowRight toward a column, hold Space to fire — through
// Chromium's own input pipeline, so cursor speed, the fire interval and the
// three-bolt cap behave exactly as they do under a human. PLANNING reads the
// board the way a player reads it: which column has what standing over it, and
// what a bolt up that column would do. Where the player needs to be good it
// plans through the game's own rules — the chain a critical node would set off
// is flooded with the `DISCHARGE_RADIUS` and the Chebyshev reach
// specs/discharge.md states — so the shot it goes for is the shot the game
// itself pays out, found honestly rather than by relaxing anything.
//
// Run from the reference workspace root, with the replay cap lifted (see
// showcase/capture/README.md):
//
//   TCAB_VALIDATION_MEDIA_DIR=<out> TCAB_SHOWCASE_MAX_REPLAY_FRAMES=2200 \
//     npx vitest run --config validation/vitest.config.ts \
//     validation/showcase-capture.test.ts

import { afterEach, beforeEach, it } from "vitest";
import {
  BOARD_Y,
  CHARGE_MAX,
  COLS,
  CURSOR_HALF,
  CURSOR_SPEED,
  CURSOR_X_MAX,
  CURSOR_X_MIN,
  CURSOR_Y_MAX,
  DISCHARGE_RADIUS,
  ROWS,
  TILE,
  tileCX,
} from "../src/constants";
import {
  captureReplay,
  captureStill,
  ConstantClock,
  createHarness,
  startRunFromTitle,
  type Harness,
  type WirewormSnapshot,
} from "./harness";

/**
 * The clip's clock: every frame a sixtieth of a second, which is the frame a
 * display gives and therefore the rate the recording should be watched back
 * at. It is not the suite's 100 Hz default, because a replay is thinned to a
 * frame cap and a 60 Hz capture of half a minute lands under the cap whole.
 */
const CLIP_HZ = 60;

/**
 * How many frames pass between two decisions.
 *
 * A player does not re-read the board every sixtieth of a second, and each
 * read here crosses into the page, so planning every other frame is both the
 * more honest cadence and the one that keeps a take to a handful of seconds.
 * The cursor covers `CURSOR_SPEED * PLAN_EVERY / CLIP_HZ` units between two
 * decisions, which is what {@link DEADZONE} is derived from.
 */
const PLAN_EVERY = 2;

/** How close to a target column counts as arrived: half a decision's travel. */
const DEADZONE = (CURSOR_SPEED * PLAN_EVERY) / CLIP_HZ / 2;

/* -------------------------------------------------------------------------- */
/* Reading the board the way a player reads it                                */
/* -------------------------------------------------------------------------- */

/** A tile key, so a board is a plain map rather than a nested array. */
const key = (c: number, r: number): number => r * COLS + c;

/** What a bolt climbing a column would resolve against first. */
type Target =
  | { kind: "none" }
  | { kind: "segment"; r: number; head: boolean }
  | { kind: "node"; r: number; charge: number };

/** The board, indexed for the column scan a shot is chosen by. */
interface Board {
  charge: Map<number, number>;
  segment: Map<number, boolean>;
  head: Map<number, boolean>;
}

function readBoard(snapshot: WirewormSnapshot): Board {
  const charge = new Map<number, number>();
  const segment = new Map<number, boolean>();
  const head = new Map<number, boolean>();
  for (const node of snapshot.nodes) {
    charge.set(key(node.c, node.r), node.charge);
  }
  for (const worm of snapshot.worms) {
    worm.segments.forEach((tile, index) => {
      segment.set(key(tile.c, tile.r), true);
      if (index === 0) head.set(key(tile.c, tile.r), true);
    });
  }
  return { charge, segment, head };
}

/** The row a bolt leaving the cursor starts on (specs/cursor.md). */
function boltRow(snapshot: WirewormSnapshot): number {
  return Math.floor((snapshot.cursor.y - CURSOR_HALF - BOARD_Y) / TILE);
}

/**
 * The first thing standing over column `c`, scanning up from `fromRow` — the
 * order a bolt resolves in, with a segment taking a tile it shares with a node.
 */
function targetIn(board: Board, c: number, fromRow: number): Target {
  for (let r = Math.min(fromRow, ROWS - 1); r >= 0; r -= 1) {
    const at = key(c, r);
    if (board.segment.has(at)) {
      return { kind: "segment", r, head: board.head.has(at) };
    }
    const charge = board.charge.get(at);
    if (charge !== undefined) return { kind: "node", r, charge };
  }
  return { kind: "none" };
}

/** Every tile within the discharge's Chebyshev reach of `(c, r)`, on the board. */
function* within(c: number, r: number): Generator<[number, number]> {
  for (let dc = -DISCHARGE_RADIUS; dc <= DISCHARGE_RADIUS; dc += 1) {
    for (let dr = -DISCHARGE_RADIUS; dr <= DISCHARGE_RADIUS; dr += 1) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
      yield [nc, nr];
    }
  }
}

/**
 * The connected run of charged nodes reaching `(c, r)`, flooded along exactly
 * the links a discharge conducts along (specs/discharge.md).
 */
function cluster(board: Board, c: number, r: number): Set<number> {
  const found = new Set<number>([key(c, r)]);
  const queue: Array<[number, number]> = [[c, r]];
  while (queue.length > 0) {
    const [tc, tr] = queue.shift()!;
    for (const [nc, nr] of within(tc, tr)) {
      const at = key(nc, nr);
      if (found.has(at)) continue;
      if ((board.charge.get(at) ?? 0) < 1) continue;
      found.add(at);
      queue.push([nc, nr]);
    }
  }
  return found;
}

/** What detonating the node on `(c, r)` would take with it, by the game's own rule. */
interface Chain {
  detonated: number;
  fried: number;
}

function chainFrom(board: Board, c: number, r: number): Chain {
  const detonated = cluster(board, c, r);
  const reach = new Set<number>();
  for (const at of detonated) {
    for (const [nc, nr] of within(at % COLS, Math.floor(at / COLS))) {
      reach.add(key(nc, nr));
    }
  }
  let fried = 0;
  for (const at of board.segment.keys()) if (reach.has(at)) fried += 1;
  return { detonated: detonated.size, fried };
}

/**
 * The critical node a column is holding above whatever stands first in it, and
 * how many nodes are in the way — the shot a player works TOWARD rather than
 * one it can take now.
 *
 * Only nodes count as being in the way. A segment cannot be cleared out of a
 * lane, because a bolt into one lays a fresh inert node on the very tile it
 * died on (specs/nodes.md), so the column is blocked again exactly where it
 * was.
 */
function criticalBehind(
  board: Board,
  c: number,
  from: number,
): { r: number; blockers: number } | null {
  let blockers = 0;
  for (let r = Math.min(from, ROWS - 1); r >= 0; r -= 1) {
    const at = key(c, r);
    if (board.segment.has(at)) return null;
    const charge = board.charge.get(at);
    if (charge === undefined) continue;
    if (charge >= CHARGE_MAX) return blockers === 0 ? null : { r, blockers };
    blockers += 1;
  }
  return null;
}

/**
 * What clearing the node on `(c, r)` is worth as a LANE: high when the only
 * thing it stands between a bolt and is a worm segment, low when the column is
 * blocked again further up anyway.
 */
function laneValue(board: Board, c: number, r: number): number {
  for (let above = r - 1; above >= 0; above -= 1) {
    if (board.segment.has(key(c, above))) return 12;
    if (board.charge.has(key(c, above))) return 3;
  }
  return 2;
}

/**
 * How much the player wants to be standing over column `c`, before the travel
 * to get there is charged for.
 *
 * The weights are the game's own payoffs read as a player reads them. A
 * critical node is worth what its chain would take with it. A critical node
 * further up a column is worth clearing the nodes under it to reach. A segment
 * is worth cutting, and the head most of all. An inert node in front of the
 * worm is worth clearing to open the lane. And a node still holding charge
 * inside a cluster is worth leaving alone — that cluster is the discharge the
 * case is about, on its way to happening, and a bolt into it is that discharge
 * thrown away.
 */
function valueOf(
  board: Board,
  c: number,
  from: number,
  target: Target,
): number {
  const behind = criticalBehind(board, c, from);
  if (behind !== null && target.kind === "node") {
    const chain = chainFrom(board, c, behind.r);
    return Math.max(
      1,
      34 + 14 * chain.fried + 4 * chain.detonated - 7 * behind.blockers,
    );
  }
  switch (target.kind) {
    case "none":
      return 0;
    case "segment":
      return target.head ? 46 : 30;
    case "node": {
      if (target.charge >= CHARGE_MAX) {
        const chain = chainFrom(board, c, target.r);
        return 70 + 30 * chain.fried + 8 * chain.detonated;
      }
      if (target.charge > 0) {
        if (cluster(board, c, target.r).size >= 3) return 1;
        return laneValue(board, c, target.r);
      }
      return laneValue(board, c, target.r);
    }
  }
}

/** The columns a segment or a foe is close enough to the cursor to be lethal in. */
function dangerColumns(snapshot: WirewormSnapshot): Set<number> {
  const danger = new Set<number>();
  const cursorRow = Math.floor((snapshot.cursor.y - BOARD_Y) / TILE);
  for (const worm of snapshot.worms) {
    for (const tile of worm.segments) {
      if (tile.r < cursorRow - 1) continue;
      for (let c = tile.c - 2; c <= tile.c + 2; c += 1) danger.add(c);
    }
  }
  for (const foe of snapshot.foes) {
    if (foe.y <= snapshot.cursor.y - 3 * TILE) continue;
    const c = Math.floor(foe.x / TILE);
    for (let d = -2; d <= 2; d += 1) danger.add(c + d);
  }
  return danger;
}

/* -------------------------------------------------------------------------- */
/* The player                                                                 */
/* -------------------------------------------------------------------------- */

/** Where the player wants to stand, and how much it wants to be there. */
interface Aim {
  c: number;
  rating: number;
}

/**
 * The defrag cursor, played. Each decision reads the board, picks the column to
 * stand over and whether to shoot from where it already is, and dispatches real
 * key edges into the page.
 */
class Cutter {
  private movement: "ArrowLeft" | "ArrowRight" | null = null;
  private descending = false;
  private firing = false;
  private aim: Aim | null = null;
  private held = 0;

  /** How long an aim is kept before the board is read for a better one. */
  private readonly commit: number;

  /** `phase` varies the take beyond what the seed does: how patient the aim is. */
  constructor(
    private readonly h: Harness,
    phase = 0,
  ) {
    this.commit = [0.18, 0.26, 0.36][phase % 3];
  }

  private async move(code: "ArrowLeft" | "ArrowRight" | null): Promise<void> {
    if (code === this.movement) return;
    if (this.movement !== null) await this.h.release(this.movement);
    if (code !== null) await this.h.hold(code);
    this.movement = code;
  }

  private async fire(wanted: boolean): Promise<void> {
    if (wanted === this.firing) return;
    if (wanted) await this.h.hold("Space");
    else await this.h.release("Space");
    this.firing = wanted;
  }

  /** Let every key up — between takes, so nothing leaks into the next one. */
  async releaseAll(): Promise<void> {
    await this.move(null);
    await this.fire(false);
    if (this.descending) {
      await this.h.release("ArrowDown");
      this.descending = false;
    }
    this.aim = null;
    this.held = 0;
  }

  /** One decision, taken against `snapshot` and dispatched as key edges. */
  async decide(snapshot: WirewormSnapshot): Promise<void> {
    if (snapshot.screen !== "playing" || snapshot.phase !== "active") {
      await this.move(null);
      await this.fire(false);
      return;
    }

    // The player rides the floor of its band. The cursor's box then reaches
    // only the bottom row, so a segment crossing row 18 passes over its head.
    if (!this.descending && snapshot.cursor.y < CURSOR_Y_MAX) {
      await this.h.hold("ArrowDown");
      this.descending = true;
    }

    const board = readBoard(snapshot);
    const from = boltRow(snapshot);
    const danger = dangerColumns(snapshot);
    const column = Math.floor(snapshot.cursor.x / TILE);

    // The best column to be over: what a bolt from it would do, less what
    // getting there costs, and never one a segment is already coming down.
    let best: Aim | null = null;
    for (let c = 0; c < COLS; c += 1) {
      if (danger.has(c)) continue;
      const value = valueOf(board, c, from, targetIn(board, c, from));
      if (value <= 0) continue;
      const travel = Math.abs(tileCX(c) - snapshot.cursor.x) / CURSOR_SPEED;
      const rating = value - travel * 26;
      if (best === null || rating > best.rating) best = { c, rating };
    }

    // Commit to a column for a moment rather than re-picking every decision, so
    // the cursor sweeps to a target instead of dithering between two.
    this.held -= PLAN_EVERY / CLIP_HZ;
    if (best !== null && (this.aim === null || this.held <= 0)) {
      this.aim = best;
      this.held = this.commit;
    }

    let wantX: number;
    if (danger.has(column)) {
      // Standing under something: get out from under it, toward the open side.
      const openLeft = !danger.has(column - 3);
      wantX = snapshot.cursor.x + (openLeft ? -4 : 4) * TILE;
      this.aim = null;
    } else {
      wantX = this.aim === null ? snapshot.cursor.x : tileCX(this.aim.c);
    }
    wantX = Math.min(CURSOR_X_MAX, Math.max(CURSOR_X_MIN, wantX));

    const error = wantX - snapshot.cursor.x;
    if (error > DEADZONE) await this.move("ArrowRight");
    else if (error < -DEADZONE) await this.move("ArrowLeft");
    else await this.move(null);

    // Fire once the column the cursor is ACTUALLY over is one worth shooting
    // up — judged where the cursor is, not where it is headed.
    const under = valueOf(board, column, from, targetIn(board, column, from));
    await this.fire(under >= 10 && !danger.has(column));
  }
}

/* -------------------------------------------------------------------------- */
/* Takes                                                                      */
/* -------------------------------------------------------------------------- */

/** What one take turned out to be, which is what a take is judged on. */
interface Take {
  frames: number;
  seconds: number;
  /** Chain-arc discharges set off, and the widest chain any of them ran. */
  discharges: number;
  widest: number;
  /** Segments lost to a discharge, and segments cut by a bolt. */
  fried: number;
  cut: number;
  /** The highest charge any node reached, and how many stood critical at once. */
  peakCharge: number;
  peakCriticals: number;
  score: number;
  deaths: number;
  levelsCleared: number;
  /** The longest stretch, in seconds, in which nothing on the board changed. */
  maxLull: number;
  endedOnBeat: boolean;
}

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness({ clock: new ConstantClock(1000 / CLIP_HZ) });
});

afterEach(async () => {
  await harness?.dispose();
});

it("records a gameplay clip", async () => {
  const h = harness;

  /**
   * One take: reset to `seed`, open a run from the title, and play it out.
   *
   * The same seed replays the identical run — the surface's own contract — so a
   * take can be auditioned with the recorder off and then re-run under it
   * exactly.
   */
  const runTake = async (
    seed: number,
    phase: number,
    record: boolean,
  ): Promise<Take> => {
    const player = new Cutter(h, phase);
    await player.releaseAll();
    await startRunFromTitle(h, { seed });

    const minFrames = Math.round(
      Number(process.env.TCAB_SHOWCASE_MIN_SECONDS ?? "24") * CLIP_HZ,
    );
    const maxFrames = Math.round(
      Number(process.env.TCAB_SHOWCASE_MAX_SECONDS ?? "34") * CLIP_HZ,
    );

    let frames = 0;
    let discharges = 0;
    let widest = 0;
    let fried = 0;
    let cut = 0;
    let peakCharge = 0;
    let peakCriticals = 0;
    let deaths = 0;
    let levelsCleared = 0;
    let arcing = false;
    let lastAction = 0;
    let maxLull = 0;
    let endedOnBeat = false;
    let stillTaken = false;

    // One crossing into the page per decision: the reading that closes a
    // decision is the reading the next one is taken against.
    let after = await h.snapshot();
    let lives = after.lives;
    let level = after.level;
    let nodes = after.nodes.length;
    let segments = 0;

    const segmentsOf = (s: WirewormSnapshot): number =>
      s.worms.reduce((total, worm) => total + worm.segments.length, 0);

    while (frames < maxFrames) {
      await player.decide(after);
      await h.advance(PLAN_EVERY);
      frames += PLAN_EVERY;
      after = await h.snapshot();

      // A discharge is the arcs appearing: count the event and how wide it ran.
      const lost = segments - segmentsOf(after);
      if (after.arcs.length > 0 && !arcing) {
        discharges += 1;
        widest = Math.max(widest, after.arcs.length + 1);
        if (lost > 0) fried += lost;
        lastAction = frames;
      } else if (lost > 0) {
        cut += lost;
        lastAction = frames;
      }
      arcing = after.arcs.length > 0;
      segments = segmentsOf(after);

      let criticals = 0;
      for (const node of after.nodes) {
        peakCharge = Math.max(peakCharge, node.charge);
        if (node.charge >= CHARGE_MAX) criticals += 1;
      }
      peakCriticals = Math.max(peakCriticals, criticals);

      if (after.lives < lives) deaths += 1;
      lives = after.lives;
      if (after.level > level) {
        levelsCleared += 1;
        lastAction = frames;
      }
      level = after.level;

      // A lull is the board standing still. A node cleared, knocked down or
      // laid is action a viewer sees, as much as a segment dying is.
      if (after.nodes.length !== nodes) lastAction = frames;
      nodes = after.nodes.length;
      maxLull = Math.max(maxLull, (frames - lastAction) / CLIP_HZ);

      // The still: the first live frame of a level the run reached by clearing
      // one, which is the board at its most telling — a fresh worm entering
      // over the field the last one left behind. A take that clears no level
      // gives up its still three quarters of the way through instead.
      if (
        record &&
        !stillTaken &&
        after.phase === "active" &&
        after.worms.length > 0 &&
        (levelsCleared > 0 || frames > minFrames * 0.75)
      ) {
        await captureStill(h, "mid-level");
        stillTaken = true;
      }
      if (
        record &&
        process.env.TCAB_SHOWCASE_QA_STILLS === "1" &&
        frames % (CLIP_HZ * 3) < PLAN_EVERY
      ) {
        const at = Math.round(frames / (CLIP_HZ * 3));
        await captureStill(h, `qa-${String(at).padStart(2, "0")}`);
      }

      // End on a settled beat: the hold after a discharge has spent its arcs
      // and the board it left is standing again, never mid-flight.
      if (
        frames >= minFrames &&
        discharges > 0 &&
        !arcing &&
        after.phase === "active" &&
        frames - lastAction >= CLIP_HZ * 0.8 &&
        frames - lastAction < CLIP_HZ * 0.8 + PLAN_EVERY
      ) {
        endedOnBeat = true;
        break;
      }
    }
    await player.releaseAll();

    return {
      frames,
      seconds: frames / CLIP_HZ,
      discharges,
      widest,
      fried,
      cut,
      peakCharge,
      peakCriticals,
      score: after.score,
      deaths,
      levelsCleared,
      maxLull,
      endedOnBeat,
    };
  };

  // A take is judged on what makes a watchable clip: the discharge the case is
  // about landing at all and landing wide, segments falling steadily, no long
  // stretch where the board just sits, a clean ending, and the run surviving.
  const judge = (t: Take): number =>
    t.discharges * 24 +
    t.widest * 3 +
    t.fried * 4 +
    t.cut * 1.5 +
    t.levelsCleared * 12 -
    t.deaths * 20 -
    t.maxLull * 4 +
    (t.endedOnBeat ? 12 : -12);

  // Naming a take skips the audition and records that one, which is how the
  // committed clip is reproduced and how a candidate is eyeballed with
  // `TCAB_SHOWCASE_QA_STILLS=1` before it is chosen.
  const pinned = process.env.TCAB_SHOWCASE_SEED;
  let best: { seed: number; phase: number; rating: number } | null = null;

  if (pinned !== undefined && pinned !== "") {
    best = {
      seed: Number(pinned),
      phase: Number(process.env.TCAB_SHOWCASE_PHASE ?? "0"),
      rating: 0,
    };
  } else {
    const seeds = (process.env.TCAB_SHOWCASE_SEEDS ?? "1,2,3,5,7,11,13,17")
      .split(",")
      .map(Number);
    for (const seed of seeds) {
      for (const phase of [0, 1, 2]) {
        const take = await runTake(seed, phase, false);
        const rating = judge(take);
        console.log(
          `take seed=${seed} phase=${phase}: ${take.seconds.toFixed(1)}s, ` +
            `${take.discharges} discharge(s) widest ${take.widest}, ` +
            `${take.fried} fried, ${take.cut} cut, ` +
            `peak charge ${take.peakCharge} (${take.peakCriticals} critical), ` +
            `${take.levelsCleared} level(s), ${take.deaths} death(s), ` +
            `lull ${take.maxLull.toFixed(1)}s, ` +
            `${take.endedOnBeat ? "clean end" : "ran out"} ` +
            `-> ${rating.toFixed(0)}`,
        );
        if (best === null || rating > best.rating)
          best = { seed, phase, rating };
      }
    }
  }

  // The winning take again, this time under the recorder.
  console.log(`recording take seed=${best!.seed} phase=${best!.phase}`);
  const final = await captureReplay(h, "gameplay", () =>
    runTake(best!.seed, best!.phase, true),
  );
  // The title the winning take opened on, as its own still: the same seed reset
  // to the same title screen, one frame drawn. It is taken AFTER the recorder
  // has closed, so the clip itself is play from its first frame to its last.
  await h.debug.reset({ seed: best!.seed });
  await h.advance(1);
  await captureStill(h, "title");

  console.log(
    JSON.stringify({ seed: best!.seed, phase: best!.phase, ...final }, null, 2),
  );
}, 3_600_000);
