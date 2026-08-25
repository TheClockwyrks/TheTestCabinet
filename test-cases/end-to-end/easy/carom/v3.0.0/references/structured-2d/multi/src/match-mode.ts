// Carom — the match level: its game mode, and the two controllers that drive
// the paddles.
//
// The mode holds the match rules (specs/ui.md, specs/balls.md): the opening
// countdown, the goals, the win and deuce rules, and the pause and match-over
// menus. It builds the match from the classes it names — `addPlayer` seats
// player one on the left paddle, and the right paddle goes to a second player
// (Versus) or to the AI bot (Solo), so the two modes of play differ only in
// who drives one pawn. The launches themselves are not here: each ball runs
// its own hold and launches itself the moment that hold elapses
// (`src/ball.ts`), on the opening countdown and mid-rally alike.
//
// INPUT ORDER. Every edge is read at the top of the frame, before anything
// moves, because controllers tick before any actor: the primary player
// controller routes the frame's edges into `handleInput`, and the paddles and
// balls then advance under whatever screen the edges left. The engine consumes
// an edge per controller on first read, so routing through ONE controller is
// what keeps one press meaning one thing.
//
// JUDGING ORDER. The mode's own tick runs after every actor has ticked, so the
// countdown and the goals are judged against the frame's settled world: the
// opening countdown ends on the frame the last ball has launched, and a point
// lands on the frame the advanced ball is past a goal edge (specs/balls.md) —
// parking that one ball for its own respawn while the other two carry on.
//
// Every way a match starts — SOLO or VERSUS on the title, RESTART on the pause
// menu, PLAY AGAIN after a match — is one act: `world.open` on the match
// level, whose transition rebuilds the world fresh (specs/ui.md, "Starting a
// match").

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
import { aiVelocity, threatBall } from "./ai";
import { Ball, ballsOf } from "./ball";
import {
  BALL_HOMES,
  BALL_R,
  CUES,
  FIELD_CY,
  FIELD_W,
  HOLD_TIME,
  LEVELS,
  MATCHOVER_ITEMS,
  PADDLE_SPEED,
  PAUSE_ITEMS,
  TAGS,
  WIN_LEAD,
  WIN_SCORE,
} from "./constants";
import { menuDown, menuUp, p1Axis, p2Axis, soloAxis } from "./input";
import { Paddle } from "./paddle";
import { Rally } from "./rally";
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

    // The opening pose (specs/ui.md, "Starting a match"): the countdown, with
    // every ball waiting out a full hold on its own home point so all three
    // launch together. The scores start at zero on the player states the
    // framework builds.
    const state = this.state;
    state.screen = "countdown";
    state.resumeScreen = "playing";
    state.menuIndex = 0;
    state.winner = null;

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

    // The balls are spawned after the paddles, in play order — which is the
    // order `world.byTag` lists them in, the order `setBall` addresses — and
    // the rally LAST, so the frame's flight runs after both paddles have
    // integrated and after every elapsed hold has launched (src/rally.ts).
    BALL_HOMES.forEach((home, index) => {
      this.world.spawn(Ball, {
        transform: { x: home.x, y: home.y },
        tags: [TAGS.ball],
        configure: (ball: Ball) => {
          ball.index = index;
          ball.park(HOLD_TIME);
        },
      });
    });
    this.world.spawn(Rally);

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

  tick(): void {
    const state = this.state;
    if (state.screen === "countdown") {
      // The screen becomes `playing` on the first countdown frame on which no
      // ball is held, after the balls have been advanced (specs/balls.md) —
      // and the mode ticks after every actor. Each ball ran its own hold and
      // launch before this (src/ball.ts).
      if (ballsOf(this.world).every((ball) => !ball.held)) {
        state.screen = "playing";
      }
      return;
    }
    if (state.screen === "playing") this.judge();
  }

  /**
   * A point lands the frame a ball in flight is fully past a goal edge. Each
   * ball scores on its own; a won match ends the frame and freezes the
   * remaining balls where they are.
   */
  private judge(): void {
    for (const ball of ballsOf(this.world)) {
      if (ball.held) continue;
      if (ball.transform.x - BALL_R > FIELD_W) this.scoreFor("left", ball);
      else if (ball.transform.x + BALL_R < 0) this.scoreFor("right", ball);
      if (this.state.screen === "matchover") return;
    }
  }

  private scoreFor(scorer: Side, ball: Ball): void {
    const state = this.state;
    const [p1, p2] = state.players;
    (scorer === "left" ? p1 : p2).score += 1;
    this.world.audio.play(CUES.score);

    const winner = decideWinner(p1.score, p2.score);
    if (winner !== null) {
      state.winner = winner;
      state.screen = "matchover";
      state.menuIndex = 0;
      // Every ball is left where it is (specs/balls.md).
      this.setPhase("over");
      return;
    }

    // Only the ball that crossed is affected: it takes its own home point and
    // a fresh hold, relaunching when that hold elapses, while the other two
    // carry on through the respawn on a field that keeps running.
    ball.park(HOLD_TIME);
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
 * it to the same pawn interface a player drives. Of the three balls it
 * defends one at a time: the one arriving at its goal soonest.
 *
 * The debug driver's hold covers this paddle too, except when the scenario
 * flips the AI switch back on (`setAiControl`), which is exactly the real AI
 * playing against the posed balls.
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

    // Active only while the field is live: during the opening countdown there
    // is nothing to track, so the paddle eases home.
    const active = mode.state.screen === "playing";
    const threat = threatBall(ballsOf(this.world).map((ball) => ball.rally()));
    pawn.drive(aiVelocity(pawn.transform.y, threat, active, dt));
  }
}

/** First to WIN_SCORE, winning by at least WIN_LEAD (specs/ui.md). */
function decideWinner(p1: number, p2: number): Side | null {
  if (p1 >= WIN_SCORE && p1 - p2 >= WIN_LEAD) return "left";
  if (p2 >= WIN_SCORE && p2 - p1 >= WIN_LEAD) return "right";
  return null;
}
