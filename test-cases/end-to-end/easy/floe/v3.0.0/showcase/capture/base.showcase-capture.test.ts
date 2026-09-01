// showcase-capture — record REAL GAMEPLAY for the `base` case showcase.
//
// Not a validator: a temporary capture driver staged beside the harness to
// (re)record `showcase/base/crossing.json.gz`, `mid-crossing.png` and
// `title.png` from the `structured-2d` reference implementation. It opens a run
// the way a player opens one — `reset({ seed })` for a chosen seed, then
// `confirm` on the title's CROSS — and from there plays the critter with real
// held-key input on the four movement actions. Nothing is posed mid-play: the
// four world gates stay on, so bears emerge on the run's own conditions, the
// catch costs a life, the crossing timer drains and the bonus catch comes and
// goes exactly as they do for a player.
//
// The player has two layers, as Carom v3.0.0's drivers do.
//
// EXECUTION is the real input path: a hop is one frame with the direction key
// down (specs/controls.md reads the four movement actions as HELD), so the hop
// cooldown, the refusal rules and the crush all behave exactly as under human
// play.
//
// PLANNING reads the game's own published state — the debug surface's snapshot —
// and plays the sixteen lanes forward. A lane keeps its items exactly one period
// apart on a ring forever (specs/ice.md, specs/water.md), so a lane's whole
// future is recovered from what the snapshot reports about it now: the period is
// the spacing of its items, and coverage at a future moment is that pattern slid
// by `dir * speed * TILE * t`. The player therefore knows when a tile will be
// under a plow and when a floe will be under a column, and it hops on the gaps
// the game gives it. It never asks the build for anything a player could not see
// and it never poses.
//
// Run from the reference workspace root:
//   TCAB_VALIDATION_MEDIA_DIR=<out> TCAB_SHOWCASE_MAX_REPLAY_FRAMES=1500 \
//     npx vitest run --config validation/vitest.config.ts \
//     validation/showcase-capture.test.ts

import { Image } from "@napi-rs/canvas";
import { afterEach, beforeEach, it } from "vitest";
import {
  BAYS,
  ROW_BAYS,
  ROW_CAP,
  ROW_MEDIAN,
  ROW_NEAR,
  STAGE_W,
  TILE,
  WATER_BOTTOM,
  WATER_TOP,
  TICK_HZ,
  colAt,
  tileCX,
} from "../src/constants";
import {
  captureReplay,
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "./harness";
import type { Facing, FloeSnapshot } from "./surface";

/**
 * Tell this host what its decoded bitmaps ARE, so the recorder keeps the art.
 *
 * The harness already stands `fetch` and `createImageBitmap` up over the
 * workspace's own `assets/` tree, so the build's sprites arrive exactly as they
 * do in a browser and the still is drawn with them. A REPLAY is the other half:
 * the engine's recorder keeps a `drawImage` source only when it recognizes the
 * value as a bitmap, and it recognizes one by testing it against this host's
 * `ImageBitmap`. Node defines no such global, so every sprite would record as an
 * opaque marker and the clip would play with the strait drawn and nothing on it.
 *
 * `Image` is what a decoded bitmap is here, and saying so is the whole of it.
 * The build is untouched: it asks the engine's loader for the same paths and
 * draws the same frames, and nothing here can put anything on screen the build
 * did not draw. Fathom v3.0.0's capture driver does exactly this, for exactly
 * this reason.
 */
(globalThis as unknown as Record<string, unknown>).ImageBitmap = Image;

/* -------------------------------------------------------------------------- */
/* Reading the strait's future off the snapshot                               */
/* -------------------------------------------------------------------------- */

/**
 * One lane as a repeating pattern: an item of `span` units every `period` units,
 * the run of them sliding at `rate` units a second.
 *
 * A lane's items sit on a ring a whole number of periods long, so consecutive
 * left edges are exactly one period apart everywhere, at every moment
 * (specs/ice.md, specs/water.md). Sorted, the observed left edges are therefore
 * evenly spaced, and `(max - min) / (n - 1)` recovers the period exactly. That
 * is the whole model: no build internal is read, and the wrap at the ring's ends
 * is already folded into the pattern's periodicity.
 */
interface Lane {
  row: number;
  rate: number;
  period: number;
  span: number;
  /** The left edge of one of the lane's items, at the moment it was read. */
  phase: number;
}

/** A non-negative remainder, which `%` is not for a negative dividend. */
function mod(value: number, by: number): number {
  return ((value % by) + by) % by;
}

/** The sixteen lanes, as patterns, read off one snapshot. */
function readLanes(snapshot: FloeSnapshot): Map<number, Lane> {
  const lanes = new Map<number, Lane>();
  const bands: Array<{
    motions: FloeSnapshot["iceLanes"];
    items: Array<{ row: number; x: number; len: number }>;
  }> = [
    { motions: snapshot.iceLanes, items: snapshot.vehicles },
    { motions: snapshot.waterLanes, items: snapshot.floes },
  ];
  for (const band of bands) {
    for (const motion of band.motions) {
      const own = band.items.filter((item) => item.row === motion.row);
      if (own.length < 2) continue;
      const xs = own.map((item) => item.x).sort((a, b) => a - b);
      const period = (xs[xs.length - 1] - xs[0]) / (xs.length - 1);
      lanes.set(motion.row, {
        row: motion.row,
        rate: motion.dir * motion.speed * TILE,
        period,
        span: own[0].len * TILE,
        phase: xs[0],
      });
    }
  }
  return lanes;
}

/** Whether the lane covers stage `x` at `t` seconds from the reading. */
function covers(lane: Lane, x: number, t: number): boolean {
  return mod(x - lane.phase - lane.rate * t, lane.period) < lane.span;
}

/* -------------------------------------------------------------------------- */
/* The strait, as the player reads it                                         */
/* -------------------------------------------------------------------------- */

const SOLID_ROWS = new Set([ROW_NEAR, ROW_MEDIAN]);

/** How far ahead a lane is played forward when nothing else bounds the answer. */
const HORIZON = 3;

/** The seconds a lane's future is sampled at. */
const SAMPLE = 0.01;

/** Whether a far-shore column is one of an OPEN bay's two columns. */
function openBayAt(snapshot: FloeSnapshot, col: number): boolean {
  for (let bay = 0; bay < BAYS.length; bay += 1) {
    const [left, right] = BAYS[bay];
    if (col === left || col === right) return !snapshot.bays[bay];
  }
  return false;
}

/**
 * The column of an OPEN bay the critter should be heading for, or `null` when
 * every bay is filled.
 *
 * A bay is two columns wide and the top water lane drifts, so the one worth
 * aiming at is the one the drift is carrying the critter toward: reaching it
 * costs nothing, while a bay behind has to be won back a hop at a time against
 * the lane. The nearest column downstream wins, and the nearest column in any
 * direction is the fallback when the drift has already carried the critter past
 * the last of them.
 */
function bayTarget(
  snapshot: FloeSnapshot,
  col: number,
  drift: number,
): number | null {
  let downstream: number | null = null;
  let anywhere: number | null = null;
  for (let bay = 0; bay < BAYS.length; bay += 1) {
    if (snapshot.bays[bay]) continue;
    for (const candidate of BAYS[bay]) {
      if (
        anywhere === null ||
        Math.abs(candidate - col) < Math.abs(anywhere - col)
      ) {
        anywhere = candidate;
      }
      if (drift !== 0 && Math.sign(candidate - col) === Math.sign(drift)) {
        if (
          downstream === null ||
          Math.abs(candidate - col) < Math.abs(downstream - col)
        ) {
          downstream = candidate;
        }
      }
    }
  }
  return downstream ?? anywhere;
}

/**
 * Whether the critter may LAND on a tile right now and survive the landing.
 *
 * The refusal rules (specs/hopping.md) and the two deaths a landing can walk
 * into (specs/ice.md's crush, specs/water.md's deep water), read through the
 * lane patterns rather than through anything the build exposes privately.
 */
function landable(
  snapshot: FloeSnapshot,
  lanes: Map<number, Lane>,
  col: number,
  row: number,
): boolean {
  if (col < 0 || col >= STAGE_W / TILE) return false;
  if (row === ROW_CAP || row > ROW_NEAR) return false;
  if (row === ROW_BAYS) return openBayAt(snapshot, col);
  if (SOLID_ROWS.has(row)) return true;
  const lane = lanes.get(row);
  if (lane === undefined) return false;
  const covered = covers(lane, tileCX(col), 0);
  // An ice tile a vehicle covers is refused; a water tile no floe covers drowns.
  return row >= WATER_TOP && row <= WATER_BOTTOM ? covered : !covered;
}

/**
 * How long a tile stays survivable once the critter is standing on it, in
 * seconds, capped at {@link HORIZON}.
 *
 * On the ice band that is the wait until a vehicle slides over the tile's
 * center, which is the crush. On the water band the critter rides the floe under
 * it, so the floe never leaves; what ends the ride is the drift carrying the
 * critter's center off the stage (specs/water.md), and that is what is measured.
 * The two solid strips and a filled bay last forever.
 */
function survives(lanes: Map<number, Lane>, col: number, row: number): number {
  if (SOLID_ROWS.has(row) || row === ROW_BAYS) return HORIZON;
  const lane = lanes.get(row);
  if (lane === undefined) return 0;
  if (row >= WATER_TOP && row <= WATER_BOTTOM) {
    if (lane.rate === 0) return HORIZON;
    const x = tileCX(col);
    const edge = lane.rate > 0 ? STAGE_W - x : x;
    return Math.min(HORIZON, edge / Math.abs(lane.rate));
  }
  for (let t = 0; t <= HORIZON; t += SAMPLE) {
    if (covers(lane, tileCX(col), t)) return t;
  }
  return HORIZON;
}

/** How long until the critter riding row `row` at `x` is carried off the stage. */
function driftLeft(lanes: Map<number, Lane>, x: number, row: number): number {
  const lane = lanes.get(row);
  if (lane === undefined || lane.rate === 0) return HORIZON;
  const edge = lane.rate > 0 ? STAGE_W - x : x;
  return Math.min(HORIZON, edge / Math.abs(lane.rate));
}

/* -------------------------------------------------------------------------- */
/* The scripted crosser                                                       */
/* -------------------------------------------------------------------------- */

/** How a take is played: the two knobs that make one take differ from another. */
interface Style {
  /**
   * The seconds a landing tile must stay survivable before the player will hop
   * onto it. A patient player waits for wide gaps; an impatient one takes
   * narrow ones and gets further before the bear arrives.
   */
  patience: number;
  /** Which way the player sidesteps when both ways serve equally. */
  lean: -1 | 1;
}

/** A hop the player is willing to make, and how good it is. */
interface Move {
  facing: Facing;
  score: number;
}

const LATERAL: readonly Facing[] = ["left", "right"];

/**
 * Drive the critter one frame: read the strait, choose a hop or none, and put
 * the chosen direction's key down for exactly that frame.
 *
 * The player is greedy and local, which is what a person crossing this strait
 * is. It climbs when the tile above will hold it, sidesteps to a column where
 * the row above is open when it will not, retreats when the tile under it is
 * about to be taken, and rides a floe until something above drifts over it.
 */
class Crosser {
  private held: string | null = null;

  constructor(
    private readonly h: Harness,
    private readonly style: Style,
  ) {}

  /** Put a key down for this frame, releasing whatever was down before. */
  private press(facing: Facing | null): void {
    const code =
      facing === null
        ? null
        : (
            {
              up: "ArrowUp",
              down: "ArrowDown",
              left: "ArrowLeft",
              right: "ArrowRight",
            } as const
          )[facing];
    if (code === this.held) return;
    if (this.held !== null) this.h.release(this.held);
    if (code !== null) this.h.hold(code);
    this.held = code;
  }

  /** Let go of everything — between takes, so no key leaks across a reset. */
  release(): void {
    this.press(null);
  }

  step(): void {
    const snapshot = this.h.snapshot();
    if (
      snapshot.screen !== "playing" ||
      !snapshot.critter.present ||
      snapshot.phase !== "crossing" ||
      snapshot.phaseTimer > 0 ||
      snapshot.critter.hopCooldown > 0
    ) {
      this.press(null);
      return;
    }
    this.press(this.choose(snapshot));
  }

  private choose(snapshot: FloeSnapshot): Facing | null {
    const lanes = readLanes(snapshot);
    const { critter } = snapshot;
    const col = colAt(critter.x);
    const row = critter.row;

    // How hard the player is being pressed. A bear on top of it, a tile about to
    // be taken, or a floe about to carry it off the stage all shorten the gap it
    // is prepared to jump into — which is what a person does under pressure.
    const bear = this.bearPressure(snapshot);
    const footing = SOLID_ROWS.has(row)
      ? HORIZON
      : row >= WATER_TOP && row <= WATER_BOTTOM
        ? driftLeft(lanes, critter.x, row)
        : survives(lanes, col, row);
    const pressed = bear < 96 || footing < 0.5;
    const patience = pressed
      ? Math.min(this.style.patience, 0.16)
      : this.style.patience;

    // The bay: from the top water row, the hop into an open bay ends the
    // crossing, and it is taken the moment the drift lines the critter up.
    if (row === WATER_TOP && landable(snapshot, lanes, col, ROW_BAYS)) {
      return "up";
    }

    // Lining up on a bay. A crossing is won at a bay's two columns, so from the
    // moment the critter is out on the water it steers for one — gently while
    // there are rows still to climb, and hard on the top row, where the only
    // thing left to do is arrive.
    const lane = lanes.get(row);
    const onWater = row >= WATER_TOP && row <= WATER_BOTTOM;
    const aim = onWater
      ? bayTarget(snapshot, col, lane === undefined ? 0 : lane.rate)
      : null;
    const approach = row === WATER_TOP;

    const moves: Move[] = [];
    const consider = (facing: Facing, dc: number, dr: number): void => {
      const c = col + dc;
      const r = row + dr;
      if (!landable(snapshot, lanes, c, r)) return;
      const hold = r === ROW_BAYS ? HORIZON : survives(lanes, c, r);
      if (hold < patience) return;
      // Climbing is the point; a sidestep earns its place by opening a climb,
      // and a retreat is worth taking only when standing still is worse.
      let score = (row - r) * 100 + Math.min(hold, 1.2) * 6;
      if (dr === 0) score += this.climbSoon(snapshot, lanes, c, r) ? 24 : -8;
      if (dr > 0) score -= 40;
      if (dc !== 0) score += dc === this.style.lean ? 1 : 0;
      score += Math.min(this.bearGain(snapshot, c, r), 64) * 0.05;
      if (aim !== null && dc !== 0) {
        // Closing on the bay column. On the approach row it outweighs every
        // other reason to sidestep; below it, it only breaks ties, because a
        // row climbed is worth more than a column gained.
        score +=
          (Math.abs(col - aim) - Math.abs(c - aim)) * (approach ? 55 : 14);
      }
      if (approach && aim !== null && dr < 0 && r > ROW_BAYS) {
        // Nothing above the approach row but far shore: never climb off it
        // short of the bay.
        score -= 120;
      }
      moves.push({ facing, score });
    };

    consider("up", 0, -1);
    for (const facing of LATERAL) {
      consider(facing, facing === "left" ? -1 : 1, 0);
    }
    if (footing < 0.6 || bear < 64) consider("down", 0, 1);

    if (moves.length === 0) return null;
    moves.sort((a, b) => b.score - a.score);
    const best = moves[0];
    // Standing still is a real option: waiting one more beat on solid ice for
    // the gap above to arrive beats sidestepping into nothing.
    if (best.facing !== "up" && footing > 0.9 && best.score < 20 && !approach) {
      return null;
    }
    return best.facing;
  }

  /** Whether the row above `(col, row)` is open, or opens within a beat. */
  private climbSoon(
    snapshot: FloeSnapshot,
    lanes: Map<number, Lane>,
    col: number,
    row: number,
  ): boolean {
    const above = row - 1;
    if (above === ROW_BAYS) return openBayAt(snapshot, col);
    if (SOLID_ROWS.has(above)) return true;
    const lane = lanes.get(above);
    if (lane === undefined) return false;
    const water = above >= WATER_TOP && above <= WATER_BOTTOM;
    for (let t = 0; t <= 0.5; t += SAMPLE) {
      if (covers(lane, tileCX(col), t) === water) return true;
    }
    return false;
  }

  /** The distance to the nearest bear, in stage units. */
  private bearPressure(snapshot: FloeSnapshot): number {
    let nearest = Infinity;
    for (const bear of snapshot.bears) {
      nearest = Math.min(
        nearest,
        Math.hypot(bear.x - snapshot.critter.x, bear.y - snapshot.critter.y),
      );
    }
    return nearest;
  }

  /** How much further from the nearest bear a tile is than the critter is now. */
  private bearGain(snapshot: FloeSnapshot, col: number, row: number): number {
    if (snapshot.bears.length === 0) return 0;
    const x = tileCX(col);
    const y = 80 + row * TILE + TILE / 2;
    let nearest = Infinity;
    for (const bear of snapshot.bears) {
      nearest = Math.min(nearest, Math.hypot(bear.x - x, bear.y - y));
    }
    return nearest - this.bearPressure(snapshot);
  }
}

/* -------------------------------------------------------------------------- */
/* Takes                                                                      */
/* -------------------------------------------------------------------------- */

/** What one take turned out to be, which is what a take is judged on. */
interface Take {
  frames: number;
  /** Bays filled over the take. */
  bays: number;
  /** Rows climbed, counting every crossing. */
  rows: number;
  /** Lives lost. */
  deaths: number;
  /** The longest stretch with nothing happening, in seconds. */
  maxLull: number;
  /** Frames with a bear within five tiles of the critter. */
  hunted: number;
  /** Frames the critter spent on the water band. */
  water: number;
  /** The closest a bear came, in stage units. */
  closest: number;
  /** The best mid-crossing still the take offered, by {@link stillValueOf}. */
  bestStill: number;
  /** It stopped on the hold after a filled bay rather than running out. */
  endedOnBeat: boolean;
  score: number;
}

const seconds = (frames: number): number => frames / TICK_HZ;

/** What the media directory the run writes into is named. */
const QA_STILLS = process.env.TCAB_SHOWCASE_QA_STILLS === "1";

/** Whether a take reports where it stalled, for tuning the player. */
const TRACE = process.env.TCAB_SHOWCASE_TRACE === "1";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("records the base showcase", async () => {
  const h = harness;

  const minFrames = Math.round(
    Number(process.env.TCAB_SHOWCASE_MIN_SECONDS ?? "22") * TICK_HZ,
  );
  const maxFrames = Math.round(
    Number(process.env.TCAB_SHOWCASE_MAX_SECONDS ?? "30") * TICK_HZ,
  );
  /** The seconds the clip keeps rolling after the bay that ends it. */
  const settle = Math.round(
    Number(process.env.TCAB_SHOWCASE_SETTLE_SECONDS ?? "0.9") * TICK_HZ,
  );

  /**
   * One take: open a run at `seed` through the title, play it out with the
   * scripted crosser, and report what it turned into.
   *
   * The same seed and style replay the identical take — that is the debug
   * surface's determinism contract — which is what lets a take be auditioned
   * with the recorder off and then re-run under it exactly.
   */
  const runTake = async (
    seed: number,
    style: Style,
    record: boolean,
  ): Promise<Take> => {
    const player = new Crosser(h, style);
    // A previous take can end mid-press; clear the keyboard so nothing leaks
    // into this one and breaks same-seed reproducibility.
    player.release();
    await startRun(h, seed);

    let frames = 0;
    let bays = 0;
    let rows = 0;
    let deaths = 0;
    let hunted = 0;
    let water = 0;
    let closest = Infinity;
    let maxLull = 0;
    let lastEvent = 0;
    let endedOnBeat = false;
    let filledAt: number | null = null;
    let stillScore = -Infinity;

    let previous = h.snapshot();
    let bestRow = previous.critter.bestRow;

    while (frames < maxFrames) {
      player.step();
      await h.advance(1);
      frames += 1;
      // The draw-call log the harness keeps for the presentation checks grows
      // without bound over thousands of frames, and nothing here reads it.
      if (h.calls.length > 20_000) h.calls.length = 0;

      const snapshot = h.snapshot();
      const filled = snapshot.bays.filter(Boolean).length;
      const wasFilled = previous.bays.filter(Boolean).length;
      if (filled > wasFilled || snapshot.level !== previous.level) {
        bays += 1;
        lastEvent = frames;
        if (filledAt === null && frames >= minFrames - settle) {
          filledAt = frames;
        }
      }
      if (snapshot.lives < previous.lives) {
        deaths += 1;
        lastEvent = frames;
      }
      if (snapshot.critter.present) {
        if (snapshot.critter.bestRow < bestRow) {
          rows += bestRow - snapshot.critter.bestRow;
          bestRow = snapshot.critter.bestRow;
          lastEvent = frames;
        }
        if (
          snapshot.critter.row >= WATER_TOP &&
          snapshot.critter.row <= WATER_BOTTOM
        ) {
          water += 1;
        }
      } else {
        bestRow = ROW_NEAR;
      }
      maxLull = Math.max(maxLull, seconds(frames - lastEvent));
      if (TRACE && frames % Math.round(TICK_HZ / 2) === 0) {
        console.log(
          `  t=${seconds(frames).toFixed(1)}s ${snapshot.screen}/${snapshot.phase}` +
            ` critter ${snapshot.critter.present ? "" : "(gone) "}` +
            `(${snapshot.critter.col}, ${snapshot.critter.row}) ` +
            `${snapshot.critter.footing} bays ${snapshot.bays.map((b) => (b ? "#" : ".")).join("")}` +
            ` bears ${snapshot.bears.length} lull ${seconds(frames - lastEvent).toFixed(1)}`,
        );
      }

      let nearest = Infinity;
      for (const bear of snapshot.bears) {
        nearest = Math.min(
          nearest,
          Math.hypot(bear.x - snapshot.critter.x, bear.y - snapshot.critter.y),
        );
      }
      if (snapshot.critter.present && Number.isFinite(nearest)) {
        closest = Math.min(closest, nearest);
        if (nearest < 5 * TILE) hunted += 1;
      }

      // The mid-crossing still, chosen as the take runs: the critter out on the
      // water with a bear on its heels, the closer and the wetter the better.
      // Only a strictly better moment overwrites the last one, so what survives
      // is the best frame the take produced — and the best value it reached is
      // part of what the take is judged on, so the audition prefers a take that
      // offers a still as well as one that plays well.
      const value = stillValueOf(snapshot);
      if (value > stillScore) {
        stillScore = value;
        if (record) captureStill(h, "mid-crossing");
      }
      if (record) {
        if (QA_STILLS && frames % (TICK_HZ * 2) === 0) {
          captureStill(
            h,
            `qa-${String(frames / (TICK_HZ * 2)).padStart(3, "0")}`,
          );
        }
      }

      previous = snapshot;
      // End on a settled beat: the hold after the bay that ends the crossing,
      // and the fresh critter back on the near shore — never mid-hop.
      if (filledAt !== null && frames - filledAt >= settle) {
        endedOnBeat = true;
        break;
      }
    }

    player.release();
    const take: Take = {
      frames,
      bays,
      rows,
      deaths,
      maxLull,
      hunted,
      water,
      closest: Number.isFinite(closest) ? closest : 999,
      bestStill: Number.isFinite(stillScore) ? stillScore : 0,
      endedOnBeat,
      score: 0,
    };
    take.score = judge(take);
    return take;
  };

  /**
   * What makes a watchable Floe clip: real ground gained, the water crossed,
   * the bear actually in the picture, a bay filled to end on — and no long
   * stretch where nothing happens and no run of deaths.
   */
  function judge(t: Take): number {
    return (
      t.bays * 26 +
      t.rows * 2 +
      Math.min(t.water, 900) * 0.03 +
      Math.min(t.hunted, 900) * 0.04 +
      Math.min(t.bestStill, 140) * 0.45 -
      t.deaths * 12 -
      Math.max(0, t.maxLull - 1.5) * 12 +
      (t.endedOnBeat ? 30 : -30)
    );
  }

  /**
   * How good this frame is as the `mid-crossing` still: the critter out on the
   * water, riding a floe, with a bear behind it.
   *
   * A still has to read at a glance, so what it is scored on is what a viewer
   * would see in it — the critter on a floe rather than on solid ground, a bear
   * near enough to be plainly chasing it but not so near the catch is firing,
   * that bear out on the water rather than back on the ice, and rows of the
   * crossing already behind them.
   */
  function stillValueOf(snapshot: FloeSnapshot): number {
    const { critter } = snapshot;
    if (!critter.present) return -Infinity;
    if (critter.row < WATER_TOP || critter.row > WATER_BOTTOM) return -Infinity;
    if (critter.footing !== "floe") return -Infinity;
    let best = -Infinity;
    for (const bear of snapshot.bears) {
      const distance = Math.hypot(bear.x - critter.x, bear.y - critter.y);
      // Three tiles reads as a pursuit; the catch fires at eighteen units.
      let value = 90 - Math.min(90, Math.abs(distance - 96) * 0.55);
      if (bear.swimming) value += 30;
      if (bear.row >= WATER_TOP && bear.row <= WATER_BOTTOM) value += 20;
      best = Math.max(best, value);
    }
    // A frame with no bear in it is a crossing rather than a hunt: worth
    // something, but never worth more than one with the bear in the picture.
    if (best === -Infinity) best = 0;
    return best + (WATER_BOTTOM - critter.row) * 2;
  }

  const styles: Style[] = [
    { patience: 0.34, lean: 1 },
    { patience: 0.3, lean: -1 },
    { patience: 0.26, lean: 1 },
    { patience: 0.22, lean: -1 },
    { patience: 0.18, lean: 1 },
  ];
  const seeds = (process.env.TCAB_SHOWCASE_SEEDS ?? "1,2,3,4,5")
    .split(",")
    .map((value) => Number(value.trim()));

  // `TCAB_SHOWCASE_TAKE=<seed>:<patience>:<lean>` skips the audition and records
  // exactly that take, which is how a committed clip is reproduced.
  const forced = process.env.TCAB_SHOWCASE_TAKE;
  let best: { seed: number; style: Style; take: Take } | null = null;
  for (const seed of forced === undefined ? seeds : []) {
    for (const style of styles) {
      const take = await runTake(seed, style, false);
      console.log(
        `take seed=${seed} patience=${style.patience} lean=${style.lean}: ` +
          `${seconds(take.frames).toFixed(1)}s, ${take.bays} bay(s), ` +
          `${take.rows} rows, ${take.deaths} death(s), ` +
          `${take.water} water frames, ${take.hunted} hunted frames, ` +
          `closest ${take.closest.toFixed(0)}u, still ${take.bestStill.toFixed(0)}, ` +
          `lull ${take.maxLull.toFixed(1)}s, ` +
          `${take.endedOnBeat ? "clean end" : "ran out"} -> ` +
          take.score.toFixed(1),
      );
      if (best === null || take.score > best.take.score) {
        best = { seed, style, take };
      }
    }
  }

  let winner: { seed: number; style: Style };
  if (forced === undefined) {
    winner = best!;
  } else {
    const [seed, patience, lean] = forced.split(":").map(Number);
    winner = { seed, style: { patience, lean: lean < 0 ? -1 : 1 } };
  }
  console.log(
    `recording take seed=${winner.seed} patience=${winner.style.patience} ` +
      `lean=${winner.style.lean}`,
  );
  const final = await captureReplay(h, "crossing", () =>
    runTake(winner.seed, winner.style, true),
  );

  // The title screen, from the same reference: `reset` puts the game back on it,
  // and one frame draws it.
  h.debug.reset({ seed: winner.seed });
  await h.advance(1);
  captureStill(h, "title");

  console.log(
    JSON.stringify(
      {
        seed: winner.seed,
        style: winner.style,
        seconds: Number(seconds(final.frames).toFixed(2)),
        bays: final.bays,
        rows: final.rows,
        deaths: final.deaths,
        waterFrames: final.water,
        huntedFrames: final.hunted,
        closest: Number(final.closest.toFixed(1)),
        bestStill: Number(final.bestStill.toFixed(1)),
        maxLull: Number(final.maxLull.toFixed(2)),
        endedOnBeat: final.endedOnBeat,
      },
      null,
      2,
    ),
  );
}, 900_000);
