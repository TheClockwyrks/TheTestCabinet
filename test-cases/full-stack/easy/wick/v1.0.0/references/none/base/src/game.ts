// Wick — the game over its state: the screens, the menus, the frame's update,
// and the cues a frame plays (specs/ui.md, specs/controls.md
// "The pointer", specs/instrumentation.md "A render-free core").
//
// The simulation itself is `src/sim/`; this is the layer that decides which
// screen ticks, which actions each screen answers, what the pointer does with
// the rectangles `src/layout.ts` fixes, how a frame's delta time becomes
// ticks, and which cues sound. It reads nothing from the renderer.

import {
  almanacEntries,
  clampScroll,
  followHighlight,
  wrapTab,
} from "./almanac";
import {
  CUES,
  END_ITEMS,
  PAUSE_ITEMS,
  TICK_DT,
  TICK_EPSILON,
  TITLE_ITEMS,
  WHEEL_ROW,
  type Action,
  type Cue,
  type Screen,
} from "./constants";
import type { PointerFrame } from "./input";
import { contains, menuRects, tabRects, type Rect } from "./layout";
import { Rng } from "./rng";
import { freshRun, idleRun, initialState, type WickState } from "./state";
import {
  NOTHING_HELD,
  makeTickContext,
  type Held,
  type TickContext,
} from "./sim/context";
import { acceptOffer, openLevelUp } from "./sim/progression";
import { tick } from "./sim/tick";

/** `LIGHT THE LAMP`, the title entry a run leads away from and back to. */
const TITLE_LIGHT_THE_LAMP = TITLE_ITEMS.indexOf("LIGHT THE LAMP");

/** `THE ALMANAC`, the entry `back` on the almanac returns to. */
const TITLE_THE_ALMANAC = TITLE_ITEMS.indexOf("THE ALMANAC");

/** `HOW TO PLAY`, the entry `back` on the how-to screen returns to. */
const TITLE_HOW_TO_PLAY = TITLE_ITEMS.indexOf("HOW TO PLAY");

/** The actions each screen answers as press edges. */
export const SCREEN_ACTIONS: Readonly<Record<Screen, readonly Action[]>> = {
  title: ["up", "down", "confirm", "mute"],
  howto: ["back", "mute"],
  almanac: ["up", "down", "left", "right", "back", "mute"],
  playing: ["pause", "back", "mute"],
  levelup: ["up", "down", "confirm", "mute"],
  chest: ["confirm", "mute"],
  paused: ["up", "down", "confirm", "pause", "back", "mute"],
  fallen: ["up", "down", "confirm", "back", "mute"],
  dawn: ["up", "down", "confirm", "back", "mute"],
};

/** The screens the music loops on. */
const MUSIC_SCREENS: readonly Screen[] = [
  "playing",
  "levelup",
  "chest",
  "paused",
];

export interface GameHooks {
  /** Toggle the runtime's mute bit. */
  toggleMute(): void;
  /** Read the runtime's mute bit. */
  isMuted(): boolean;
}

export class Game {
  state: WickState;
  /** Whether the frame loop feeds the wall clock into the accumulator. */
  autoStep = true;
  /** The movement actions as the current frame read them. */
  held: Held = { ...NOTHING_HELD };
  readonly rng: Rng;
  private readonly cues = new Set<Cue>();
  private readonly hooks: GameHooks;
  /**
   * What the last press edge armed, or `null`.
   *
   * "A primary press edge inside the rectangle of the item at `menuIndex` `i`
   * ... arms that item. That press's release edge inside the same rectangle
   * takes the armed item" (specs/controls.md). The rectangle is held with it,
   * because the release is only the same gesture's if it lifts inside the box
   * the press landed in, and the screen with it, because leaving the screen
   * takes the gesture's target away. It is input state rather than game state,
   * so no declared field carries it and every pose leaves it disarmed.
   */
  private armed: {
    readonly screen: Screen;
    readonly rect: Rect;
    readonly kind: "item" | "tab";
    readonly index: number;
  } | null = null;

  constructor(hooks: GameHooks, rng: Rng = new Rng()) {
    this.hooks = hooks;
    this.state = initialState();
    this.rng = rng;
  }

  get screen(): Screen {
    return this.state.screen;
  }

  /** The cues raised since the last drain, in the order they arose. */
  drainCues(): Cue[] {
    const out = [...this.cues];
    this.cues.clear();
    return out;
  }

  /** Forget the cues raised since the last drain; a pose sounds nothing. */
  discardCues(): void {
    this.cues.clear();
  }

  /** The looping cues the state calls for on this frame. */
  wantedLoops(): Set<Cue> {
    const wanted = new Set<Cue>();
    const { screen, run } = this.state;
    if (MUSIC_SCREENS.includes(screen)) wanted.add(CUES.music);
    if (
      screen === "playing" &&
      run.weapons.some(
        (weapon) => weapon.id === "halo" || weapon.id === "corona",
      )
    ) {
      wanted.add(CUES.hum);
    }
    return wanted;
  }

  /** Mirror the runtime's mute bit into the state. */
  mirrorMuted(): void {
    this.state.muted = this.hooks.isMuted();
  }

  /**
   * Restore every declared field to its title-screen value. `muted` and
   * `autoStep` stay as they are.
   */
  reset(): void {
    const muted = this.state.muted;
    this.armed = null;
    this.state = initialState();
    this.state.muted = muted;
    this.cues.clear();
  }

  // ---- Transitions ---------------------------------------------------------

  /**
   * Enter `screen` with every menu index at `0`: the highlight, the almanac's
   * tab, and its first visible row, which stand at `0` on every other screen.
   */
  private enter(screen: Screen): void {
    this.state.screen = screen;
    this.state.menuIndex = 0;
    this.state.almanacTab = 0;
    this.state.almanacScroll = 0;
  }

  /**
   * Set `screen` and nothing else, as the surface's `setScreen` poses it: the
   * run, the loadout, the overlays' fields, and the switches all stand, and a
   * pose that leaves `playing` discards the accumulator.
   */
  poseScreen(screen: Screen): void {
    const leaving = this.state.screen === "playing" && screen !== "playing";
    this.enter(screen);
    if (leaving) this.state.accumulator = 0;
  }

  /** Begin a fresh run and enter `playing`. */
  startRun(): void {
    this.state.run = freshRun();
    this.enter("playing");
    this.state.accumulator = 0;
  }

  /**
   * Discard the run and return to `title` with `selected` highlighted:
   * "Arriving here selects the entry the arriving transition led away from"
   * (specs/ui.md). `LIGHT THE LAMP` is the default, the entry every transition
   * but the two menu screens' `back` leads away from.
   */
  toTitle(selected: number = TITLE_LIGHT_THE_LAMP): void {
    this.state.run = idleRun();
    this.enter("title");
    this.state.menuIndex = selected;
    this.state.accumulator = 0;
  }

  /** Discard the run and enter `howto`. */
  toHowto(): void {
    this.state.run = idleRun();
    this.enter("howto");
    this.state.accumulator = 0;
  }

  /** Discard the run and open the almanac at its first tab and entry. */
  toAlmanac(): void {
    this.state.run = idleRun();
    this.enter("almanac");
    this.state.accumulator = 0;
  }

  /** From `playing`, hold the world under `paused`. */
  pause(): void {
    if (this.state.screen !== "playing") return;
    this.enter("paused");
    this.state.accumulator = 0;
  }

  /** From `paused`, return to `playing`; the run is untouched. */
  resume(): void {
    if (this.state.screen !== "paused") return;
    this.enter("playing");
  }

  /** From `chest`, close the overlay. */
  closeChest(): void {
    if (this.state.screen !== "chest") return;
    this.state.run.chestResult = null;
    this.enter("playing");
  }

  /** From a run screen, end the run as `ending` does, the run kept. */
  endRun(ending: "fallen" | "dawn"): void {
    this.enter(ending);
    this.state.accumulator = 0;
    this.cues.add(ending === "fallen" ? CUES.fallen : CUES.dawn);
  }

  /** From `playing` with a level-up queued, open the overlay. */
  openLevelUp(): boolean {
    if (this.state.screen !== "playing") return false;
    if (this.state.run.pendingLevelUps < 1) return false;
    openLevelUp(this.state, this.rng, this.cues);
    this.state.accumulator = 0;
    return true;
  }

  /** On `levelup`, accept the offer at `index`. */
  choose(index: number): boolean {
    if (this.state.screen !== "levelup") return false;
    if (!Number.isInteger(index)) return false;
    if (index < 0 || index >= this.state.run.offers.length) return false;
    acceptOffer(this.context(), index);
    return true;
  }

  private context(): TickContext {
    return makeTickContext(this.state, this.rng, this.held, this.cues);
  }

  // ---- Menus ---------------------------------------------------------------

  /** How many items the current screen's menu holds. */
  menuLength(): number {
    switch (this.state.screen) {
      case "title":
        return TITLE_ITEMS.length;
      case "almanac":
        return almanacEntries(this.state.almanacTab).length;
      case "levelup":
        return this.state.run.offers.length;
      case "paused":
        return PAUSE_ITEMS.length;
      case "fallen":
      case "dawn":
        return END_ITEMS.length;
      default:
        return 0;
    }
  }

  /**
   * Put the highlight on `index` and sound `menu-move`. On `almanac` the
   * list's window follows the highlight, as `specs/ui.md` states.
   */
  private setHighlight(index: number): void {
    const { state } = this;
    state.menuIndex = index;
    if (state.screen === "almanac") {
      state.almanacScroll = followHighlight(
        state.almanacScroll,
        index,
        almanacEntries(state.almanacTab).length,
      );
    }
    this.cues.add(CUES.menuMove);
  }

  private moveHighlight(delta: number): void {
    const length = this.menuLength();
    if (length === 0) return;
    this.setHighlight((this.state.menuIndex + delta + length) % length);
  }

  /** Show the tab at `index`, from its first entry, as `right` reaching it does. */
  private selectTab(index: number): void {
    const { state } = this;
    if (state.almanacTab === index) return;
    state.almanacTab = index;
    state.menuIndex = 0;
    state.almanacScroll = 0;
    this.cues.add(CUES.menuMove);
  }

  private moveTab(delta: number): void {
    this.selectTab(wrapTab(this.state.almanacTab, delta));
  }

  /** Answer one press edge on the current screen. */
  handleAction(action: Action): void {
    const { state } = this;
    if (!SCREEN_ACTIONS[state.screen].includes(action)) return;
    if (action === "mute") {
      this.hooks.toggleMute();
      return;
    }
    switch (state.screen) {
      case "title":
        if (action === "up") this.moveHighlight(-1);
        else if (action === "down") this.moveHighlight(1);
        else if (action === "confirm") {
          this.cues.add(CUES.menuConfirm);
          if (state.menuIndex === 0) this.startRun();
          else if (state.menuIndex === 1) this.toAlmanac();
          else this.toHowto();
        }
        break;
      case "howto":
        if (action === "back") this.toTitle(TITLE_HOW_TO_PLAY);
        break;
      case "almanac":
        if (action === "up") this.moveHighlight(-1);
        else if (action === "down") this.moveHighlight(1);
        else if (action === "left") this.moveTab(-1);
        else if (action === "right") this.moveTab(1);
        else if (action === "back") this.toTitle(TITLE_THE_ALMANAC);
        break;
      case "playing":
        if (action === "pause" || action === "back") this.pause();
        break;
      case "levelup":
        if (action === "up") this.moveHighlight(-1);
        else if (action === "down") this.moveHighlight(1);
        else if (action === "confirm") this.choose(state.menuIndex);
        break;
      case "chest":
        if (action === "confirm") this.closeChest();
        break;
      case "paused":
        if (action === "up") this.moveHighlight(-1);
        else if (action === "down") this.moveHighlight(1);
        else if (action === "confirm") {
          this.cues.add(CUES.menuConfirm);
          if (state.menuIndex === 0) this.resume();
          else this.toTitle();
        } else if (action === "pause" || action === "back") this.resume();
        break;
      case "fallen":
      case "dawn":
        if (action === "up") this.moveHighlight(-1);
        else if (action === "down") this.moveHighlight(1);
        else if (action === "confirm") {
          this.cues.add(CUES.menuConfirm);
          if (state.menuIndex === 0) this.startRun();
          else this.toTitle();
        } else if (action === "back") this.toTitle();
        break;
    }
  }

  // ---- The pointer ---------------------------------------------------------

  /**
   * Answer the pointer as this frame read it, after the frame's press edges:
   * the hover moves the highlight, a primary press takes what it lands in,
   * and the wheel scrolls the almanac's list.
   */
  handlePointer(pointer: PointerFrame): void {
    if (pointer.at !== null) this.hover(pointer.at.x, pointer.at.y);
    for (const press of pointer.presses) this.press(press.x, press.y);
    for (const lift of pointer.releases) this.release(lift.x, lift.y);
    this.scroll(pointer.wheel);
  }

  /** The `menuIndex` the box at `position` belongs to on the current screen. */
  private indexOfPosition(position: number): number {
    const { state } = this;
    return state.screen === "almanac"
      ? state.almanacScroll + position
      : position;
  }

  /** The pointer inside an item's box highlights it; inside none, nothing. */
  private hover(x: number, y: number): void {
    const { state } = this;
    const position = menuRects(state).findIndex((rect) => contains(rect, x, y));
    if (position < 0) return;
    const index = this.indexOfPosition(position);
    if (index === this.state.menuIndex) return;
    this.setHighlight(index);
  }

  /** A primary press highlights what it lands in and arms it. */
  private press(x: number, y: number): void {
    const { state } = this;
    this.armed = null;
    const screen = state.screen;
    const tabs = tabRects(state);
    const tab = tabs.findIndex((rect) => contains(rect, x, y));
    if (tab >= 0) {
      this.armed = { screen, rect: tabs[tab]!, kind: "tab", index: tab };
      return;
    }
    // The box is found before the highlight moves, because moving it on the
    // almanac can move the window under the very box the press landed in.
    const rects = menuRects(state);
    const position = rects.findIndex((rect) => contains(rect, x, y));
    if (position < 0) return;
    const index = this.indexOfPosition(position);
    const rect = rects[position]!;
    if (index !== state.menuIndex) this.setHighlight(index);
    this.armed = { screen, rect, kind: "item", index };
  }

  /**
   * A primary release inside the box its press armed takes what it armed;
   * anywhere else it disarms and takes nothing.
   */
  private release(x: number, y: number): void {
    const armed = this.armed;
    this.armed = null;
    if (armed === null) return;
    if (armed.screen !== this.state.screen) return;
    if (!contains(armed.rect, x, y)) return;
    if (armed.kind === "tab") {
      this.selectTab(armed.index);
      return;
    }
    this.take();
  }

  /**
   * Take the armed item: exactly what `confirm` on it does, which on an
   * almanac entry, the one menu that answers no `confirm`, is nothing, and on
   * `howto`, which answers no `confirm` either, is exactly what `back` does.
   */
  private take(): void {
    this.handleAction(this.state.screen === "howto" ? "back" : "confirm");
  }

  /** A frame's wheel travel, in stage units, moves the almanac's window. */
  private scroll(travel: number): void {
    const { state } = this;
    if (state.screen !== "almanac") return;
    const rows = Math.trunc(travel / WHEEL_ROW);
    if (rows === 0) return;
    state.almanacScroll = clampScroll(
      state.almanacScroll + rows,
      almanacEntries(state.almanacTab).length,
    );
  }

  // ---- The clock -----------------------------------------------------------

  /**
   * One whole tick, on `playing` alone, with the frame's held movement. A
   * tick that leaves `playing` discards the accumulator.
   */
  tickOnce(): void {
    if (this.state.screen !== "playing") return;
    tick(this.state, this.rng, this.held, this.cues);
    if (this.state.screen !== "playing") this.state.accumulator = 0;
  }

  /**
   * Feed `dt` seconds of frame time to the accumulator and consume every
   * whole tick in it. The remainder waits, and is discarded by a tick that
   * leaves `playing`. Off `playing` nothing accumulates.
   */
  update(dt: number): void {
    const { state } = this;
    if (state.screen !== "playing") {
      state.accumulator = 0;
      return;
    }
    state.accumulator += dt;
    while (state.accumulator >= TICK_DT - TICK_EPSILON) {
      state.accumulator -= TICK_DT;
      this.tickOnce();
      if (state.screen !== "playing") {
        state.accumulator = 0;
        return;
      }
    }
    if (state.accumulator < 0) state.accumulator = 0;
  }
}
