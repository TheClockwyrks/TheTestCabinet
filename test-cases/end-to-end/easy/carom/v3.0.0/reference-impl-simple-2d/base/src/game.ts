// Carom — the game: state machine, match flow, and the per-frame update.
//
// Rendering lives in render.ts and reads this object's public fields. main.ts
// hands `update` and `render` to the engine's frame loop, so this object is
// driven by exactly one call per frame: `update(dt)`, with `dt` the real elapsed
// seconds the engine measured for that frame.
//
// There is no fixed timestep and no accumulator. Every rate in constants.ts is per
// second and every one of them is multiplied by `dt`, which is what makes the
// simulation depend on how much TIME has passed rather than on how many frames
// have gone by: the same second of play reaches the same state whether it arrived
// as one long step, as a hundred short ones, or as an uneven mixture. That is the
// property specs/balls.md requires and the property a driver leans on when it
// replaces the engine's clock with a schedule of its own.

import { AI } from "./ai";
import { CUES } from "./audio";
import {
  HOLD_TIME,
  PADDLE_SPEED,
  SERVE_ANGLE,
  SERVE_SPEED,
  WIN_LEAD,
  WIN_SCORE,
  BALL_R,
  FIELD_W,
} from "./constants";
import { Ball, Paddle } from "./entities";
import { Controls } from "./input";
import { step } from "./physics";
import { Trail } from "./trail";
import type { AppState, Mode, Side } from "./types";
import type { Engine } from "@test-cabinet/simple-2d";

export const TITLE_ITEMS = ["SOLO", "VERSUS", "HOW TO PLAY"];
export const PAUSE_ITEMS = ["RESUME", "RESTART", "QUIT TO MENU"];
export const OVER_ITEMS = ["PLAY AGAIN", "MENU"];

export class Game {
  private readonly engine: Engine;
  private readonly controls: Controls;

  state: AppState = "title";
  mode: Mode = "solo";
  menuIndex = 0;

  readonly left = new Paddle("left");
  readonly right = new Paddle("right");
  readonly ball = new Ball();
  readonly trail = new Trail();
  private readonly ai = new AI();

  scoreP1 = 0;
  scoreP2 = 0;
  winner: Side | null = null;

  holdTimer = 0; // counts down during the pre-serve hold
  private receiver: Side = "left"; // side the next serve travels toward
  private serveSign = 1; // alternates the serve's vertical direction
  private resumeState: AppState = "playing"; // state to return to from pause

  simTime = 0; // accumulated simulation time (seconds)

  // ---- Debug / automation state (see debug.ts; inert in normal play) ----
  // When non-null, the debug driver is controlling the paddles: both follow these
  // velocities and neither the input actions nor the AI move them, so a scenario
  // can be driven deterministically from code. Set by the control operations,
  // cleared by reset(). Null during normal play.
  driverVel: { left: number; right: number } | null = null;
  // When true (Solo only), the AI drives its right paddle even while the driver
  // poses the left paddle and ball, so a scenario can exercise the computer
  // opponent against a set-up shot. Set by setAiControl, cleared by reset(); off
  // during normal play.
  driverAi = false;

  constructor(engine: Engine) {
    this.engine = engine;
    this.controls = new Controls(engine);
    this.toTitle();
  }

  /**
   * Whether audio is muted. The flag itself is the engine's — the game only asks
   * the bus to flip it (see handleInput) and reports what it says, so the HUD hint
   * and `snapshot()` cannot drift from what the player actually hears.
   */
  get muted(): boolean {
    return this.engine.audio.muted();
  }

  // ---- State transitions ------------------------------------------------

  private toTitle(): void {
    this.state = "title";
    this.menuIndex = 0;
    this.winner = null;
    // Pose the field furniture attractively behind the dimmed menu.
    this.left.cy = 305;
    this.left.vy = 0;
    this.right.cy = 435;
    this.right.vy = 0;
    this.ball.x = 700;
    this.ball.y = 330;
    this.ball.vx = 0;
    this.ball.vy = 0;
    this.ball.spin = 0;
    this.trail.reset();
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
    this.serveSign = 1;
    // The very first serve of a match always travels toward player one.
    this.respawn("left");
  }

  // Park the ball at center and begin the pre-serve hold; `receiver` is the
  // side the upcoming serve will travel toward.
  private respawn(receiver: Side): void {
    this.receiver = receiver;
    this.ball.hold();
    this.trail.reset();
    this.holdTimer = HOLD_TIME;
    this.state = "countdown";
  }

  private serve(): void {
    const dir = this.receiver === "left" ? -1 : 1;
    this.ball.x = 640;
    this.ball.y = 360;
    this.ball.spin = 0;
    this.ball.vx = dir * SERVE_SPEED * Math.cos(SERVE_ANGLE);
    this.ball.vy = this.serveSign * SERVE_SPEED * Math.sin(SERVE_ANGLE);
    this.serveSign = -this.serveSign;
    this.trail.reset();
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

  // ---- The frame --------------------------------------------------------

  /**
   * One frame: consume this frame's input edges, then advance the simulation by
   * the elapsed time.
   *
   * The order matters. Edges are news for exactly one frame — the engine discards
   * whatever was not consumed — so they are read first, at the top of the frame
   * that they belong to, and the state they may have changed is the state the rest
   * of the frame advances.
   */
  update(dt: number): void {
    this.handleInput();
    this.advance(dt);
  }

  // ---- Edge input (once per frame) --------------------------------------

  /**
   * Read this frame's one-shot actions and act on them.
   *
   * Every edge read in Carom happens here, once, which is what the engine's
   * consume-on-read edges ask for: two readers of the same action in one frame
   * would split one press between them.
   */
  private handleInput(): void {
    const c = this.controls;

    // Mute works on every screen, so it is read before the per-screen switch.
    if (c.mute()) this.engine.audio.setMuted(!this.engine.audio.muted());

    switch (this.state) {
      case "title":
        this.menuInput(TITLE_ITEMS.length, (i) => this.selectTitle(i));
        break;
      case "howto": {
        // `back` and `confirm` both leave; read both so neither is left armed.
        const confirm = c.confirm();
        const back = c.back();
        if (confirm || back) this.toTitle();
        break;
      }
      case "countdown":
      case "playing":
        // A match is live, so Escape means `pause` rather than `back`.
        if (c.pause()) this.pause();
        break;
      case "paused":
        // A menu is up, so Escape means `back` — which here is "resume".
        if (c.back()) this.resume();
        else this.menuInput(PAUSE_ITEMS.length, (i) => this.selectPause(i));
        break;
      case "matchover":
        this.menuInput(OVER_ITEMS.length, (i) => this.selectOver(i));
        break;
    }
  }

  private menuInput(count: number, onConfirm: (index: number) => void): void {
    const c = this.controls;
    // All three are read before any is acted on, so exactly one press moves the
    // selection or accepts it and nothing is left armed for a later frame.
    const up = c.menuUp();
    const down = c.menuDown();
    const confirm = c.confirm();
    if (up) {
      this.menuIndex = (this.menuIndex + count - 1) % count;
    } else if (down) {
      this.menuIndex = (this.menuIndex + 1) % count;
    } else if (confirm) {
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

  // ---- Simulation -------------------------------------------------------

  /**
   * Advance the simulation by `dt` seconds of elapsed time.
   *
   * `dt` is whatever the frame took — it is never assumed to be any particular
   * value, and nothing here counts frames. A menu screen advances nothing but the
   * clock; the paused screen freezes the field entirely.
   */
  private advance(dt: number): void {
    if (this.state === "playing" || this.state === "countdown") {
      this.updatePaddles(dt);
    }

    if (this.state === "countdown") {
      this.holdTimer -= dt;
      // Ball is held at center; record so the (collapsed) trail stays in sync.
      this.trail.record(this.ball.x, this.ball.y, this.simTime);
      if (this.holdTimer <= 0) this.serve();
    } else if (this.state === "playing") {
      const events = step(this.ball, this.left, this.right, dt);
      // One cue per event that actually happened. A frame long enough to contain
      // two different kinds of bounce plays both, because each is its own event
      // and each has its own cue (specs/ui.md).
      if (events.paddle) this.engine.audio.play(CUES.paddleHit);
      if (events.wall) this.engine.audio.play(CUES.wallBounce);
      if (events.obstacle) this.engine.audio.play(CUES.obstacleBounce);
      this.trail.record(this.ball.x, this.ball.y, this.simTime);
      this.checkGoals();
    }

    this.simTime += dt;
  }

  private updatePaddles(dt: number): void {
    // Debug driver override: when a driver is controlling the build, both paddles
    // follow the driver's set velocities through the real integrator, and neither
    // the input actions nor the AI move them. Inert in normal play (driverVel null).
    if (this.driverVel) {
      this.left.vy = this.driverVel.left;
      this.left.integrate(dt);
      // In Solo a scenario can hand the right paddle back to the AI (setAiControl),
      // so the computer opponent plays its own side against the posed ball while the
      // left paddle and ball stay driver-posed — the only way to exercise the AI from
      // a set-up state. Otherwise the driver moves the right paddle too.
      if (this.driverAi && this.mode === "solo") {
        this.ai.update(this.right, this.ball, this.state === "playing", dt);
      } else {
        this.right.vy = this.driverVel.right;
        this.right.integrate(dt);
      }
      return;
    }

    const c = this.controls;
    // Player one (left). Solo has no player two, so both sliders drive this paddle.
    const p1 = this.mode === "solo" ? c.soloAxis() : c.p1Axis();
    this.left.vy = p1 * PADDLE_SPEED;
    this.left.integrate(dt);

    // Right paddle: AI in solo, second human in versus.
    if (this.mode === "solo") {
      this.ai.update(this.right, this.ball, this.state === "playing", dt);
    } else {
      this.right.vy = c.p2Axis() * PADDLE_SPEED;
      this.right.integrate(dt);
    }
  }

  private checkGoals(): void {
    if (this.ball.x - BALL_R > FIELD_W) {
      this.score("left"); // ball past the right edge -> player one scores
    } else if (this.ball.x + BALL_R < 0) {
      this.score("right"); // ball past the left edge -> player two scores
    }
  }

  private score(scorer: Side): void {
    if (scorer === "left") this.scoreP1++;
    else this.scoreP2++;
    this.engine.audio.play(CUES.score);

    const winner = this.checkWin();
    if (winner) {
      this.winner = winner;
      this.state = "matchover";
      this.menuIndex = 0;
      return;
    }
    // The next serve goes to the player who was just scored on (the receiver).
    this.respawn(scorer === "left" ? "right" : "left");
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

  // Countdown digit (a snappy 3-2-1 rendered across the 1.0 s hold).
  countdownNumber(): number {
    return Math.min(3, Math.max(1, Math.ceil((this.holdTimer / HOLD_TIME) * 3)));
  }

  // Progress 0..1 within the current countdown digit, for a pop animation.
  countdownPhase(): number {
    const third = HOLD_TIME / 3;
    return (this.holdTimer % third) / third;
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

  debugReset(): void {
    this.driverVel = null;
    this.driverAi = false;
    this.toTitle();
  }

  // Hand the right (AI) paddle back to the computer opponent for the rest of the
  // driven scenario, so the frames that follow run the real AI against the posed
  // ball. Solo only — there is no AI in Versus, so it has no effect there. Cleared
  // by reset().
  debugSetAiControl(enabled: boolean): void {
    this.enterDriven();
    this.driverAi = enabled;
  }

  debugStartMatch(mode: Mode): void {
    this.enterDriven();
    this.startMatch(mode);
  }

  // Launch the ball now, ending the pre-serve countdown immediately (or
  // re-serving a live rally). Routes through the real serve().
  debugServe(): void {
    this.enterDriven();
    if (this.state === "countdown" || this.state === "playing") {
      this.holdTimer = 0;
      this.serve();
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

  // The number of balls the driver can address (one in this variant).
  debugBallCount(): number {
    return 1;
  }

  debugSetBall(
    index: number,
    state: { x?: number; y?: number; vx?: number; vy?: number; spin?: number },
  ): void {
    this.enterDriven();
    if (index !== 0) return;
    const b = this.ball;
    if (state.x !== undefined) b.x = state.x;
    if (state.y !== undefined) b.y = state.y;
    if (state.vx !== undefined) b.vx = state.vx;
    if (state.vy !== undefined) b.vy = state.vy;
    if (state.spin !== undefined) b.spin = state.spin;
  }

  // A read of the full observable state, shared by the debug API's snapshot()
  // and the diagnostic sources on the engine's overlay.
  debugSnapshot(): CaromSnapshot {
    return {
      version: 1,
      screen: this.state,
      mode: this.mode,
      score: { p1: this.scoreP1, p2: this.scoreP2 },
      winner: this.winner,
      muted: this.muted,
      paddles: {
        left: { cy: this.left.cy, vy: this.left.vy },
        right: { cy: this.right.cy, vy: this.right.vy },
      },
      ball: {
        x: this.ball.x,
        y: this.ball.y,
        vx: this.ball.vx,
        vy: this.ball.vy,
        speed: this.ball.speed,
        spin: this.ball.spin,
        held: this.state === "countdown",
      },
      simTime: this.simTime,
    };
  }
}

// The JSON-serializable state the debug API and the overlay report.
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
  ball: BallSnapshot;
  simTime: number;
}
