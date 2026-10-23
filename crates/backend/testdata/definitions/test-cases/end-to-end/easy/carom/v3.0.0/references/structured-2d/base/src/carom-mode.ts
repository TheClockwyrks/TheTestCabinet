// Carom — the game mode: the match rules, the menus, and the two controllers
// that drive the paddles.
//
// ONE MODE HOSTS ALL SIX SCREENS. specs/instrumentation.md makes `setScreen` an
// ATOMIC pose — it sets the screen and "leaves the scores, the world, and the
// menu indices as they are" — so a screen cannot be a level. The mode below
// therefore runs the title menu, the how-to page, the countdown, live play, the
// pause menu, and the match-over screen over one world, and the two levels
// `LEVELS` names are the two ways a world is STARTED rather than two halves of
// the state machine: `TitleLevelMode` opens the game on its title screen and
// `MatchLevelMode` opens a fresh match, which is exactly the pair of
// arrangements specs/ui.md fixes under "Starting a match" and "Returning to the
// title". Every other screen change is a field set.
//
// INPUT ORDER. Every edge is read at the top of the frame, before anything
// moves, because controllers tick before any actor: the primary player
// controller routes the frame's edges into `handleInput`, and the paddles and
// ball then advance under whatever screen the edges left. The engine consumes
// an edge per controller on first read, so routing through ONE controller is
// what keeps one press meaning one thing.
//
// WITHIN A FRAME, specs/ui.md fixes the order exactly, and `handleInput`
// follows it: `mute` first on every screen; then, on `paused`, `pause` and
// `back` BEFORE the menu edges, with a frame carrying either resuming and doing
// nothing else; then the menu's own edges, up before down and movement before
// `confirm`; and last the pointer and the touch contacts, which is why a frame
// carrying both a keyboard movement edge and a pointer selection ends on the
// pointer's item. `Escape` raises `pause` and `back` together, and the branch a
// frame takes is chosen from the screen it BEGAN on — so one Escape on
// `countdown` opens the pause menu and leaves it open, and one Escape on
// `paused` resumes exactly once.
//
// JUDGING ORDER. The mode's own tick runs after every actor has ticked, so the
// countdown and the goals are judged against the frame's settled world: the
// serve happens on the first frame the hold reaches zero, and a point lands on
// the frame the advanced ball is past a goal edge (specs/balls.md).

import { GameMode, PlayerController } from "@clockwyrks/structured-2d";
import type {
  Controller,
  InputReader,
  Transform,
} from "@clockwyrks/structured-2d";
import { aiVelocity } from "./ai";
import { Ball, ballOf, spawnBallActor } from "./ball";
import {
  BALL_R,
  CUES,
  FIELD_CY,
  FIELD_W,
  HOLD_TIME,
  LEVELS,
  OBSTACLE_CENTERS,
  PADDLE_SPEED,
  SERVE_ANGLE,
  SERVE_SPEED,
  WIN_LEAD,
  WIN_SCORE,
} from "./constants";
import { menuHitTest, menuItemCount } from "./menu";
import { menuDown, menuUp, p1Axis, p2Axis, soloAxis } from "./input";
import { Paddle, paddleOf, paddleTag } from "./paddle";
import { obstaclesOf, spawnObstacleActor } from "./scenery";
import { paddleCenterX, type Side } from "./sim";
import { CaromState, isLiveScreen, type Mode, type Screen } from "./state";
import { PLAYER_NAME } from "./theme";

/** Where one pointer's press landed, so its release can be judged against it. */
interface PressOrigin {
  /** The screen the press fell on: a confirm takes both edges on one menu. */
  readonly screen: Screen;
  /** The item the press fell inside, or `null` for a press outside every one. */
  readonly index: number | null;
}

export class CaromMode extends GameMode {
  declare readonly state: CaromState;

  gameStateClass = CaromState;
  playerControllerClass = PaddleController;
  pawnClass = Paddle;

  /**
   * Where each pointer's press landed. specs/ui.md confirms an item only when
   * "the press and its release" fall inside ONE item's region, and the two
   * edges may be frames apart, so the press has to be remembered — on the mode,
   * a framework object, rather than in a module variable (specs/state.md).
   */
  private readonly presses = new Map<number, PressOrigin>();

  /**
   * The world's two seats and its bodies. Both paddles are always present, so
   * both arrive through possession; the obstacles and the ball are spawned
   * after them, which puts the ball last in spawn order and therefore last to
   * tick, so a contact reads each paddle's integrated velocity for the frame.
   */
  beginPlay(): void {
    const left = this.addPlayer({ name: PLAYER_NAME.left });
    this.dress(left.pawn, "left");
    const right = this.addPlayer({ name: PLAYER_NAME.rightHuman });
    this.dress(right.pawn, "right");

    for (let index = 0; index < OBSTACLE_CENTERS.length; index++) {
      spawnObstacleActor(this.world, index);
    }
    spawnBallActor(this.world);
    this.setPhase("playing");
  }

  /**
   * The opening pose that needs the game instance, run by
   * `CaromGame.worldOpened` once the world is built. `beginPlay` cannot do it:
   * the instance is bound to the state only after the mode has begun play.
   */
  arrive(): void {
    this.nameSeats();
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

  // ---- Input -------------------------------------------------------------

  /**
   * One frame's edges, routed by the screen they arrive on (specs/ui.md).
   * Called by the primary paddle controller at the top of the frame, once,
   * with its own reader.
   */
  handleInput(input: InputReader): void {
    const state = this.state;

    // Mute works on every screen, so it is read before the per-screen switch.
    if (input.pressed("mute")) {
      this.world.audio.setMuted(!this.world.audio.muted());
    }

    switch (state.screen) {
      case "countdown":
      case "playing": {
        // `pause` is read here and `back` is not, so the Escape that opens the
        // pause menu cannot also close it on the same frame.
        this.presses.clear();
        if (input.pressed("pause")) {
          state.resumeScreen = state.screen;
          state.screen = "paused";
          state.menuIndex = 0;
        }
        return;
      }
      case "paused": {
        // Both are read before either is acted on, so one Escape — which
        // raises both — resumes exactly once and leaves nothing armed.
        const pause = input.pressed("pause");
        const back = input.pressed("back");
        if (pause || back) {
          state.screen = state.resumeScreen;
          return;
        }
        if (this.keyboardMenu(input)) return;
        this.pointerMenu(input);
        return;
      }
      case "title": {
        // `back` does nothing on the title, and is read so nothing is left
        // armed for the screen a confirm this frame may reach.
        input.pressed("back");
        if (this.keyboardMenu(input)) return;
        this.pointerMenu(input);
        return;
      }
      case "howto": {
        const confirm = input.pressed("confirm");
        const back = input.pressed("back");
        if (confirm || back) {
          this.toTitle();
          return;
        }
        this.pointerMenu(input);
        return;
      }
      case "matchover": {
        if (input.pressed("back")) {
          this.toTitle();
          return;
        }
        if (this.keyboardMenu(input)) return;
        this.pointerMenu(input);
        return;
      }
    }
  }

  /**
   * The frame's keyboard menu edges, all read before any is acted on: up
   * before down, and movement before `confirm` (specs/ui.md).
   *
   * Returns whether a `confirm` was acted on, which is the one thing that ends
   * the frame's menu handling — a movement edge does not, because a frame
   * carrying both a movement edge and a pointer selection ends on the
   * pointer's item.
   */
  private keyboardMenu(input: InputReader): boolean {
    const up = menuUp(input);
    const down = menuDown(input);
    const confirm = input.pressed("confirm");
    const state = this.state;
    const count = menuItemCount(state.screen);
    if (count === 0) return false;
    if (up) {
      state.menuIndex = (state.menuIndex + count - 1) % count;
      return false;
    }
    if (down) {
      state.menuIndex = (state.menuIndex + 1) % count;
      return false;
    }
    if (!confirm) return false;
    this.confirmItem(state.menuIndex);
    return true;
  }

  /**
   * The frame's pointer and touch samples, in arrival order, applied after the
   * keyboard's edges (specs/ui.md).
   *
   * Samples rather than the snapshot: a sweep that crossed several items
   * between two frames arrives as the ordered positions it visited, so the
   * selection lands on the item the pointer actually finished on. A mouse, a
   * pen, and a finger all reach the game the same way, which is why one loop
   * serves "a pointer moves onto an item" and "a touch contact lands inside
   * one" alike.
   */
  private pointerMenu(input: InputReader): void {
    const state = this.state;
    for (const sample of input.pointerSamples()) {
      const screen = state.screen;
      const hit = menuHitTest(screen, sample.x, sample.y);

      if (sample.type === "down") {
        this.presses.set(sample.id, { screen, index: hit });
        if (hit !== null) state.menuIndex = hit;
        continue;
      }
      if (sample.type === "move") {
        if (hit !== null) state.menuIndex = hit;
        continue;
      }

      // A release. A confirm takes BOTH of its edges inside one item's region
      // on one menu; two edges in different regions, and an edge outside every
      // region, confirm nothing.
      const press = this.presses.get(sample.id);
      this.presses.delete(sample.id);
      if (press === undefined || press.screen !== screen) continue;
      if (hit === null || press.index !== hit) continue;
      state.menuIndex = hit;
      this.confirmItem(hit);
      // The confirm has left this menu, so the rest of the frame's samples are
      // not this menu's to read.
      this.presses.clear();
      return;
    }
  }

  /**
   * Confirming the item at `index` on the current screen — the same effect
   * whichever input raised it, keyboard, mouse, or finger (specs/ui.md).
   */
  private confirmItem(index: number): void {
    const state = this.state;
    switch (state.screen) {
      case "title": {
        // The title menu remembers what led away from it, so returning here
        // lands back on that entry.
        state.game.titleIndex = index;
        if (index === 0) {
          this.startMatch("solo");
          return;
        }
        if (index === 1) {
          this.startMatch("versus");
          return;
        }
        state.screen = "howto";
        state.menuIndex = 0;
        return;
      }
      case "howto":
        this.toTitle();
        return;
      case "paused": {
        if (index === 0) {
          state.screen = state.resumeScreen;
          return;
        }
        if (index === 1) {
          this.startMatch(state.mode);
          return;
        }
        this.toTitle();
        return;
      }
      case "matchover": {
        if (index === 0) {
          this.startMatch(state.mode);
          return;
        }
        this.toTitle();
        return;
      }
      default:
        return;
    }
  }

  /**
   * Start a match, as SOLO, VERSUS, RESTART and PLAY AGAIN all do: open the
   * match level, whose transition builds the arrangement specs/ui.md fixes.
   */
  private startMatch(mode: Mode): void {
    this.world.open(LEVELS.match, { mode });
  }

  /**
   * Return to the title, as QUIT TO MENU, MENU, leaving the how-to screen and
   * `back` on the match-over screen all do: open the title level, whose
   * transition restores every declared field to its title value except the
   * five specs/ui.md exempts.
   */
  private toTitle(): void {
    this.world.open(LEVELS.title);
  }

  // ---- The match ---------------------------------------------------------

  tick(): void {
    const state = this.state;
    if (state.screen === "countdown") {
      // The ball's own tick subtracted this frame's dt from its hold; the
      // first frame the result is <= 0, it is served on that same frame
      // (specs/balls.md). An absent ball takes no part in a frame, so a
      // cleared field simply waits.
      const ball = ballOf(this.world);
      if (ball !== null && ball.holdTimer <= 0) this.serve(ball);
      return;
    }
    if (state.screen === "playing") this.judge();
  }

  /** Launch the ball toward the receiver at SERVE_SPEED (specs/balls.md). */
  private serve(ball: Ball): void {
    const state = this.state;
    const dir = state.receiver === "left" ? -1 : 1;
    // The SIGN of the serve's vertical component is the ball's own, drawn when
    // it was parked or posed since, and the serve leaves it as it is.
    const sign = ball.serveSign;
    ball.holdTimer = 0;
    ball.held = false;
    ball.trail = [];
    ball.vx = dir * SERVE_SPEED * Math.cos(SERVE_ANGLE);
    ball.vy = sign * SERVE_SPEED * Math.sin(SERVE_ANGLE);
    state.screen = "playing";
  }

  /** A point lands the frame the advanced ball is fully past a goal edge. */
  private judge(): void {
    const ball = ballOf(this.world);
    if (ball === null) return;
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
    const ball = ballOf(this.world);
    if (ball !== null) {
      ball.park();
      ball.held = true;
      ball.holdTimer = HOLD_TIME;
    }
    state.receiver = scorer === "left" ? "right" : "left";
    state.screen = "countdown";
  }

  // ---- What the debug surface poses through ------------------------------

  /** Set the mode, and keep the seat names honest about who holds the right. */
  setMode(mode: Mode): void {
    this.state.mode = mode;
    this.nameSeats();
  }

  /**
   * Forget every press a pointer has open, so nothing a `reset` left behind can
   * confirm a menu item later (specs/instrumentation.md: every value the build
   * keeps across frames is rebuilt from what a reset restores).
   */
  forgetPresses(): void {
    this.presses.clear();
  }

  /**
   * Remove every ball and every obstacle, leaving the field empty. The paddles
   * stay: they are the field furniture the game always has, and no operation
   * removes them (specs/instrumentation.md).
   */
  clearWorld(): void {
    for (const ball of this.world.ofType(Ball)) ball.destroy();
    for (const obstacle of obstaclesOf(this.world)) obstacle.destroy();
  }

  /** The field as a fresh title screen or a fresh match holds it. */
  standardWorld(): void {
    this.clearWorld();
    spawnBallActor(this.world);
    for (let index = 0; index < OBSTACLE_CENTERS.length; index++) {
      spawnObstacleActor(this.world, index);
    }
  }

  /** Both paddles at the field's centre height, standing still. */
  centerPaddles(): void {
    for (const side of ["left", "right"] as const) {
      const paddle = paddleOf(this.world, side);
      paddle.transform.y = FIELD_CY;
      paddle.vy = 0;
    }
  }

  /** The right seat is the AI's in Solo and player two's in Versus. */
  protected nameSeats(): void {
    const [, right] = this.state.players;
    if (right === undefined) return;
    right.name =
      this.state.mode === "solo" ? PLAYER_NAME.rightAi : PLAYER_NAME.rightHuman;
  }

  /** Put a freshly possessed paddle on its side, under its case-fixed tag. */
  private dress(pawn: unknown, side: Side): void {
    if (!(pawn instanceof Paddle)) {
      throw new Error("Carom: the Carom mode possesses Paddle pawns");
    }
    pawn.side = side;
    pawn.addTag(paddleTag(side));
  }
}

/**
 * The `title` level's mode: the game as it opens, and as every path back to the
 * title leaves it (specs/ui.md, "Returning to the title").
 */
export class TitleLevelMode extends CaromMode {
  override beginPlay(): void {
    super.beginPlay();
    const state = this.state;
    state.screen = "title";
    state.mode = "solo";
    state.menuIndex = 0;
    state.resumeScreen = "playing";
    state.winner = null;
    state.receiver = "left";
  }

  override arrive(): void {
    const game = this.state.game;
    // Every declared field returns to its title-screen value except
    // `titleIndex`, `simTime` and `muted` — and `menuIndex`,
    // which becomes `titleIndex`, so the entry that led away from the title is
    // the entry the player lands back on.
    game.ai.tracking = true;
    game.ai.movement = true;
    for (const side of ["left", "right"] as const) {
      game.driven[side] = false;
      game.drivenVy[side] = 0;
    }
    this.state.menuIndex = game.titleIndex;
    super.arrive();
  }
}

/**
 * The `match` level's mode: a match as SOLO, VERSUS, RESTART and PLAY AGAIN all
 * start one (specs/ui.md, "Starting a match"). `titleIndex` keeps its value,
 * so it is not touched here.
 */
export class MatchLevelMode extends CaromMode {
  override beginPlay(): void {
    super.beginPlay();
    const state = this.state;
    state.mode = this.options.mode === "versus" ? "versus" : "solo";
    state.screen = "countdown";
    state.resumeScreen = "playing";
    state.menuIndex = 0;
    state.winner = null;
    state.receiver = "left";
  }
}

/**
 * A paddle's seat. The primary seat (index 0) also carries the frame's clock
 * and routes the frame's edges into the mode, before anything moves.
 *
 * Which driver a seat listens to is decided per frame rather than per world,
 * because both `mode` and a paddle's `driven` flag are state a pose can change
 * at any moment: a driven paddle follows the `drivenVy` held for its side, the
 * left paddle follows the movement actions, and the right follows player two in
 * Versus and the AI rule in Solo.
 */
export class PaddleController extends PlayerController {
  tick(dt: number): void {
    const mode = this.world.mode;
    if (!(mode instanceof CaromMode)) return;
    const state = mode.state;
    const game = state.game;

    if (this.playerState.index === 0) {
      // `simTime` accumulates on every update, whatever the screen
      // (specs/state.md). It is added here, before any actor ticks, so the
      // trail sample the ball stamps this frame carries this frame's time.
      game.simTime += dt;
      mode.handleInput(this.input);
    }

    const pawn = this.pawn;
    if (!(pawn instanceof Paddle)) return;
    if (!isLiveScreen(state.screen)) return;

    const side = pawn.side;
    if (game.driven[side]) {
      pawn.drive(game.drivenVy[side]);
      return;
    }
    if (side === "left") {
      // Solo has no player two, so both sliders drive the one human paddle.
      const axis =
        state.mode === "solo" ? soloAxis(this.input) : p1Axis(this.input);
      pawn.drive(axis * PADDLE_SPEED);
      return;
    }
    if (state.mode === "versus") {
      pawn.drive(p2Axis(this.input) * PADDLE_SPEED);
      return;
    }
    const ball = ballOf(this.world);
    pawn.drive(
      aiVelocity(
        pawn.transform.y,
        { ball: ball?.sim() ?? null, playing: state.screen === "playing" },
        game.ai,
        dt,
      ),
    );
  }
}

/** First to WIN_SCORE, winning by at least WIN_LEAD (specs/balls.md). */
export function decideWinner(p1: number, p2: number): Side | null {
  if (p1 >= WIN_SCORE && p1 - p2 >= WIN_LEAD) return "left";
  if (p2 >= WIN_SCORE && p2 - p1 >= WIN_LEAD) return "right";
  return null;
}
