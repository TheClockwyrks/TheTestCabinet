// Carom — the match level: its game mode, and the three seats that drive the
// paddles.
//
// The match rules themselves — the pre-serve countdown and the serve, the
// goals, the win rule, the pause and match-over menus, and the obstacle clock —
// are `CaromMode`'s, shared with the title level (`src/carom-mode.ts`). What
// this mode adds is the match's PARTICIPANTS: player one on the left paddle,
// player two on the right, and an AI bot beside them.
//
// WHY ALL THREE ARE SEATED AT ONCE. `mode` is declared state, and
// `setMode(mode)` poses it on a match that is already open
// (specs/instrumentation.md) — so who drives the right paddle cannot be decided
// once, when the world is built. Both candidates are therefore added in
// `beginPlay`, and the right paddle's POSSESSION is reconciled at the top of
// every frame, before either of them ticks: in Solo the bot holds it, in Versus
// player two does. One controller holds one pawn and one pawn answers to one
// controller, which is exactly what `possess` guarantees.
//
// The paddles arrive through possession, so the mode places them at its own
// spawn points rather than the level listing them; the ball and the obstacles
// are placed by the instance as it dresses the world (`src/carry.ts`), which is
// what makes an absent ball or a cleared field survive into a new world.

import { AIController, PlayerController } from "@test-cabinet/structured-2d";
import type {
  Controller,
  InputReader,
  Transform,
} from "@test-cabinet/structured-2d";
import { aiVelocity } from "./ai";
import { CaromMode } from "./carom-mode";
import { FIELD_CY, PADDLE_SPEED, TAGS } from "./constants";
import { ballOf, paddleOf } from "./field";
import { p1Axis, p2Axis, soloAxis } from "./input";
import { Paddle } from "./paddle";
import { paddleCenterX, type Side } from "./sim";
import { isLiveScreen } from "./state";
import { PLAYER_NAME } from "./theme";

export class MatchMode extends CaromMode {
  playerControllerClass = PaddleController;
  pawnClass = Paddle;

  /** Player two's seat: it holds the right paddle in Versus. */
  private rightSeat: PlayerController | null = null;
  /** The computer opponent's seat: it holds the right paddle in Solo. */
  private bot: AIController | null = null;

  beginPlay(): void {
    const left = this.addPlayer({ name: PLAYER_NAME.left });
    this.dress(left.pawn, "left");
    const right = this.addPlayer({ name: PLAYER_NAME.rightHuman });
    this.dress(right.pawn, "right");
    this.rightSeat = right;
    // The bot possesses nothing yet: `seatRightPaddle` hands it the right
    // paddle on the first frame of a Solo match and takes it back in Versus.
    this.bot = this.addBot(AiPaddleController, {
      name: PLAYER_NAME.rightAi,
      pawn: null,
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
   * The right paddle is reseated before the frame's input is read, which is
   * before player two's seat and the bot tick — so a `setMode` on one frame is
   * honored on the next frame's drive rather than a frame later.
   */
  override beginFrame(dt: number, input: InputReader): void {
    this.seatRightPaddle();
    super.beginFrame(dt, input);
  }

  /** Which mode this match is played in, read live off the game instance. */
  modeName(): "solo" | "versus" {
    return this.state.game.mode;
  }

  private seatRightPaddle(): void {
    const paddle = paddleOf(this.world, "right");
    if (paddle === null) return;
    const wanted: Controller | null =
      this.modeName() === "solo" ? this.bot : this.rightSeat;
    if (wanted === null || wanted.pawn === paddle) return;
    // Possessing a pawn another controller holds unpossesses that one first.
    wanted.possess(paddle);
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
 * A human's paddle. The primary seat (index 0) also hands the frame to the mode
 * before anything moves.
 *
 * A paddle the debug surface has taken ignores whatever it is driven with
 * (src/paddle.ts), so nothing here has to know about the hold: the controller
 * asks for its velocity every frame either way, and the pawn decides.
 */
export class PaddleController extends PlayerController {
  tick(dt: number): void {
    const mode = this.world.mode;
    if (!(mode instanceof MatchMode)) return;
    if (this.playerState.index === 0) mode.beginFrame(dt, this.input);

    const pawn = this.pawn;
    if (!(pawn instanceof Paddle)) return;
    if (!isLiveScreen(mode.state.screen)) return;

    // Solo has no player two, so both sliders drive the one human paddle
    // (specs/modes/single-player.md).
    const axis =
      mode.modeName() === "solo"
        ? soloAxis(this.input)
        : pawn.side === "left"
          ? p1Axis(this.input)
          : p2Axis(this.input);
    pawn.drive(axis * PADDLE_SPEED);
  }
}

/**
 * The computer opponent's seat, which holds the right paddle in Solo. It
 * computes its drive from the world — the arithmetic itself is `src/ai.ts` —
 * and hands it to the same pawn interface a player drives.
 *
 * Both of the AI's faculties are declared state and are read fresh each frame,
 * so `setAiTracking` and `setAiMovement` act on the rule from the next frame
 * (specs/instrumentation.md).
 */
export class AiPaddleController extends AIController {
  tick(dt: number): void {
    const mode = this.world.mode;
    if (!(mode instanceof MatchMode)) return;

    const pawn = this.pawn;
    if (!(pawn instanceof Paddle)) return;
    const state = mode.state;
    if (!isLiveScreen(state.screen)) return;

    const ball = ballOf(this.world);
    pawn.drive(
      aiVelocity(
        pawn.transform.y,
        ball === null ? null : ball.sim(),
        state.screen === "playing",
        dt,
        state.ai,
      ),
    );
  }
}
