// Carom — the match level: its game mode, and the two controllers that drive
// the paddles.
//
// The mode holds the match rules (specs/ui.md, specs/balls.md): the pre-serve
// countdown and the serve, the goals, the win and deuce rules, and the pause
// and match-over menus. It builds the match from the classes it names —
// `addPlayer` seats player one on the left paddle, and the right paddle goes
// to a second player (Versus) or to the AI bot (Solo), so the two modes of
// play differ only in who drives one pawn.
//
// INPUT ORDER. Every edge is read at the top of the frame, before anything
// moves, because controllers tick before any actor: the primary player
// controller routes the frame's edges into `handleInput`, and the paddles and
// ball then advance under whatever screen the edges left. The engine consumes
// an edge per controller on first read, so routing through ONE controller is
// what keeps one press meaning one thing.
//
// JUDGING ORDER. The mode's own tick runs after every actor has ticked, so the
// countdown and the goals are judged against the frame's settled world: the
// serve happens on the first frame the hold reaches zero, and a point lands on
// the frame the advanced ball is past a goal edge (specs/balls.md).
//
// Every way a match starts — SOLO or VERSUS on the title, RESTART on the pause
// menu, PLAY AGAIN after a match — is one act: `world.open` on the match
// level, whose transition rebuilds the world fresh (specs/ui.md, "Starting a
// match"). That rebuild is also what starts the obstacle clock over: a fresh
// `MatchState` carries `obstacleClock` 0, so every match opens with both
// obstacles upright at their base centers (specs/playfield.md), with no code
// here to remember to reset it.

import {
  AIController,
  GameMode,
  PlayerController,
} from "@test-cabinet/structured-2d";
import type {
  Controller,
  InputReader,
  Transform,
} from "@test-cabinet/structured-2d";
import { aiVelocity } from "./ai";
import { Ball } from "./ball";
import {
  BALL_R,
  CUES,
  FIELD_CX,
  FIELD_CY,
  FIELD_W,
  HOLD_TIME,
  LEVELS,
  MATCHOVER_ITEMS,
  PADDLE_SPEED,
  PAUSE_ITEMS,
  SERVE_ANGLE,
  SERVE_SPEED,
  TAGS,
  WIN_LEAD,
  WIN_SCORE,
} from "./constants";
import { menuDown, menuUp, p1Axis, p2Axis, soloAxis } from "./input";
import { Paddle } from "./paddle";
import { paddleCenterX, type Side } from "./sim";
import { isLiveScreen, MatchState, type Mode } from "./state";
import { PLAYER_NAME } from "./theme";

export class MatchMode extends GameMode {
  declare readonly state: MatchState;

  gameStateClass = MatchState;
  playerControllerClass = PaddleController;
  pawnClass = Paddle;

  /** The way this match is played, from the options the level was opened with. */
  modeName: Mode = "solo";

  beginPlay(): void {
    this.modeName = this.options.mode === "versus" ? "versus" : "solo";

    // The opening pose (specs/ui.md, "Starting a match"): the pre-serve
    // countdown, the first serve aimed at player one. The scores start at
    // zero on the player states the framework builds.
    const state = this.state;
    state.screen = "countdown";
    state.resumeScreen = "playing";
    state.menuIndex = 0;
    state.winner = null;
    state.receiver = "left";
    state.holdTimer = HOLD_TIME;

    const left = this.addPlayer({ name: PLAYER_NAME.left });
    this.dress(left.pawn, "left");
    if (this.modeName === "versus") {
      const right = this.addPlayer({ name: PLAYER_NAME.rightHuman });
      this.dress(right.pawn, "right");
    } else {
      const bot = this.addBot(AiPaddleController, {
        name: PLAYER_NAME.rightAi,
      });
      this.dress(bot.pawn, "right");
    }

    // The ball is spawned LAST, so it ticks after both paddles and a contact
    // reads each paddle's integrated velocity for the frame (src/ball.ts).
    this.world.spawn(Ball, {
      transform: { x: FIELD_CX, y: FIELD_CY },
      tags: [TAGS.ball],
    });

    this.setPhase("playing");
  }

  /** Each participant's paddle arrives on its own side of the court. */
  spawnPoint(controller: Controller): Transform {
    const side: Side = controller.playerState.index === 0 ? "left" : "right";
    return {
      x: paddleCenterX(side),
      y: FIELD_CY,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    };
  }

  /**
   * One frame's edges, routed by the screen they arrive on (specs/ui.md).
   * Called by the primary paddle controller at the top of the frame, once,
   * with its own reader.
   */
  handleInput(input: InputReader): void {
    // Mute works on every screen, so it is read before the per-screen switch.
    if (input.pressed("mute")) {
      this.world.audio.setMuted(!this.world.audio.muted());
    }

    const state = this.state;
    switch (state.screen) {
      case "countdown":
      case "playing":
        // A match is live, so Escape means `pause` rather than `back`.
        if (input.pressed("pause")) {
          state.resumeScreen = state.screen;
          state.screen = "paused";
          state.menuIndex = 0;
        }
        return;
      case "paused":
        // A menu is up, so Escape means `back` — which here is "resume". It
        // is read before the menu edges, and a frame carrying it resumes and
        // does nothing else (specs/ui.md).
        if (input.pressed("back")) {
          state.screen = state.resumeScreen;
          return;
        }
        this.menu(input, PAUSE_ITEMS.length, (index) => this.pauseItem(index));
        return;
      case "matchover":
        // A menu is up, so Escape means `back` — which here is "to the title".
        if (input.pressed("back")) {
          this.world.open(LEVELS.title);
          return;
        }
        this.menu(input, MATCHOVER_ITEMS.length, (index) =>
          this.matchOverItem(index),
        );
        return;
    }
  }

  tick(dt: number): void {
    const state = this.state;
    if (state.screen === "countdown") {
      // Every countdown frame subtracts dt; the first frame the result is
      // <= 0, the ball is served on that same frame (specs/balls.md). The
      // ball is not advanced on the frame it is served: it ticked before this,
      // parked.
      state.holdTimer -= dt;
      if (state.holdTimer <= 0) this.serve();
      return;
    }
    if (state.screen === "playing") this.judge();
  }

  /** Launch the ball toward the receiver at SERVE_SPEED (specs/balls.md). */
  private serve(): void {
    const state = this.state;
    const ball = this.ball();
    const dir = state.receiver === "left" ? -1 : 1;
    // The SIGN of the serve's vertical component is the one draw this game
    // makes from its seeded generator, kept on the instance so a reseeded
    // replay crosses the level transition a match opens with.
    const sign = state.game.drawServeSign();
    ball.park();
    ball.vx = dir * SERVE_SPEED * Math.cos(SERVE_ANGLE);
    ball.vy = sign * SERVE_SPEED * Math.sin(SERVE_ANGLE);
    state.holdTimer = 0;
    state.screen = "playing";
  }

  /** A point lands the frame the advanced ball is fully past a goal edge. */
  private judge(): void {
    const ball = this.ball();
    if (ball.transform.x - BALL_R > FIELD_W) this.scoreFor("left");
    else if (ball.transform.x + BALL_R < 0) this.scoreFor("right");
  }

  private scoreFor(scorer: Side): void {
    const state = this.state;
    const [p1, p2] = state.players;
    (scorer === "left" ? p1 : p2).score += 1;
    this.world.audio.play(CUES.score);

    const winner = decideWinner(p1.score, p2.score);
    if (winner !== null) {
      state.winner = winner;
      state.screen = "matchover";
      state.menuIndex = 0;
      // The ball is left where it is (specs/balls.md).
      this.setPhase("over");
      return;
    }

    // The next serve travels toward the player who was just scored on.
    const ball = this.ball();
    ball.park();
    state.receiver = scorer === "left" ? "right" : "left";
    state.holdTimer = HOLD_TIME;
    state.screen = "countdown";
  }

  /**
   * A menu's frame: all three edges are read before any is acted on, and up
   * is applied before down, movement before confirm (specs/ui.md).
   */
  private menu(
    input: InputReader,
    count: number,
    onConfirm: (index: number) => void,
  ): void {
    const up = menuUp(input);
    const down = menuDown(input);
    const accepted = input.pressed("confirm");
    const state = this.state;
    if (up) {
      state.menuIndex = (state.menuIndex + count - 1) % count;
      return;
    }
    if (down) {
      state.menuIndex = (state.menuIndex + 1) % count;
      return;
    }
    if (accepted) onConfirm(state.menuIndex);
  }

  private pauseItem(index: number): void {
    if (index === 0) {
      this.state.screen = this.state.resumeScreen;
      return;
    }
    if (index === 1) {
      this.world.open(LEVELS.match, { mode: this.modeName });
      return;
    }
    this.world.open(LEVELS.title);
  }

  private matchOverItem(index: number): void {
    if (index === 0) {
      this.world.open(LEVELS.match, { mode: this.modeName });
      return;
    }
    this.world.open(LEVELS.title);
  }

  /** The one ball in play. */
  private ball(): Ball {
    const found = this.world.byTag(TAGS.ball)[0];
    if (!(found instanceof Ball)) {
      throw new Error(`Carom: no ball carries the "${TAGS.ball}" tag`);
    }
    return found;
  }

  /** Put a freshly possessed paddle on its side, under its case-fixed tag. */
  private dress(pawn: unknown, side: Side): void {
    if (!(pawn instanceof Paddle)) {
      throw new Error("Carom: the match mode possesses Paddle pawns");
    }
    pawn.side = side;
    pawn.addTag(side === "left" ? TAGS.paddleLeft : TAGS.paddleRight);
  }
}

/**
 * A human's paddle. The primary seat (index 0) also routes the frame's edges
 * into the mode before anything moves.
 *
 * Movement honors the debug driver's hold (specs/instrumentation.md): while a
 * control operation holds the paddles, each follows the velocity the driver
 * holds for its side through the same integrator, and the input actions leave
 * it alone until `reset()` hands it back.
 */
export class PaddleController extends PlayerController {
  tick(): void {
    const mode = this.world.mode;
    if (!(mode instanceof MatchMode)) return;
    if (this.playerState.index === 0) mode.handleInput(this.input);

    const pawn = this.pawn;
    if (!(pawn instanceof Paddle)) return;
    if (!isLiveScreen(mode.state.screen)) return;

    const driver = mode.state.game.driver;
    if (driver.holding) {
      pawn.drive(driver.vy[pawn.side]);
      return;
    }

    // Solo has no player two, so both sliders drive the one human paddle.
    const axis =
      mode.modeName === "solo"
        ? soloAxis(this.input)
        : pawn.side === "left"
          ? p1Axis(this.input)
          : p2Axis(this.input);
    pawn.drive(axis * PADDLE_SPEED);
  }
}

/**
 * The computer opponent's seat (the right paddle in Solo). It computes the
 * drive from the world — the AI arithmetic itself is `src/ai.ts` — and hands
 * it to the same pawn interface a player drives.
 *
 * The debug driver's hold covers this paddle too, except when the scenario
 * flips the AI switch back on (`setAiControl`), which is exactly the real AI
 * playing against a posed ball.
 */
export class AiPaddleController extends AIController {
  tick(dt: number): void {
    const mode = this.world.mode;
    if (!(mode instanceof MatchMode)) return;

    const pawn = this.pawn;
    if (!(pawn instanceof Paddle)) return;
    if (!isLiveScreen(mode.state.screen)) return;

    const driver = mode.state.game.driver;
    if (driver.holding && !driver.ai) {
      pawn.drive(driver.vy.right);
      return;
    }

    const ball = this.world.byTag(TAGS.ball)[0];
    if (!(ball instanceof Ball)) {
      pawn.drive(0);
      return;
    }

    // Active only while the ball is live: during the pre-serve hold there is
    // nothing to track, so the paddle eases home.
    const active = mode.state.screen === "playing";
    pawn.drive(aiVelocity(pawn.transform.y, ball.sim(), active, dt));
  }
}

/** First to WIN_SCORE, winning by at least WIN_LEAD (specs/ui.md). */
function decideWinner(p1: number, p2: number): Side | null {
  if (p1 >= WIN_SCORE && p1 - p2 >= WIN_LEAD) return "left";
  if (p2 >= WIN_SCORE && p2 - p1 >= WIN_LEAD) return "right";
  return null;
}
