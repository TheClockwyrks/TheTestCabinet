// Carom (Multi-ball) — the game: state machine, match flow, and per-step update.
//
// Rendering lives in render.ts and reads this object's public fields. main.ts
// drives it: once-per-frame edge input via handleInput(), then fixed-timestep
// physics via fixedStep().
//
// The multi variant runs three independent balls. Each carries its own velocity
// and spin, has a fixed home point, and runs its own countdown: when a ball
// leaves the field it resets and relaunches on its own — at a fresh random
// 360deg angle — while the other two carry on uninterrupted. See specs/balls.md.

import { AI } from "./ai";
import { Audio } from "./audio";
import {
  BALL_HOMES,
  HOLD_TIME,
  PADDLE_SPEED,
  WIN_LEAD,
  WIN_SCORE,
  BALL_R,
  FIELD_W,
  P2_X0,
} from "./constants";
import { Ball, Paddle } from "./entities";
import {
  Input,
  KEY,
  isBack,
  isConfirm,
  isMenuDown,
  isMenuUp,
  isPause,
} from "./input";
import { stepMulti } from "./physics";
import { Rng } from "./rng";
import { Trail } from "./trail";
import type { AppState, Mode, Side } from "./types";

export const TITLE_ITEMS = ["SOLO", "VERSUS", "HOW TO PLAY"];
export const PAUSE_ITEMS = ["RESUME", "RESTART", "QUIT TO MENU"];
export const OVER_ITEMS = ["PLAY AGAIN", "MENU"];

export class Game {
  readonly input: Input;
  readonly audio = new Audio();

  state: AppState = "title";
  mode: Mode = "solo";
  menuIndex = 0;

  readonly left = new Paddle("left");
  readonly right = new Paddle("right");
  // Three balls, each at its own home point, each with its own trail.
  readonly balls: Ball[] = BALL_HOMES.map((h) => new Ball(h.x, h.y));
  readonly trails: Trail[] = BALL_HOMES.map(() => new Trail());
  private readonly ai = new AI();

  scoreP1 = 0;
  scoreP2 = 0;
  winner: Side | null = null;

  // A single match-start countdown shared by all three balls: they all begin
  // together, so they all launch together at match start. After that, each
  // ball runs its own countdown (Ball.holdTimer) when it respawns.
  holdTimer = 0;
  private resumeState: AppState = "playing"; // state to return to from pause

  simTime = 0; // accumulated simulation time (seconds)

  // Seedable generator behind every random launch angle, so the debug API's
  // reset({ seed }) replays a match identically (see specs/instrumentation.md).
  private readonly rng = new Rng();

  // ---- Debug / automation state (see debug.ts; inert in normal play) ----
  // When on, render.ts draws the read-only debug overlay. Toggled with backtick.
  debugOverlay = false;
  // When non-null, the debug driver is controlling the paddles: both follow these
  // velocities and neither the keyboard nor the AI moves them, so a scenario can
  // be driven deterministically from code. Set by the control operations, cleared
  // by reset(). Null during normal play.
  driverVel: { left: number; right: number } | null = null;

  constructor(input: Input) {
    this.input = input;
    this.input.onFirstPress(() => this.audio.resume());
    this.toTitle();
  }

  // ---- State transitions ------------------------------------------------

  private toTitle(): void {
    this.state = "title";
    this.menuIndex = 0;
    this.winner = null;
    // Pose the field furniture attractively behind the dimmed menu; the three
    // balls sit at their home points to hint at multi-ball play.
    this.left.cy = 305;
    this.left.vy = 0;
    this.right.cy = 435;
    this.right.vy = 0;
    for (let i = 0; i < this.balls.length; i++) {
      const b = this.balls[i];
      b.x = b.hx;
      b.y = b.hy;
      b.vx = 0;
      b.vy = 0;
      b.spin = 0;
      b.held = false;
      this.trails[i].reset();
    }
  }

  private startMatch(mode: Mode): void {
    this.mode = mode;
    this.scoreP1 = 0;
    this.scoreP2 = 0;
    this.winner = null;
    this.left.cy = 360;
    this.left.vy = 0;
    this.right.cy = 360;
    this.right.vy = 0;
    this.ai.reset();
    // All three balls sit at their home points and share the match-start
    // countdown; they launch together when it elapses.
    for (let i = 0; i < this.balls.length; i++) {
      this.balls[i].parkHome();
      this.trails[i].reset();
    }
    this.holdTimer = HOLD_TIME;
    this.state = "countdown";
  }

  // A uniformly random launch angle over the full 360deg, drawn from the seedable
  // generator so a seeded reset replays the same launches.
  private randomAngle(): number {
    return this.rng.next() * Math.PI * 2;
  }

  // The match-start serve: every ball launches together, each at its own random
  // angle. From here the field is live and balls respawn independently.
  private launchAll(): void {
    for (let i = 0; i < this.balls.length; i++) {
      this.balls[i].launch(this.randomAngle());
      this.trails[i].reset();
    }
    this.state = "playing";
  }

  private pause(): void {
    this.resumeState = this.state;
    this.state = "paused";
    this.menuIndex = 0;
  }

  private resume(): void {
    this.state = this.resumeState;
  }

  // ---- Edge input (once per frame) --------------------------------------

  handleInput(): void {
    for (const code of this.input.drain()) {
      if (code === "KeyM") {
        this.audio.toggleMute();
        continue;
      }
      if (code === "Backquote") {
        this.debugOverlay = !this.debugOverlay;
        continue;
      }
      switch (this.state) {
        case "title":
          this.menuInput(code, TITLE_ITEMS.length, (i) => this.selectTitle(i));
          break;
        case "howto":
          if (isConfirm(code) || isBack(code)) this.toTitle();
          break;
        case "countdown":
        case "playing":
          if (isPause(code)) this.pause();
          break;
        case "paused":
          if (isBack(code)) {
            this.resume();
          } else {
            this.menuInput(code, PAUSE_ITEMS.length, (i) =>
              this.selectPause(i),
            );
          }
          break;
        case "matchover":
          this.menuInput(code, OVER_ITEMS.length, (i) => this.selectOver(i));
          break;
      }
    }
  }

  private menuInput(
    code: string,
    count: number,
    onConfirm: (index: number) => void,
  ): void {
    if (isMenuUp(code)) {
      this.menuIndex = (this.menuIndex + count - 1) % count;
    } else if (isMenuDown(code)) {
      this.menuIndex = (this.menuIndex + 1) % count;
    } else if (isConfirm(code)) {
      onConfirm(this.menuIndex);
    }
  }

  private selectTitle(i: number): void {
    if (i === 0) this.startMatch("solo");
    else if (i === 1) this.startMatch("versus");
    else this.state = "howto";
  }

  private selectPause(i: number): void {
    if (i === 0) this.resume();
    else if (i === 1) this.startMatch(this.mode);
    else this.toTitle();
  }

  private selectOver(i: number): void {
    if (i === 0) this.startMatch(this.mode);
    else this.toTitle();
  }

  // ---- Fixed-timestep update --------------------------------------------

  fixedStep(dt: number): void {
    if (this.state === "playing" || this.state === "countdown") {
      this.updatePaddles(dt);
    }

    if (this.state === "countdown") {
      this.holdTimer -= dt;
      // All three balls are held at their homes; keep their (collapsed) trails
      // in sync.
      for (let i = 0; i < this.balls.length; i++) {
        const b = this.balls[i];
        this.trails[i].record(b.x, b.y, this.simTime);
      }
      if (this.holdTimer <= 0) this.launchAll();
    } else if (this.state === "playing") {
      // Each held ball counts down on its own and relaunches independently when
      // its timer elapses — the other balls are untouched.
      for (let i = 0; i < this.balls.length; i++) {
        const b = this.balls[i];
        if (!b.held) continue;
        b.holdTimer -= dt;
        if (b.holdTimer <= 0) {
          b.launch(this.randomAngle());
          this.trails[i].reset();
        }
      }

      const events = stepMulti(this.balls, this.left, this.right, dt);
      if (events.paddle) this.audio.paddleHit();
      else if (events.wall || events.obstacle || events.ball)
        this.audio.bounce();

      for (let i = 0; i < this.balls.length; i++) {
        const b = this.balls[i];
        this.trails[i].record(b.x, b.y, this.simTime);
      }
      this.checkGoals();
    }

    this.simTime += dt;
  }

  private updatePaddles(dt: number): void {
    // Debug driver override: when a driver is controlling the build, both paddles
    // follow the driver's set velocities through the real integrator, and neither
    // the keyboard nor the AI moves them. Inert in normal play (driverVel null).
    if (this.driverVel) {
      this.left.vy = this.driverVel.left;
      this.left.integrate(dt);
      this.right.vy = this.driverVel.right;
      this.right.integrate(dt);
      return;
    }

    const i = this.input;
    // Player one (left) — both single-player modes and versus.
    let p1 = 0;
    if (this.mode === "solo") {
      if (KEY.up(i)) p1 -= 1;
      if (KEY.down(i)) p1 += 1;
    } else {
      if (KEY.p1Up(i)) p1 -= 1;
      if (KEY.p1Down(i)) p1 += 1;
    }
    this.left.vy = p1 * PADDLE_SPEED;
    this.left.integrate(dt);

    // Right paddle: AI in solo, second human in versus.
    if (this.mode === "solo") {
      const threat = this.pickThreat();
      this.ai.update(
        this.right,
        threat.ball,
        this.state === "playing" && threat.incoming,
        dt,
      );
    } else {
      let p2 = 0;
      if (KEY.p2Up(i)) p2 -= 1;
      if (KEY.p2Down(i)) p2 += 1;
      this.right.vy = p2 * PADDLE_SPEED;
      this.right.integrate(dt);
    }
  }

  // The AI defends the ball that most immediately threatens its goal: among the
  // live balls moving toward the right goal, the one that will reach the paddle
  // soonest. With none incoming it eases back to center (incoming = false), so
  // it stays beatable and never tries to cover all three at once.
  private pickThreat(): { ball: Ball; incoming: boolean } {
    let best: Ball | null = null;
    let bestTime = Infinity;
    for (const b of this.balls) {
      if (b.held || b.vx <= 0 || b.x >= P2_X0) continue;
      const time = (P2_X0 - b.x) / b.vx;
      if (time < bestTime) {
        bestTime = time;
        best = b;
      }
    }
    if (best) return { ball: best, incoming: true };
    // No incoming ball: pick any ball just to keep the AI's perception fed, and
    // let it drift to center.
    const live = this.balls.find((b) => !b.held);
    return { ball: live ?? this.balls[1], incoming: false };
  }

  private checkGoals(): void {
    for (let i = 0; i < this.balls.length; i++) {
      const b = this.balls[i];
      if (b.held) continue;
      let scorer: Side | null = null;
      if (b.x - BALL_R > FIELD_W) {
        scorer = "left"; // past the right edge -> player one scores
      } else if (b.x + BALL_R < 0) {
        scorer = "right"; // past the left edge -> player two scores
      }
      if (!scorer) continue;

      if (scorer === "left") this.scoreP1++;
      else this.scoreP2++;
      this.audio.score();

      const winner = this.checkWin();
      if (winner) {
        this.winner = winner;
        this.state = "matchover";
        this.menuIndex = 0;
        return;
      }
      // Only the ball that crossed is affected: it returns to its own home and
      // begins a fresh countdown; the other two carry on.
      b.parkHome();
      this.trails[i].reset();
    }
  }

  private checkWin(): Side | null {
    if (this.scoreP1 >= WIN_SCORE && this.scoreP1 - this.scoreP2 >= WIN_LEAD) {
      return "left";
    }
    if (this.scoreP2 >= WIN_SCORE && this.scoreP2 - this.scoreP1 >= WIN_LEAD) {
      return "right";
    }
    return null;
  }

  // The match-start countdown digit (a snappy 3-2-1 across the 1.0 s hold).
  countdownNumber(): number {
    return Math.min(3, Math.max(1, Math.ceil((this.holdTimer / HOLD_TIME) * 3)));
  }

  // Progress 0..1 within the current countdown digit, for a pop animation.
  countdownPhase(): number {
    const third = HOLD_TIME / 3;
    return (this.holdTimer % third) / third;
  }

  // The small per-ball countdown digit shown over a ball held for its own
  // respawn during live play (1..3 across its 1.0 s hold).
  ballCountdownNumber(b: Ball): number {
    return Math.min(3, Math.max(1, Math.ceil((b.holdTimer / HOLD_TIME) * 3)));
  }

  // ---- Debug driver surface (used by debug.ts; inert in normal play) --------
  //
  // Each control method routes through the same transitions and state the game
  // uses in normal play — they set up a situation, they never fabricate an
  // outcome. Calling any of them hands paddle control to the driver (see
  // updatePaddles) until debugReset().

  private enterDriven(): void {
    if (!this.driverVel) this.driverVel = { left: 0, right: 0 };
  }

  debugReset(seed?: number): void {
    // A number seed makes every subsequent random launch reproducible.
    if (seed !== undefined) this.rng.reseed(seed);
    this.driverVel = null;
    this.toTitle();
  }

  debugStartMatch(mode: Mode): void {
    this.enterDriven();
    this.startMatch(mode);
  }

  // Launch the balls now, ending the pre-serve countdown immediately. During the
  // match-start countdown this launches all three together; during live play it
  // launches any ball currently waiting at its home (a ball already in flight is
  // left as it is). Routes through the real launch path.
  debugServe(): void {
    this.enterDriven();
    if (this.state === "countdown") {
      this.holdTimer = 0;
      this.launchAll();
    } else if (this.state === "playing") {
      for (let i = 0; i < this.balls.length; i++) {
        const b = this.balls[i];
        if (b.held) {
          b.launch(this.randomAngle());
          this.trails[i].reset();
        }
      }
    }
  }

  debugSetScore(p1: number, p2: number): void {
    this.enterDriven();
    this.scoreP1 = p1;
    this.scoreP2 = p2;
  }

  debugSetPaddle(side: Side, cy?: number, vy?: number): void {
    this.enterDriven();
    const p = side === "left" ? this.left : this.right;
    if (cy !== undefined) p.cy = cy;
    if (vy !== undefined) this.driverVel![side] = vy;
  }

  // The number of balls the driver can address (three in this variant).
  debugBallCount(): number {
    return this.balls.length;
  }

  // Place and aim one of the three balls. Posing a ball takes it into live play
  // (held cleared), so a driven scenario can drive one ball while parking the
  // others out of the way; index is the ball's play-order index (0..2).
  debugSetBall(
    index: number,
    state: { x?: number; y?: number; vx?: number; vy?: number; spin?: number },
  ): void {
    this.enterDriven();
    if (index < 0 || index >= this.balls.length) return;
    const b = this.balls[index];
    if (state.x !== undefined) b.x = state.x;
    if (state.y !== undefined) b.y = state.y;
    if (state.vx !== undefined) b.vx = state.vx;
    if (state.vy !== undefined) b.vy = state.vy;
    if (state.spin !== undefined) b.spin = state.spin;
    b.held = false;
    b.holdTimer = 0;
  }

  // A read of the full observable state, shared by the debug API's snapshot() and
  // the debug overlay. All three balls are reported, in play order.
  debugSnapshot(): CaromSnapshot {
    return {
      version: 1,
      screen: this.state,
      mode: this.mode,
      score: { p1: this.scoreP1, p2: this.scoreP2 },
      winner: this.winner,
      muted: this.audio.muted,
      paddles: {
        left: { cy: this.left.cy, vy: this.left.vy },
        right: { cy: this.right.cy, vy: this.right.vy },
      },
      balls: this.balls.map((b) => ({
        x: b.x,
        y: b.y,
        vx: b.vx,
        vy: b.vy,
        speed: b.speed,
        spin: b.spin,
        held: b.held,
      })),
      simTime: this.simTime,
    };
  }
}

// The JSON-serializable state the debug API and overlay report.
export interface BallSnapshot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  spin: number;
  held: boolean;
}

export interface CaromSnapshot {
  version: number;
  screen: AppState;
  mode: Mode;
  score: { p1: number; p2: number };
  winner: Side | null;
  muted: boolean;
  paddles: {
    left: { cy: number; vy: number };
    right: { cy: number; vy: number };
  };
  balls: BallSnapshot[];
  simTime: number;
}
