// showcase-capture — record REAL GAMEPLAY clips for the case showcase.
//
// Not a validator: a temporary capture driver staged beside the harness to
// (re)record the showcase's gameplay replays from the reference implementation.
// It starts a real solo match through the title menu, then plays the left
// paddle with scripted keyboard input against the build's real AI — nothing is
// posed mid-play — and records the whole stretch with the engine's recorder.
//
// The player has two layers. EXECUTION is bang-bang key input (hold W/S toward
// a target), the same input path a human uses, so paddle speed and the spin
// mechanic behave exactly as under human play. PLANNING simulates the return
// before making it: the build's own exported physics (`step`) and AI rule
// (`aiVelocity`) are pure functions, so each candidate contact point can be
// played forward exactly — where the shot lands, whether the AI reaches it —
// and the player picks a winner when one exists, or a lively rally shot when
// none does. That is the "well-placed or well-curved shot" the AI is designed
// to be beaten by, found the honest way: through the game's own rules.
//
// Run from the reference workspace root:
//   TCAB_VALIDATION_MEDIA_DIR=<out> TCAB_SHOWCASE_MAX_REPLAY_FRAMES=2400 \
//     npx vitest run --config validation/vitest.config.ts validation/showcase-capture.test.ts

import { afterEach, beforeEach, it } from "vitest";
import { aiVelocity } from "../src/ai";
import {
  BALL_R,
  FIELD_CY,
  FIELD_H,
  FIELD_W,
  MAX_BOUNCE_ANGLE,
  OBSTACLES,
  P1_X1,
  PADDLE_HALF,
  PADDLE_MAX_CY,
  PADDLE_MIN_CY,
  PADDLE_SPEED,
  SPEED_CAP,
  SPEED_MULT,
  SPIN_CLAMP,
  SPIN_FROM_PADDLE,
} from "../src/constants";
import { step } from "../src/physics";
import {
  allBalls,
  captureReplay,
  captureStill,
  createHarness,
  TICK_HZ,
  type Harness,
} from "./harness";
import type { BallSnapshot, CaromSnapshot } from "./surface";

const DT = 1 / TICK_HZ;

/** A ball as the build's own physics steps it. */
interface Sim {
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
}

/** A paddle parked far off the field, so a prediction never collides with it. */
const PARKED = { cy: -10_000, vy: 0 };

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

/** The ball the left paddle should defend: the incoming one arriving first. */
function threat(snapshot: CaromSnapshot): BallSnapshot | null {
  let best: BallSnapshot | null = null;
  let bestT = Infinity;
  for (const ball of allBalls(snapshot)) {
    if (ball.held || ball.vx >= 0) continue;
    const t = (ball.x - BALL_R - P1_X1) / -ball.vx;
    if (t < bestT) {
      bestT = t;
      best = ball;
    }
  }
  return best;
}

/**
 * The incoming ball played forward — through the build's own `step`, with both
 * paddles parked out of the way — until it crosses the left paddle's contact
 * plane: the contact's y, time from now, and the ball's state there.
 */
function predictContact(ball: Sim): { y: number; t: number; ball: Sim } | null {
  let sim = { ...ball };
  for (let frame = 1; frame <= TICK_HZ * 6; frame++) {
    sim = step(sim, PARKED, PARKED, OBSTACLES, DT).ball;
    if (sim.vx < 0 && sim.x <= P1_X1 + BALL_R) {
      return { y: sim.y, t: frame * DT, ball: sim };
    }
    if (sim.x - BALL_R > FIELD_W) return null; // left play the other way
  }
  return null;
}

/** The exit the paddle-bounce rule gives a contact (see src/physics.ts). */
function bounce(contact: Sim, paddleCy: number, paddleVy: number): Sim {
  const offset = clamp((contact.y - paddleCy) / PADDLE_HALF, -1, 1);
  const theta = offset * MAX_BOUNCE_ANGLE;
  const speed = Math.min(
    Math.hypot(contact.vx, contact.vy) * SPEED_MULT,
    SPEED_CAP,
  );
  return {
    x: P1_X1 + BALL_R,
    y: contact.y,
    vx: speed * Math.cos(theta),
    vy: speed * Math.sin(theta),
    spin: clamp(
      contact.spin + paddleVy * SPIN_FROM_PADDLE,
      -SPIN_CLAMP,
      SPIN_CLAMP,
    ),
  };
}

/**
 * A candidate return played forward against the build's own AI rule: the exit
 * ball flies under `step` while the right paddle chases under `aiVelocity`,
 * from where the AI actually stands. `null` when the AI blocks it (or the shot
 * never resolves); the landing margin — how far outside the AI's face the ball
 * crossed — when it scores.
 */
function playForward(exit: Sim, aiCy: number): number | null {
  let sim = { ...exit };
  let cy = aiCy;
  for (let frame = 0; frame < TICK_HZ * 6; frame++) {
    const vy = aiVelocity(cy, sim, true, DT);
    cy = clamp(cy + vy * DT, PADDLE_MIN_CY, PADDLE_MAX_CY);
    const margin = Math.abs(sim.y - cy);
    sim = step(sim, PARKED, { cy, vy }, OBSTACLES, DT).ball;
    if (sim.vx < 0) return null; // the AI got it back
    if (sim.x - BALL_R > FIELD_W) return margin;
  }
  return null;
}

/** How the paddle takes one incoming ball: where on the face, moving how. */
interface Intent {
  /** Ball-minus-center offset wanted at contact, in units (+ is below center). */
  offset: number;
  /** Paddle velocity wanted at contact: -1 up, 0 still, +1 down (full speed). */
  sweep: -1 | 0 | 1;
  /** Whether this return was planned as a winner. */
  kill?: boolean;
}

/** Rally shots cycled while no winner exists: swept, angled, spin-heavy play. */
const RALLY: Intent[] = [
  { offset: -35, sweep: -1 },
  { offset: 30, sweep: 1 },
  { offset: 0, sweep: -1 },
  { offset: -45, sweep: -1 },
  { offset: 40, sweep: 1 },
];

/**
 * Pick the return for the approaching contact. Every candidate offset is
 * played forward with each sweep; a still-paddle winner is preferred (no added
 * spin, so the planned line is exactly the flown one), then a swept winner by
 * its margin. With no winner, the rally book cycles.
 */
function planReturn(
  contact: Sim,
  aiCy: number,
  returns: number,
  phase: number,
): Intent {
  // Let the rally breathe: the first few returns never go for the winner, so
  // the clip shows real back-and-forth (and the ball builds speed) before the
  // point is taken.
  if (returns < 3) return RALLY[(returns + phase) % RALLY.length];
  let best: { intent: Intent; margin: number } | null = null;
  for (const sweep of [0, -1, 1] as const) {
    for (let o = -48; o <= 48; o += 4) {
      // Execution lands within a few units of the planned contact, so a winner
      // only counts if the whole slop band scores; it is judged by its
      // worst-case margin.
      let margin = Infinity;
      for (const slop of [-6, 0, 6]) {
        const exit = bounce(
          contact,
          contact.y - (o + slop),
          sweep * PADDLE_SPEED,
        );
        const one = playForward(exit, aiCy);
        margin = Math.min(margin, one ?? -1);
        if (margin < 0) break;
      }
      if (margin < 40) continue;
      // Prefer a still contact, then the widest worst-case margin.
      const weighted = margin + (sweep === 0 ? 200 : 0);
      if (best === null || weighted > best.margin) {
        best = { intent: { offset: o, sweep, kill: true }, margin: weighted };
      }
    }
  }
  return best?.intent ?? RALLY[(returns + phase) % RALLY.length];
}

/**
 * Drive one frame of the left paddle. Reads the world, decides which key (if
 * any) to hold, and dispatches real keydown/keyup edges.
 */
class LeftPlayer {
  private held: "KeyW" | "KeyS" | null = null;
  private returns = 0;
  private lastThreatT = Infinity;
  private plan: Intent | null = null;

  /** `phase` rotates the rally book, so takes differ beyond what the seed varies. */
  constructor(
    private readonly h: Harness,
    private readonly phase = 0,
  ) {}

  private want(key: "KeyW" | "KeyS" | null): void {
    if (key === this.held) return;
    if (this.held !== null) this.h.release(this.held);
    if (key !== null) this.h.hold(key);
    this.held = key;
  }

  step(): void {
    const snapshot = this.h.snapshot();
    if (snapshot.screen !== "playing") {
      this.want(null);
      return;
    }
    const paddle = snapshot.paddles.left;
    const ball = threat(snapshot);

    let target: number;
    if (ball === null) {
      // Nothing incoming: recover toward the center line, and forget the plan
      // so the next approach is planned afresh.
      target = FIELD_CY;
      this.lastThreatT = Infinity;
      if (this.plan !== null) {
        this.plan = null;
        this.returns += 1;
      }
    } else {
      const contact = predictContact({
        x: ball.x,
        y: ball.y,
        vx: ball.vx,
        vy: ball.vy,
        spin: ball.spin,
      });
      if (contact === null) {
        target = ball.y;
      } else {
        if (this.plan === null) {
          this.plan = planReturn(
            contact.ball,
            snapshot.paddles.right.cy,
            this.returns,
            this.phase,
          );
          console.log(
            `return ${this.returns} at sim ${snapshot.simTime.toFixed(1)}s: ` +
              `${this.plan.kill ? "KILL" : "rally"} offset ${this.plan.offset} ` +
              `sweep ${this.plan.sweep} (contact in ${contact.t.toFixed(2)}s)`,
          );
        }
        const intent = this.plan;
        // Where the center must be AT contact, and — walking the wanted sweep
        // velocity back over the time remaining — where it should be right now.
        const atContact = contact.y - intent.offset;
        const sweepWindow = Math.min(contact.t, 0.18);
        target = atContact - intent.sweep * PADDLE_SPEED * sweepWindow;
      }
      this.lastThreatT = contact?.t ?? this.lastThreatT;
    }

    const error = target - paddle.cy;
    const deadzone = 4;
    if (error > deadzone) this.want("KeyS");
    else if (error < -deadzone) this.want("KeyW");
    else this.want(null);
  }
}

/** Advance the match `frames` frames, driving the player each frame. */
async function play(
  h: Harness,
  player: LeftPlayer,
  frames: number,
): Promise<void> {
  for (let i = 0; i < frames; i++) {
    player.step();
    await h.advance(1);
  }
}

/** Walk the title menu into a solo match with real key input. */
async function startSoloMatch(h: Harness): Promise<void> {
  // The title opens with SOLO highlighted; confirm starts the match.
  await h.tap("Enter");
  await h.until((s) => s.screen === "playing" || s.screen === "countdown", {
    maxFrames: 300,
  });
}

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("records a gameplay clip", async () => {
  const h = harness;

  // One take: reset to `seed`, start a real solo match, and play it out. The
  // same seed replays the identical match (that is the debug surface's
  // contract), so a take can be auditioned without the recorder running and
  // then re-run under it exactly.
  const runTake = async (
    seed: number,
    phase: number,
    record: boolean,
  ): Promise<{
    frames: number;
    score: { p1: number; p2: number };
    paddleHits: number;
    maxGap: number;
    endedOnBeat: boolean;
  }> => {
    // A prior take can end mid-press; clear the real keyboard state so no held
    // key leaks into this take (which would break same-seed reproducibility).
    h.release("KeyW");
    h.release("KeyS");
    h.debug.reset({ seed });
    await h.advance(1);
    await startSoloMatch(h);
    const player = new LeftPlayer(h, phase);
    const scoreOf = (s: CaromSnapshot) => s.score.p1 + s.score.p2;

    const minFrames = Math.round(
      Number(process.env.TCAB_SHOWCASE_MIN_SECONDS ?? "20") * TICK_HZ,
    );
    const maxFrames = Math.round(
      Number(process.env.TCAB_SHOWCASE_MAX_SECONDS ?? "45") * TICK_HZ,
    );
    let frames = 0;
    let stillTaken = false;
    let lastScore = scoreOf(h.snapshot());
    let lastScoreFrame = -1;
    let paddleHits = 0;
    let lastHitFrame = 0;
    let maxGap = 0;
    let endedOnBeat = false;
    const cuesBefore = h.cues.length;

    while (frames < maxFrames) {
      await play(h, player, 1);
      frames += 1;
      // Track rally liveliness: paddle contact cadence and its widest lull.
      for (; paddleHits + cuesBefore < h.cues.length; ) {
        const cue = h.cues[paddleHits + cuesBefore];
        paddleHits += 1;
        if (cue.cue === "paddle-hit") lastHitFrame = frames;
      }
      maxGap = Math.max(maxGap, (frames - lastHitFrame) / TICK_HZ);
      const snapshot = h.snapshot();
      if (scoreOf(snapshot) !== lastScore) {
        lastScore = scoreOf(snapshot);
        lastScoreFrame = frames;
      }
      if (record && !stillTaken && frames > Math.round(minFrames * 0.6)) {
        captureStill(h, "mid-match");
        stillTaken = true;
      }
      if (
        record &&
        process.env.TCAB_SHOWCASE_QA_STILLS === "1" &&
        frames % (TICK_HZ * 4) === 0
      ) {
        captureStill(
          h,
          `qa-${String(frames / (TICK_HZ * 4)).padStart(2, "0")}`,
        );
      }
      // End on a settled beat: the first point that lands past the minimum
      // length, caught 0.9 s after it — mid pre-serve hold, never mid-flight.
      if (
        frames >= minFrames &&
        lastScoreFrame >= minFrames - Math.round(TICK_HZ * 0.9) &&
        frames - lastScoreFrame === Math.round(TICK_HZ * 0.9)
      ) {
        endedOnBeat = true;
        break;
      }
    }

    const hits = h.cues
      .slice(cuesBefore)
      .filter((c) => c.cue === "paddle-hit").length;
    const snapshot = h.snapshot();
    return {
      frames,
      score: snapshot.score,
      paddleHits: hits,
      maxGap,
      endedOnBeat,
    };
  };

  // A take is judged on what makes a watchable clip: points landing, steady
  // paddle play, no long lull where the ball just wanders, a clean ending.
  const judge = (t: Awaited<ReturnType<typeof runTake>>): number =>
    (t.score.p1 + t.score.p2) * 6 +
    t.paddleHits * 2 -
    t.maxGap * 3 +
    (t.endedOnBeat ? 10 : -10);

  const candidates: Array<{ seed: number; phase: number }> = [];
  for (const seed of [1, 5]) {
    for (const phase of [0, 1, 2, 3]) candidates.push({ seed, phase });
  }
  let best: { seed: number; phase: number; score: number } | null = null;
  for (const { seed, phase } of candidates) {
    const take = await runTake(seed, phase, false);
    const rating = judge(take);
    console.log(
      `take seed=${seed} phase=${phase}: ${take.score.p1}-${take.score.p2}, ` +
        `${take.paddleHits} paddle hits, gap ${take.maxGap.toFixed(1)}s, ` +
        `${(take.frames / TICK_HZ).toFixed(1)}s, ` +
        `${take.endedOnBeat ? "clean end" : "ran out"} -> ${rating.toFixed(0)}`,
    );
    if (best === null || rating > best.score) {
      best = { seed, phase, score: rating };
    }
  }

  // The winning take again, this time under the recorder.
  console.log(`recording take seed=${best!.seed} phase=${best!.phase}`);
  const final = await captureReplay(h, "gameplay", () =>
    runTake(best!.seed, best!.phase, true),
  );
  console.log(
    JSON.stringify(
      {
        seed: best!.seed,
        phase: best!.phase,
        seconds: final.frames / TICK_HZ,
        score: final.score,
        paddleHits: final.paddleHits,
        maxGap: final.maxGap,
      },
      null,
      2,
    ),
  );
}, 600_000);
