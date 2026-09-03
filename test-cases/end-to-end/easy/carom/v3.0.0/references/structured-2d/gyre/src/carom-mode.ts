// Carom — the rules both levels share: the frame's input, the menus, the
// pre-serve countdown and the serve, the goals, the win rule, and the obstacle
// clock.
//
// Carom's six screens are split across two levels (`src/state.ts`), and a game
// mode governs one world — so this base class holds every rule that is about
// the SCREEN rather than about the level, and `TitleMode` and `MatchMode` add
// only what their own level brings: who reads the input, and which participants
// there are. A screen change that crosses the split is a level transition,
// which is why every one of them goes through the instance
// (`src/game.ts`, `src/carry.ts`).
//
// INPUT ORDER (specs/ui.md). Every edge is read at the top of the frame, before
// anything moves, because controllers tick before any actor: the primary
// controller calls `beginFrame`, which adds the frame to the simulation clock
// and then routes the frame's input, and the paddles, the ball, and the
// obstacles advance under whatever screen the input left. Within `beginFrame`
// the keyboard is read first and the pointer after it, which is the order
// specs/ui.md fixes for a frame carrying both.
//
// JUDGING ORDER. The mode's own tick runs after every actor has ticked, so the
// countdown and the goals are judged against the frame's settled world: the
// serve happens on the first frame the hold reaches zero, a point lands on the
// frame the advanced ball is past a goal edge (specs/balls.md), and the
// obstacle clock winds once, last, after the ball has taken every sub-step
// (specs/playfield.md).

import { GameMode } from "@test-cabinet/structured-2d";
import type { InputReader, PointerSample } from "@test-cabinet/structured-2d";
import { Ball } from "./ball";
import {
  BALL_R,
  CUES,
  FIELD_W,
  SERVE_ANGLE,
  SERVE_SPEED,
  WIN_LEAD,
  WIN_SCORE,
} from "./constants";
import { ballOf, poseObstacles } from "./field";
import { menuItemAt, menuItemCount, menuLayout } from "./menus";
import { menuDown, menuUp } from "./input";
import type { Side } from "./sim";
import { CaromState, isLiveScreen, type Screen } from "./state";

export abstract class CaromMode extends GameMode {
  declare readonly state: CaromState;

  gameStateClass = CaromState;

  /**
   * One frame's clock and one frame's input, called once by the level's
   * primary controller before any actor ticks.
   *
   * `simTime` accumulates on EVERY update, whatever the screen, the paused
   * screen and the menus included (specs/state.md), so it is added here rather
   * than inside a per-screen branch — and it is added before the input, so the
   * trail samples this frame's ball records carry the frame's own time.
   */
  beginFrame(dt: number, input: InputReader): void {
    this.state.game.simTime += dt;
    this.readInput(input);
  }

  /** One frame's edges: the keyboard first, then the pointer (specs/ui.md). */
  private readInput(input: InputReader): void {
    const state = this.state;
    // Mute works on every screen, so it is read before the per-screen switch.
    if (input.pressed("mute")) {
      this.world.audio.setMuted(!this.world.audio.muted());
    }

    const before = state.screen;
    const closed = this.readKeys(input, before);
    // A frame carrying a keyboard confirm confirms the keyboard's item alone,
    // and a screen an update reaches takes its first input on the following
    // update (specs/ui.md) — so either one closes the frame's input here.
    if (closed || state.screen !== before) {
      state.pressedItem = null;
      return;
    }
    this.readPointer(input);
  }

  /**
   * The frame's keyboard edges, routed by the screen they arrive on
   * (specs/ui.md). Answers whether the keyboard closed the frame's input — a
   * confirm, or a `back` that leaves the screen — after which the pointer is
   * not read (specs/ui.md).
   */
  private readKeys(input: InputReader, screen: Screen): boolean {
    const state = this.state;

    if (screen === "countdown" || screen === "playing") {
      // A match is live, so Escape means `pause`: `back` is not read here, and
      // the edge it armed is discarded when the input frame closes — which is
      // why one Escape opens the pause menu and leaves it open.
      if (input.pressed("pause")) {
        state.resumeScreen = screen;
        state.screen = "paused";
        state.menuIndex = 0;
      }
      return false;
    }

    if (screen === "paused") {
      // `pause` and `back` are read BEFORE the menu edges, and a frame carrying
      // either resumes and does nothing else. Both are read so one Escape —
      // which arms both — resumes exactly once.
      const paused = input.pressed("pause");
      const back = input.pressed("back");
      if (paused || back) {
        state.screen = state.resumeScreen;
        return false;
      }
      return this.readMenuKeys(input, screen);
    }

    // `back` returns to the title from the how-to page and from the match-over
    // screen (specs/ui.md). Both open the title level, which the engine honors
    // as the frame ends, so the frame's input is finished either way.
    if (
      (screen === "matchover" || screen === "howto") &&
      input.pressed("back")
    ) {
      this.leaveToTitle();
      return true;
    }
    if (screen === "title") {
      // `back` does nothing on the title, but it is read so the Escape edge is
      // accounted for on the frame it arrived.
      input.pressed("back");
    }
    return this.readMenuKeys(input, screen);
  }

  /**
   * A menu's own edges. All three are read before any is acted on, and up is
   * applied before down, movement before confirm (specs/ui.md), so exactly one
   * press moves the selection or accepts it.
   */
  private readMenuKeys(input: InputReader, screen: Screen): boolean {
    const count = menuItemCount(screen);
    const up = menuUp(input);
    const down = menuDown(input);
    const accepted = input.pressed("confirm");
    if (count === 0) return false;

    const state = this.state;
    if (up) {
      state.menuIndex = (state.menuIndex + count - 1) % count;
      return false;
    }
    if (down) {
      state.menuIndex = (state.menuIndex + 1) % count;
      return false;
    }
    if (!accepted) return false;
    this.confirm(state.menuIndex);
    return true;
  }

  /**
   * The frame's pointer and touch samples, in arrival order (specs/ui.md).
   *
   * A move onto an item's region selects it, and so does a contact landing on
   * one — a finger does not hover, so its landing is both. A confirm takes BOTH
   * of its edges inside ONE region: the landing is remembered as `pressedItem`
   * and the lift confirms only when it falls in the same one, so pressing on
   * one item and releasing on another confirms nothing, and an edge outside
   * every region confirms nothing either.
   *
   * The samples are walked to the end before anything is confirmed, so a
   * confirm that changes the screen cannot have the rest of the frame's
   * samples read against the menu it left.
   */
  private readPointer(input: InputReader): void {
    const state = this.state;
    const screen = state.screen;
    if (menuLayout(screen) === null) {
      state.pressedItem = null;
      return;
    }

    let confirmed: number | null = null;
    for (const sample of input.pointerSamples()) {
      // The primary pointer alone drives the menus, so a second finger landing
      // on the screen changes nothing.
      if (!sample.primary) continue;
      confirmed = this.readPointerSample(sample, screen) ?? confirmed;
    }
    if (confirmed !== null) this.confirm(state.menuIndex);
  }

  /** One sample's effect on the selection, and the item it confirmed, if any. */
  private readPointerSample(
    sample: PointerSample,
    screen: Screen,
  ): number | null {
    const state = this.state;
    const over = menuItemAt(screen, sample.x, sample.y);

    if (sample.type === "down") {
      if (over !== null) state.menuIndex = over;
      state.pressedItem = over;
      return null;
    }
    if (sample.type === "move") {
      if (over !== null) state.menuIndex = over;
      return null;
    }
    // A lift. It confirms only where it began.
    const pressed = state.pressedItem;
    state.pressedItem = null;
    if (over === null || over !== pressed) return null;
    state.menuIndex = over;
    return over;
  }

  /** What confirming the item at `index` does on the current screen. */
  private confirm(index: number): void {
    const state = this.state;
    switch (state.screen) {
      case "title":
        // Confirming a title item is what remembers it, from the keyboard,
        // from a pointer, and from a touch contact alike (specs/ui.md).
        state.game.titleIndex = index;
        if (index === 0) this.startMatch("solo");
        else if (index === 1) this.startMatch("versus");
        else {
          state.screen = "howto";
          state.menuIndex = 0;
        }
        return;
      case "howto":
        this.leaveToTitle();
        return;
      case "paused":
        if (index === 0) state.screen = state.resumeScreen;
        else if (index === 1) this.startMatch(state.game.mode);
        else this.leaveToTitle();
        return;
      case "matchover":
        if (index === 0) this.startMatch(state.game.mode);
        else this.leaveToTitle();
        return;
      case "countdown":
      case "playing":
        return;
    }
  }

  /** Start a match, exactly as every entry point starts one (specs/ui.md). */
  private startMatch(mode: "solo" | "versus"): void {
    this.state.game.startMatch(mode);
  }

  /** Return to the title, exactly as every way back returns (specs/ui.md). */
  private leaveToTitle(): void {
    this.state.game.returnToTitle();
  }

  tick(dt: number): void {
    const state = this.state;
    const screen = state.screen;
    if (screen === "countdown") this.countdown(dt);
    else if (screen === "playing") this.judge();
    // Last of all, and only on the live screens: the clock the obstacles pose
    // from, wound once per frame AFTER the ball has taken every sub-step, so
    // all of a frame's sub-steps faced one pose (specs/playfield.md).
    if (isLiveScreen(screen) && state.obstacleClockRunning) {
      this.setObstacleClock(state.obstacleClock + dt);
    }
  }

  /** Set the obstacle clock and repose every obstacle on the field from it. */
  setObstacleClock(t: number): void {
    this.state.obstacleClock = t;
    poseObstacles(this.world, t);
  }

  /**
   * The pre-serve hold. Every countdown frame subtracts `dt`; on the first
   * frame the result is `<= 0` the ball is served on that same frame — and it
   * is not advanced on that frame, because it ticked before this, held
   * (specs/balls.md).
   */
  private countdown(dt: number): void {
    const ball = ballOf(this.world);
    if (ball === null) return;
    ball.holdTimer -= dt;
    if (ball.holdTimer > 0) return;
    this.serve(ball);
  }

  /** Launch the ball toward the receiver at SERVE_SPEED (specs/balls.md). */
  private serve(ball: Ball): void {
    const state = this.state;
    const dir = state.receiver === "left" ? -1 : 1;
    // The SIGN of the serve's vertical component is the one draw this game
    // makes from its seeded generator, kept on the instance so a reseeded
    // replay crosses the level transition a match opens with.
    const sign = state.game.drawServeSign();
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
    if (ball === null || ball.held) return;
    if (ball.transform.x - BALL_R > FIELD_W) this.scoreFor("left");
    else if (ball.transform.x + BALL_R < 0) this.scoreFor("right");
  }

  private scoreFor(scorer: Side): void {
    const state = this.state;
    if (scorer === "left") state.score.p1 += 1;
    else state.score.p2 += 1;
    this.world.audio.play(CUES.score);

    const winner = decideWinner(state.score.p1, state.score.p2);
    if (winner !== null) {
      state.winner = winner;
      state.screen = "matchover";
      state.menuIndex = 0;
      // The ball is left where it is (specs/balls.md).
      this.setPhase("over");
      return;
    }

    // The next serve travels toward the player who was just scored on.
    // Parked at its home point with a full hold and no trail (specs/balls.md).
    ballOf(this.world)?.park();
    state.receiver = scorer === "left" ? "right" : "left";
    state.screen = "countdown";
  }
}

/** First to WIN_SCORE, winning by at least WIN_LEAD (specs/balls.md). */
export function decideWinner(p1: number, p2: number): Side | null {
  if (p1 >= WIN_SCORE && p1 - p2 >= WIN_LEAD) return "left";
  if (p2 >= WIN_SCORE && p2 - p1 >= WIN_LEAD) return "right";
  return null;
}
