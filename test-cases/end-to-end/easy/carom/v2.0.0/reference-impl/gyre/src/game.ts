// Carom — the game: state machine, match flow, and per-step update.
//
// Rendering lives in render.ts and reads this object's public fields. main.ts
// drives it: once-per-frame edge input via handleInput(), then fixed-timestep
// physics via fixedStep().

import { AI } from "./ai";
import { Audio } from "./audio";
import {
  HOLD_TIME,
  PADDLE_SPEED,
  SERVE_ANGLE,
  SERVE_SPEED,
  TITLE_OBS_TIME,
  WIN_LEAD,
  WIN_SCORE,
  BALL_R,
  FIELD_W,
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
import { step } from "./physics";
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
  // The obstacle clock (seconds): drives the obstacles' sway and rotation. It
  // advances every live physics step (countdown and playing), is frozen while
  // paused, and resets to 0 at the start of each match. Read by render.ts.
  obsTime = 0;

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
    // Freeze the obstacles at a gently tilted, swayed pose so the dimmed title
    // backdrop hints at the live, rotating obstacles.
    this.obsTime = TITLE_OBS_TIME;
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
    // Every match opens with both obstacles upright at their centers.
    this.obsTime = 0;
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

  // ---- Edge input (once per frame) --------------------------------------

  handleInput(): void {
    for (const code of this.input.drain()) {
      if (code === "KeyM") {
        this.audio.toggleMute();
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
      // The obstacles move during the countdown, so they are already in motion
      // when the ball is served.
      this.obsTime += dt;
      // Ball is held at center; record so the (collapsed) trail stays in sync.
      this.trail.record(this.ball.x, this.ball.y, this.simTime);
      if (this.holdTimer <= 0) this.serve();
    } else if (this.state === "playing") {
      const events = step(this.ball, this.left, this.right, dt, this.obsTime);
      this.obsTime += dt;
      if (events.paddle) this.audio.paddleHit();
      else if (events.wall || events.obstacle) this.audio.bounce();
      this.trail.record(this.ball.x, this.ball.y, this.simTime);
      this.checkGoals();
    }

    this.simTime += dt;
  }

  private updatePaddles(dt: number): void {
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
      this.ai.update(this.right, this.ball, this.state === "playing", dt);
    } else {
      let p2 = 0;
      if (KEY.p2Up(i)) p2 -= 1;
      if (KEY.p2Down(i)) p2 += 1;
      this.right.vy = p2 * PADDLE_SPEED;
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
    this.audio.score();

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
}
