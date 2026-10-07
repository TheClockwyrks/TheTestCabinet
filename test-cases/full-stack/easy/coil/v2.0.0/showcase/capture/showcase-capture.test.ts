// showcase-capture — record a REAL ROUND of Coil for the case showcase.
//
// Not a validator: a temporary capture driver staged beside the harness to
// (re)record a variant's `showcase/<variant>/` replay and its two stills from
// that variant's reference implementation. It opens the title, confirms the
// mode entry with a key press, and then plays the round the way a player does —
// steering with arrow presses, routing to the pellet, and taking the multiplier
// as high as the routing keeps it.
//
// ONE DRIVER, BOTH VARIANTS. Nothing here names a mode. The board's obstacle
// cells are read off the snapshot, so the same routing threads Maze's course
// and crosses Classic's open interior; the two variants differ only in which
// reference the driver is staged into.
//
// EVERY OUTCOME ON SCREEN IS THE GAME'S. Two debug operations are called and no
// others: `reset()`, which opens a fresh session for each take, and
// `snapshot()`, a reading that changes nothing. Nothing is placed, scored,
// grown, or steered through the surface — the snake turns because an arrow key
// was struck, every pellet is where the round's own draw put it, every point is
// the eat's, and the multiplier is whatever the window the game ran left
// standing. Arranging the input is authoring; posing the outcome would be
// fabrication.
//
// AUDITIONING. Every take is a round the game draws for itself, so no take can
// be played again: each is recorded as it is played, judged from what it
// produced, and the best recording is the one kept. The take that was judged is
// then provably the take that was committed. The judge scores what makes a
// watchable clip of THIS game — pellets eaten, the multiplier's peak, how many
// eats landed with it at that peak, whether it was ever lost and rebuilt, and a
// clean ending on the settled beat an eat gives.
//
// Run from the staged reference workspace root:
//   TCAB_VALIDATION_MEDIA_DIR=<out> TCAB_SHOWCASE_MAX_REPLAY_FRAMES=1900 \
//     TCAB_SHOWCASE_TAKES=8 \
//     npx vitest run --config validation/vitest.config.ts \
//     validation/showcase-capture.test.ts

import { it } from "vitest";

import { BINDINGS, COMBO_MAX } from "../src/constants";
import {
  captureReplay,
  captureStill,
  createHarness,
  isInterior,
  ahead,
  sameCell,
  DIRECTIONS,
  FRAME_HZ,
  OPPOSITE,
  type Cell,
  type CoilSnapshot,
  type Dir,
  type Harness,
} from "./harness";

/* -------------------------------------------------------------------------- */
/* The clip's shape                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Frames per second of the take.
 *
 * The harness's own rate, and the one figure the loop below depends on: a tick
 * is `TICK_SECONDS` (0.125 s), so at 64 Hz a tick is exactly eight frames and
 * the driver can decide once per tick without ever straddling one. A replay
 * carries each kept frame's delta, so the clip plays back at the rate it was
 * recorded at.
 */
const seconds = (s: number): number => Math.round(s * FRAME_HZ);

/** Bounds on the recorded take, in frames. */
const MIN_FRAMES = seconds(
  Number(process.env.TCAB_SHOWCASE_MIN_SECONDS ?? "22"),
);
const MAX_FRAMES = seconds(
  Number(process.env.TCAB_SHOWCASE_MAX_SECONDS ?? "28"),
);

/** How long the title menu is left on screen before the mode entry is confirmed. */
const TITLE_HOLD = seconds(1.4);

/** How long the round is watched on after the eat the clip ends on. */
const SETTLE = seconds(1.0);

/** The key each steering action is struck with, as `specs/controls.md` binds it. */
const STEER_KEY: Readonly<Record<Dir, string>> = {
  up: BINDINGS.up[0],
  down: BINDINGS.down[0],
  left: BINDINGS.left[0],
  right: BINDINGS.right[0],
};

/** The key that confirms a menu item. */
const CONFIRM_KEY = BINDINGS.confirm[0];

/* -------------------------------------------------------------------------- */
/* Reading the board                                                          */
/* -------------------------------------------------------------------------- */
//
// The routing below is ordinary play reasoning over what a player can see: the
// walls, the obstacle course, the snake's own body, and where the pellet is. It
// reads all of that off `snapshot()` rather than out of the build's modules, and
// it never writes any of it.

/** A cell's key, for the sets the searches below carry. */
const key = (cell: Cell): number => cell.row * 64 + cell.col;

/**
 * The cells a head may not enter this tick.
 *
 * The wall border and the obstacle course are permanent; the snake's own body
 * is blocked except for the tail cell, which vacates on the same tick the head
 * arrives unless the snake is growing into it. Treating the tail as free is what
 * lets a long snake follow its own body round, which is how the game is played.
 */
function blockedCells(snapshot: CoilSnapshot): Set<number> {
  const blocked = new Set<number>();
  for (const cell of snapshot.obstacles) blocked.add(key(cell));
  for (const cell of snapshot.snake.slice(0, -1)) blocked.add(key(cell));
  return blocked;
}

/** Whether a head may step onto `cell`. */
function passable(cell: Cell, blocked: Set<number>): boolean {
  return isInterior(cell.col, cell.row) && !blocked.has(key(cell));
}

/**
 * How many cells are reachable from `from`, itself included.
 *
 * The room a move leaves behind, which is the one thing that keeps a snake off
 * its own coils: a step into a pocket smaller than the body is a step into a
 * dead end several ticks before the crash shows up.
 */
function room(from: Cell, blocked: Set<number>): number {
  const seen = new Set<number>([key(from)]);
  const queue: Cell[] = [from];
  for (let at = 0; at < queue.length; at += 1) {
    for (const dir of DIRECTIONS) {
      const next = ahead(queue[at], dir);
      if (!passable(next, blocked) || seen.has(key(next))) continue;
      seen.add(key(next));
      queue.push(next);
    }
  }
  return seen.size;
}

/**
 * How many cells of the chain are a bend rather than a straight run.
 *
 * Not part of the routing: it is what a STILL is ranked on, because a chain
 * drawn as one straight bar tells a visitor nothing about a game whose whole
 * difficulty is where the body already is.
 */
function corners(snake: readonly Cell[]): number {
  let bends = 0;
  for (let at = 1; at + 1 < snake.length; at += 1) {
    const before = snake[at - 1];
    const after = snake[at + 1];
    if (before.col !== after.col && before.row !== after.row) bends += 1;
  }
  return bends;
}

/** Steps from `from` to `to` around the blocked cells, or `null` for no route. */
function distance(from: Cell, to: Cell, blocked: Set<number>): number | null {
  if (sameCell(from, to)) return 0;
  const seen = new Set<number>([key(from)]);
  let frontier: Cell[] = [from];
  for (let steps = 1; frontier.length > 0; steps += 1) {
    const next: Cell[] = [];
    for (const cell of frontier) {
      for (const dir of DIRECTIONS) {
        const step = ahead(cell, dir);
        if (seen.has(key(step))) continue;
        if (sameCell(step, to)) return steps;
        if (!passable(step, blocked)) continue;
        seen.add(key(step));
        next.push(step);
      }
    }
    frontier = next;
  }
  return null;
}

/**
 * The heading the player takes next.
 *
 * Every legal step is scored the way a player weighs one: does it leave room
 * for the body that is coming, how much closer to the pellet does it get, and
 * how much of the board does it keep open. Closing on the pellet is what builds
 * the multiplier, because the window is spent in ticks and a tick is a cell —
 * so the shortest route IS the combo, and there is no separate scheme for it.
 */
function steer(snapshot: CoilSnapshot): Dir | null {
  const head = snapshot.snake[0];
  if (head === undefined) return null;
  const blocked = blockedCells(snapshot);
  const reverse = OPPOSITE[snapshot.dir];
  const pellet = snapshot.pellet;

  let best: Dir | null = null;
  let bestScore: [number, number, number] = [-1, -1, -1];
  for (const dir of DIRECTIONS) {
    if (dir === reverse) continue;
    const step = ahead(head, dir);
    if (!passable(step, blocked)) continue;
    const open = room(step, blocked);
    const toPellet = pellet === null ? null : distance(step, pellet, blocked);
    const score: [number, number, number] = [
      open >= snapshot.snake.length + 2 ? 1 : 0,
      toPellet === null ? -Infinity : -toPellet,
      open,
    ];
    if (
      score[0] > bestScore[0] ||
      (score[0] === bestScore[0] &&
        (score[1] > bestScore[1] ||
          (score[1] === bestScore[1] && score[2] > bestScore[2])))
    ) {
      best = dir;
      bestScore = score;
    }
  }
  return best;
}

/* -------------------------------------------------------------------------- */
/* The take                                                                   */
/* -------------------------------------------------------------------------- */

/** What a take left behind, and what the judge reads it by. */
interface Take {
  frames: number;
  eats: number;
  score: number;
  length: number;
  peakCombo: number;
  eatsAtPeak: number;
  lapses: number;
  died: boolean;
  endedOnBeat: boolean;
}

/** One played take of a round, driven entirely through the keyboard. */
class Session {
  private spent = 0;
  private eats = 0;
  private lapses = 0;
  private peakCombo = 1;
  private eatsAtPeak = 0;
  private died = false;
  private endedOnBeat = false;
  /** What the best peak still so far was worth; see {@link Session.offerStill}. */
  private stillWorth = -1;

  constructor(
    private readonly h: Harness,
    /** What this take's stills are written under, or `null` outside a capture. */
    private readonly stills: string | null,
  ) {}

  /** Advance `n` frames of the take's own clock, counting them. */
  private async run(n: number): Promise<void> {
    await this.h.advance(n);
    this.spent += n;
  }

  /** Strike a key, and the frame that delivers its edge, counted. */
  private async press(code: string): Promise<void> {
    await this.h.tap(code);
    this.spent += 1;
  }

  /** What an eat is worth to the clip, and the one still an eat is kept as. */
  private onEat(snapshot: CoilSnapshot): void {
    this.eats += 1;
    if (snapshot.combo > this.peakCombo) {
      this.peakCombo = snapshot.combo;
      this.eatsAtPeak = 0;
    }
    if (snapshot.combo === this.peakCombo) this.eatsAtPeak += 1;
    // The early board: the third eat, while the snake is still short enough that
    // the whole interior reads at a glance around it.
    if (this.stills !== null && this.eats === 3) {
      captureStill(this.h, `${this.stills}-early`);
    }
  }

  /**
   * Keep this frame as the take's peak still if it beats the one held.
   *
   * Offered every tick rather than only at an eat, because the frame that shows
   * the game best is rarely the frame a pellet went down on. What is ranked is
   * what a visitor reads off the picture: the multiplier first, then how much of
   * the chain is TURNING — a snake drawn as one straight bar says nothing about
   * threading a board — and length last. Each new high overwrites the last, so
   * what survives is the most coiled the chain ever was while holding the cap.
   */
  private offerStill(snapshot: CoilSnapshot): void {
    if (this.stills === null || snapshot.combo < 2) return;
    const worth =
      snapshot.combo * 1_000_000 +
      corners(snapshot.snake) * 1_000 +
      snapshot.snake.length;
    if (worth <= this.stillWorth) return;
    this.stillWorth = worth;
    captureStill(this.h, `${this.stills}-peak`);
  }

  /** Play the round out, and report what it produced. */
  async play(): Promise<Take> {
    // A fresh session for the take; nothing else here touches the surface but
    // `snapshot()`.
    this.h.debug.reset();
    await this.run(TITLE_HOLD);
    await this.press(CONFIRM_KEY);

    let lastTicks = -1;
    let lastScore = 0;
    let lastCombo = 1;
    let endAt: number | null = null;

    while (this.spent < MAX_FRAMES) {
      const snapshot = this.h.snapshot();
      if (snapshot.screen !== "playing") {
        this.died = snapshot.screen === "gameover";
        break;
      }
      if (snapshot.score > lastScore) {
        lastScore = snapshot.score;
        this.onEat(snapshot);
        if (endAt === null && this.spent >= MIN_FRAMES) {
          // The settled beat: the pellet is gone, the score readout has taken
          // the eat at whatever the multiplier was, and the next one is already
          // on the board.
          endAt = this.spent + SETTLE;
          this.endedOnBeat = true;
        }
      }
      if (endAt !== null && this.spent >= endAt) break;

      if (snapshot.ticks !== lastTicks) {
        lastTicks = snapshot.ticks;
        if (snapshot.combo < lastCombo) this.lapses += 1;
        lastCombo = snapshot.combo;
        this.offerStill(snapshot);
        const want = steer(snapshot);
        if (
          want !== null &&
          want !== snapshot.dir &&
          snapshot.turns.length === 0
        ) {
          await this.press(STEER_KEY[want]);
          continue;
        }
      }
      await this.run(1);
    }

    const ended = this.h.snapshot();
    return {
      frames: this.spent,
      eats: this.eats,
      score: ended.score,
      length: ended.snake.length,
      peakCombo: this.peakCombo,
      eatsAtPeak: this.eatsAtPeak,
      lapses: this.lapses,
      died: this.died,
      endedOnBeat: this.endedOnBeat,
    };
  }
}

/**
 * A take is judged on what makes a watchable clip of THIS game.
 *
 * The multiplier is what Coil is about, so the judge asks for the whole of it in
 * one take: climbed to the cap, held there over several eats, and then LOST —
 * the bar draining out from under a route that took a cell too long — because a
 * clip that only ever shows the multiplier going up shows half the mechanic.
 * Everything else is ordinary watchability: pellets eaten, points on the board,
 * a snake long enough to have to be threaded, and a clean ending.
 */
function judge(take: Take): number {
  return (
    take.eats * 4 +
    take.peakCombo * 10 +
    (take.peakCombo >= COMBO_MAX ? 20 : 0) +
    take.eatsAtPeak * 5 +
    (take.lapses >= 1 ? 25 : 0) +
    Math.min(take.lapses, 2) * 8 +
    take.score * 0.02 +
    (take.endedOnBeat ? 25 : -25) +
    (take.died ? -60 : 0)
  );
}

it("records round clips", async () => {
  // EVERY TAKE IS RECORDED, AND THE BEST ONE IS KEPT, so the take that was
  // judged is the take that was committed. Each take also gets its own engine: a
  // round replayed over a world that has already run inherits its frame counter,
  // the input edges the last take left armed, and whatever the last render left
  // on the canvas.
  const takes = Number(process.env.TCAB_SHOWCASE_TAKES ?? "8");

  const runTake = async (label: string): Promise<Take> => {
    const h = await createHarness();
    try {
      await h.advance(1);
      const session = new Session(h, label);
      return await captureReplay(h, label, () => session.play());
    } finally {
      h.dispose();
    }
  };

  let best: { label: string; score: number } | null = null;
  for (let take = 1; take <= takes; take += 1) {
    const label = `take-${String(take).padStart(2, "0")}`;
    const played = await runTake(label);
    const score = judge(played);
    console.log(
      `${label}: ${played.eats} eaten, ` +
        `${played.score} points, length ${played.length}, ` +
        `peak x${played.peakCombo} over ${played.eatsAtPeak} eats, ` +
        `${played.lapses} lapses, ${(played.frames / FRAME_HZ).toFixed(1)}s, ` +
        `${played.died ? "died" : played.endedOnBeat ? "clean end" : "ran out"}` +
        ` -> ${score.toFixed(0)}`,
    );
    if (best === null || score > best.score) best = { label, score };
  }

  console.log(
    `best take: ${best!.label} (${best!.score.toFixed(0)}) — commit ` +
      `${best!.label}.json.gz as gameplay.json.gz, ` +
      `${best!.label}-peak.png as combo-peak.png, and ` +
      `${best!.label}-early.png as the variant's early-board still`,
  );
}, 3_600_000);
