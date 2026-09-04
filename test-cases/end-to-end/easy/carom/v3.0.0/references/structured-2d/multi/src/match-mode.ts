// Carom — the match level: its game mode, and the controller that drives a
// paddle.
//
// The mode holds the match rules (specs/ui.md, specs/balls.md): the opening
// countdown, the goals, the win and deuce rules, and the pause and match-over
// menus. It seats two participants, one per side, and each seat's controller
// decides every frame who is actually driving its paddle — the debug surface,
// the AI, or the keys. The launches themselves are not here: the rally counts
// every hold down and launches each ball the moment its own hold elapses
// (src/rally.ts), on the opening countdown and mid-rally alike.
//
// WHY THE AI IS A BEHAVIOUR RATHER THAN A SEAT. `setMode` sets the mode and
// nothing else (specs/instrumentation.md), and it is called on a match already
// open — so who drives the right paddle cannot be decided once, when the world
// is built, and baked into the class of a controller. It is read from the
// instance's `mode` every frame instead, which is also the honest description
// of the two ways to play: the same match, with the right paddle answering to
// a person or to the computer.
//
// INPUT ORDER. Every edge is read at the top of the frame, before anything
// moves, because controllers tick before any actor: the primary seat routes the
// frame's input into `handleInput`, and the paddles and balls then advance under
// whatever screen the input left it on. The engine consumes an edge per
// controller on first read, so routing through ONE controller is what keeps one
// press meaning one thing.
//
// JUDGING ORDER. The mode's own tick runs after every actor has ticked, so the
// countdown and the goals are judged against the frame's settled world: the
// opening countdown ends on the frame the last ball has launched, and a point
// lands on the frame the advanced ball is past a goal edge (specs/balls.md) —
// parking that one ball for its own respawn while the others carry on.

import { GameMode, PlayerController } from "@test-cabinet/structured-2d";
import type {
  Controller,
  InputReader,
  Transform,
} from "@test-cabinet/structured-2d";
import { aiVelocity, threatBall } from "./ai";
import type { Ball } from "./ball";
import {
  BALL_R,
  CUES,
  FIELD_CY,
  FIELD_W,
  HOLD_TIME,
  PADDLE_SPEED,
  TAGS,
  WIN_LEAD,
  WIN_SCORE,
} from "./constants";
import { ballsOf, buildStandardField } from "./field";
import { driveMenu, p1Axis, p2Axis, readMenuFrame, soloAxis } from "./input";
import { Paddle } from "./paddle";
import { Rally } from "./rally";
import { paddleCenterX, type Side } from "./sim";
import { CaromState, gameOf, isSimulating, type Mode } from "./state";
import { PLAYER_NAME } from "./theme";

export class MatchMode extends GameMode {
  declare readonly state: CaromState;

  gameStateClass = CaromState;
  playerControllerClass = PaddleController;
  pawnClass = Paddle;

  /** The way this match was opened, which the instance takes as its `mode`. */
  modeName: Mode = "solo";

  beginPlay(): void {
    this.modeName = this.options.mode === "versus" ? "versus" : "solo";

    // The opening pose (specs/ui.md, "Starting a match"): the countdown, with
    // every ball waiting out a full hold on its own home point so all three
    // launch together, and both scores at zero.
    const state = this.state;
    state.screen = "countdown";
    state.resumeScreen = "playing";
    state.menuIndex = 0;
    state.winner = null;
    state.score = { p1: 0, p2: 0 };

    const one = this.addPlayer({ name: PLAYER_NAME.left });
    this.dress(one.pawn, "left");
    const two = this.addPlayer({ name: PLAYER_NAME.right });
    this.dress(two.pawn, "right");

    // The field after the paddles, and the rally LAST, so the frame's holds and
    // flight run once both paddles have integrated (src/rally.ts).
    buildStandardField(this.world);
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
   * One frame's input, routed by the screen it arrives on (specs/ui.md).
   * Called by the primary paddle controller at the top of the frame, once,
   * with its own reader.
   */
  handleInput(input: InputReader): void {
    const game = gameOf(this.world);
    if (game.frozen) return;

    // Mute works on every screen, so it is read before the per-screen switch.
    if (input.pressed("mute")) {
      this.world.audio.setMuted(!this.world.audio.muted());
    }

    const state = this.state;
    switch (state.screen) {
      case "countdown":
      case "playing": {
        // `pause` is read here and `back` is not, so the one Escape press that
        // raises both opens the pause menu and leaves it open (specs/ui.md).
        if (input.pressed("pause")) {
          state.resumeScreen = state.screen;
          state.screen = "paused";
          state.menuIndex = 0;
        }
        return;
      }
      case "paused": {
        // Both are read, before the menu edges, and a frame carrying either
        // resumes and does nothing else — so the one Escape press that raises
        // both resumes once (specs/ui.md).
        const pause = input.pressed("pause");
        const back = input.pressed("back");
        if (pause || back) {
          state.screen = state.resumeScreen;
          return;
        }
        driveMenu(
          state,
          readMenuFrame(input, state.screen, game.pressOrigins),
          (index) => {
            this.pauseItem(index);
          },
        );
        return;
      }
      case "matchover": {
        const frame = readMenuFrame(input, state.screen, game.pressOrigins);
        if (input.pressed("back")) {
          game.goToTitle(game.titleIndex);
          return;
        }
        driveMenu(state, frame, (index) => {
          this.matchOverItem(index);
        });
        return;
      }
      default:
        return;
    }
  }

  tick(): void {
    const state = this.state;
    if (gameOf(this.world).frozen) return;
    if (state.screen === "countdown") {
      // The screen becomes `playing` on the first countdown frame on which no
      // ball is held, after the balls have been advanced (specs/balls.md) —
      // and the mode ticks after every actor.
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
    const score = state.score;
    if (scorer === "left") score.p1 += 1;
    else score.p2 += 1;
    this.world.audio.play(CUES.score);

    const winner = decideWinner(score.p1, score.p2);
    if (winner !== null) {
      state.winner = winner;
      state.screen = "matchover";
      state.menuIndex = 0;
      // Every ball is left where it is (specs/balls.md).
      this.setPhase("over");
      return;
    }

    // Only the ball that crossed is affected: it takes its own home point and
    // a fresh hold, relaunching when that hold elapses, while the others carry
    // on through the respawn on a field that keeps running.
    ball.park(HOLD_TIME);
  }

  private pauseItem(index: number): void {
    const game = gameOf(this.world);
    if (index === 0) {
      this.state.screen = this.state.resumeScreen;
      return;
    }
    if (index === 1) {
      game.startMatch(game.mode);
      return;
    }
    game.goToTitle(game.titleIndex);
  }

  private matchOverItem(index: number): void {
    const game = gameOf(this.world);
    if (index === 0) {
      game.startMatch(game.mode);
      return;
    }
    game.goToTitle(game.titleIndex);
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
 * One participant's paddle.
 *
 * The primary seat (index 0) also routes the frame's input into the mode before
 * anything moves. Every seat then decides who drives its own pawn this frame,
 * in the order specs/instrumentation.md and specs/modes/ fix: the debug
 * surface's hold on that side first, then — on the right paddle in Solo — the
 * AI, and otherwise the movement actions.
 */
export class PaddleController extends PlayerController {
  tick(dt: number): void {
    const mode = this.world.mode;
    if (!(mode instanceof MatchMode)) return;
    if (this.playerState.index === 0) mode.handleInput(this.input);

    const pawn = this.pawn;
    if (!(pawn instanceof Paddle)) return;
    if (!isSimulating(this.world)) return;

    const game = gameOf(this.world);
    const hold = game.driver[pawn.side];
    if (hold.driven) {
      pawn.drive(hold.drivenVy);
      return;
    }
    if (pawn.side === "right" && game.mode === "solo") {
      pawn.drive(this.aiDrive(mode, pawn, dt));
      return;
    }

    // Solo has no player two, so both sliders drive the one human paddle.
    const axis =
      game.mode === "solo"
        ? soloAxis(this.input)
        : pawn.side === "left"
          ? p1Axis(this.input)
          : p2Axis(this.input);
    pawn.drive(axis * PADDLE_SPEED);
  }

  /**
   * The computer opponent's frame, with each of its two faculties gated on its
   * own (specs/instrumentation.md): with `tracking` off it has no defended ball
   * and eases home, and with `movement` off it stays where it is at `vy` of 0.
   */
  private aiDrive(mode: MatchMode, pawn: Paddle, dt: number): number {
    const game = gameOf(this.world);
    if (!game.ai.movement) return 0;
    const threat = game.ai.tracking
      ? threatBall(ballsOf(this.world).map((ball) => ball.rally()))
      : null;
    const active = mode.state.screen === "playing";
    return aiVelocity(pawn.transform.y, threat, active, dt);
  }
}

/** First to WIN_SCORE, winning by at least WIN_LEAD (specs/balls.md). */
function decideWinner(p1: number, p2: number): Side | null {
  if (p1 >= WIN_SCORE && p1 - p2 >= WIN_LEAD) return "left";
  if (p2 >= WIN_SCORE && p2 - p1 >= WIN_LEAD) return "right";
  return null;
}
