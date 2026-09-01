// Cascade — the debug surface as the CASE specifies it. CASE-PROVIDED.
//
// specs/instrumentation.md fixes the surface a build's `initialize` returns beside
// its state, as `[state, debug]`, and this module is that specification written
// down as types: the operations, their arguments, the snapshot shape, and the
// version. It is the ONLY description of the surface the validators read. The
// build implements the surface under whatever module it likes and declares its own
// type for it, `CascadeDebugApi`, exported from `src/game.ts`, and nothing here
// imports that type; the harness reaches the object itself through `engine.debug`
// alone. So a build whose surface departs from the specification is held against
// the specification, not against its own idea of what it wrote.
//
// HOW THE SURFACE IS DRIVEN. The engine holds the state by value and hands it out
// read-only, so the surface holds no state of its own and nothing on it mutates
// anything. Every operation is written in the shape of the game's `update`: a POSE
// takes the current state and returns the next one (`setScreen(state, "playing")`,
// `addCard(state, "tableau", 0, "spades", 13, true)`), and a READING takes the
// current state and returns what it read (`snapshot(state)`). A caller drives a
// pose through `engine.apply((s) => debug.setScreen(s, "playing"))`, and a reading
// through `debug.snapshot(engine.state)`. `version` is a plain number.
//
// TWO OPERATIONS ARE NEITHER. `move` and `autoMove` apply the game's own rules and
// then report what those rules decided, so each returns the pair
// `[nextState, verdict]` rather than a state alone. A driver has to split that pair
// INSIDE the transition it hands `engine.apply`, because the engine stores whatever
// the transition returns and a stored tuple would corrupt every frame after it.
// {@link VERDICTS} is the table that names them, and `harness.ts` is where the
// split happens.
//
// The surface is generic over the build's state type, because this module imports
// nothing of the build: `harness.ts` binds it to the `CascadeState` the build
// declared, and the `Driver` there is what gives the checks the imperative reading
// (`h.debug.setScreen("playing")`, `h.debug.snapshot()`) over the pure shape
// declared here.
//
// THERE IS NO CLOCK OPERATION AND NO `setMuted`. Under an engine the clock is the
// engine's: a check steps exact frames with `engine.advance` over the harness's
// `ConstantClock`, and `setAutoStep` and `advance` belong to the engineless build
// alone. Mute is the engine's audio bus, which a pure `(state, ...) => state`
// transform could not reach, so it is driven through the HUD's `SOUND` control and
// `snapshot().muted` reports the result (specs/instrumentation.md).
//
// Cascade's two variants differ in the deal mode alone, not in the surface, so
// every member below is required under both and nothing here is optional.

import type { DeepReadonly } from "ts-essentials";

/** The surface's version, reported as `version` (`CASCADE_DEBUG_VERSION`). */
export const CASCADE_DEBUG_VERSION = 1;

/** The seed `reset()` restores when the caller names none (`DEFAULT_SEED`). */
export const DEFAULT_SEED = 1;

/** The four screens the game moves between. */
export type Screen = "title" | "howto" | "playing" | "won";

/** The four suits of the deck. */
export type Suit = "spades" | "hearts" | "diamonds" | "clubs";

/** The two colors a suit is drawn in. */
export type CardColor = "red" | "black";

/** The four kinds of pile a card operation names. */
export type PileKind = "stock" | "waste" | "foundation" | "tableau";

/** The piles a run can be lifted from. */
export type SourcePile = "waste" | "foundation" | "tableau";

/** The piles a run can be dropped onto. */
export type TargetPile = "foundation" | "tableau";

/** One card, as the snapshot reports it. */
export interface CardSnapshot {
  id: number;
  suit: Suit;
  /** `1` for the Ace through `13` for the King. */
  rank: number;
  color: CardColor;
  faceUp: boolean;
}

/** One card in flight during the victory cascade. Its `x`/`y` are its top-left. */
export interface FlyerSnapshot {
  id: number;
  suit: Suit;
  rank: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** The run currently in hand. `cards[0]` is the grabbed card. */
export interface DragSnapshot {
  cards: CardSnapshot[];
  fromPile: SourcePile;
  fromIndex: number;
  /** The top-left of `cards[0]`. */
  x: number;
  y: number;
}

/** The pile a release would land the held run on. */
export interface DropTargetSnapshot {
  pile: TargetPile;
  index: number;
}

/** The pointer's position in logical units, and whether it is held. */
export interface PointerSnapshot {
  x: number;
  y: number;
  down: boolean;
}

/** The most recent press, which the double-click rule is measured against. */
export interface PressSnapshot {
  x: number;
  y: number;
  /** The `simTime` of the press. */
  at: number;
}

/**
 * The plain, JSON-serializable view `snapshot` returns.
 *
 * Every field an operation can set is present, so every operation is verifiable
 * by setting a value and reading it back. Five entries are built at the call
 * rather than read off a field of their own: `dealMode`, `turnCount` and
 * `dealModeLabel` from the deal-mode figures specs/stock.md fixes, a card's
 * `color` from its suit, and `wasteVisibleCount` from the newest entry of
 * `wasteSets`.
 */
export interface CascadeSnapshot {
  version: number;
  screen: Screen;
  /** This build's `DEAL_MODE`. */
  dealMode: string;
  /** This build's `TURN_COUNT`: how many cards one turn of the stock moves. */
  turnCount: number;
  /** This build's `DEAL_MODE_LABEL`, the text it draws for its deal mode. */
  dealModeLabel: string;
  /** The game's copy of the runtime's mute bit, refreshed in every update. */
  muted: boolean;

  autoFlip: boolean;
  winDetect: boolean;
  launching: boolean;
  trailPainting: boolean;

  /** Bottom to top, so the last entry is the pile's top card. */
  stock: CardSnapshot[];
  waste: CardSnapshot[];
  /** Cards on each turned set, oldest first. */
  wasteSets: number[];
  /** Cards on the set the waste is showing, and `0` when the memory is empty. */
  wasteVisibleCount: number;
  foundations: CardSnapshot[][];
  tableau: CardSnapshot[][];

  drag: DragSnapshot | null;
  dropTarget: DropTargetSnapshot | null;

  pointer: PointerSnapshot;
  lastPress: PressSnapshot | null;

  /** Seconds accumulated toward the next launch. */
  launchClock: number;
  /** Cards the cascade has launched, `0` to `52`. Counted up, never derived. */
  launched: number;
  flyers: FlyerSnapshot[];
  /** The cascade's own end flag. */
  cascadeDone: boolean;
  /** Stamps the painted layer has taken since it was last cleared. */
  trailStamps: number;

  /** Accumulated game time, in seconds, on every screen. */
  simTime: number;
}

/**
 * The surface a build returns beside its state from `initialize`, over the
 * build's own state type `S`.
 *
 * Each pose is a transition, the current state in and the next state out, and
 * `snapshot` is a reading of the current state. None of them touches the state it
 * was handed: `DeepReadonly<S>` is the view the engine hands out, and the compiler
 * is what says a pose returns a new value rather than mutating.
 *
 * Every operation sets one field, reads the state, adds or removes ONE entity, or
 * is one of the game's own events. There is no operation that takes a layout and
 * none that arranges several things at once: `openTable`, `poseColumn` and
 * `poseWaste` are helpers in `harness.ts` built out of these, not operations a
 * build implements.
 *
 * Every `x` and `y` the surface takes or reports is a card's TOP-LEFT in the
 * stage's logical units, matching the anchors specs/table.md fixes.
 */
export interface CascadeDebugApi<S = unknown> {
  version: number;

  // ---- The core ----------------------------------------------------------

  /** Restores every declared field to its title-screen value. */
  reset(state: DeepReadonly<S>, options?: { seed?: number }): S;
  /** A pure read of the state. It changes nothing. */
  snapshot(state: DeepReadonly<S>): CascadeSnapshot;

  // ---- The screen --------------------------------------------------------

  /** Sets the current screen, leaving the table exactly as it stands. */
  setScreen(state: DeepReadonly<S>, screen: Screen): S;

  // ---- The cards ---------------------------------------------------------

  /** Appends one card to the top of the named pile, with a fresh id. */
  addCard(
    state: DeepReadonly<S>,
    pile: PileKind,
    index: number,
    suit: Suit,
    rank: number,
    faceUp: boolean,
  ): S;
  /** Removes that card from whichever pile holds it, in the way play does. */
  removeCard(state: DeepReadonly<S>, id: number): S;
  setCardFaceUp(state: DeepReadonly<S>, id: number, faceUp: boolean): S;
  /** Empties the named pile, and the waste's set memory with the waste. */
  clearPile(state: DeepReadonly<S>, pile: PileKind, index: number): S;
  /** Empties all thirteen piles and the waste's set memory. */
  clearTable(state: DeepReadonly<S>): S;

  // ---- The waste's sets --------------------------------------------------

  /** Appends one set of `count` cards to the newest end of the set memory. */
  addWasteSet(state: DeepReadonly<S>, count: number): S;
  /** Empties the set memory, leaving the cards on the waste standing. */
  clearWasteSets(state: DeepReadonly<S>): S;

  // ---- The game's own events ---------------------------------------------

  /** Deals a fresh game from the seeded generator, as specs/deal.md states. */
  deal(state: DeepReadonly<S>): S;
  /** Turns the stock, or recycles the waste, as specs/stock.md states. */
  turnStock(state: DeepReadonly<S>): S;
  /** Attempts a move, and reports whether the game's own rules accepted it. */
  move(
    state: DeepReadonly<S>,
    fromPile: PileKind,
    fromIndex: number,
    /** The grabbed card's index within its pile, counted from the bottom. */
    fromRow: number,
    toPile: PileKind,
    toIndex: number,
  ): [S, boolean];
  /** Sends the named pile's playable card home, and reports whether it went. */
  autoMove(state: DeepReadonly<S>, pile: PileKind, index: number): [S, boolean];

  // ---- The pointer -------------------------------------------------------

  /** Reports a press at a logical stage point, resolved before it returns. */
  pointerDown(state: DeepReadonly<S>, x: number, y: number): S;
  pointerMove(state: DeepReadonly<S>, x: number, y: number): S;
  pointerUp(state: DeepReadonly<S>, x: number, y: number): S;

  // ---- The faculty gates -------------------------------------------------

  /** Gates the turning face-up of a column's newly exposed lowest card. */
  setAutoFlip(state: DeepReadonly<S>, enabled: boolean): S;
  /** Gates the check that all fifty-two cards are home, and the win with it. */
  setWinDetect(state: DeepReadonly<S>, enabled: boolean): S;
  /** Gates the cascade's launch clock and the launching of the next card. */
  setLaunching(state: DeepReadonly<S>, enabled: boolean): S;
  /** Gates the stamping of a card in flight onto the painted layer. */
  setTrailPainting(state: DeepReadonly<S>, enabled: boolean): S;

  // ---- The cascade -------------------------------------------------------

  /** Adds one card in flight at a top-left, with a velocity and a fresh id. */
  addFlyer(
    state: DeepReadonly<S>,
    suit: Suit,
    rank: number,
    x: number,
    y: number,
    vx: number,
    vy: number,
  ): S;
  setFlyerPosition(state: DeepReadonly<S>, id: number, x: number, y: number): S;
  setFlyerVelocity(
    state: DeepReadonly<S>,
    id: number,
    vx: number,
    vy: number,
  ): S;
  removeFlyer(state: DeepReadonly<S>, id: number): S;
  clearFlyers(state: DeepReadonly<S>): S;
  setLaunchClock(state: DeepReadonly<S>, seconds: number): S;
  /** Clears the painted layer and `trailStamps`, leaving the flyers standing. */
  clearTrail(state: DeepReadonly<S>): S;
}

/**
 * The operations that READ the state rather than replace it.
 *
 * A driver over the surface needs to know which members to call with the current
 * state and hand back, and which to run through `engine.apply`; the surface's
 * shape alone cannot say at runtime, so the specification names them.
 */
export const READINGS = ["snapshot"] as const;

/**
 * The operations that both pose and report, returning `[nextState, verdict]`.
 *
 * The pair is split inside the transition the driver hands `engine.apply`: the
 * state half is what the engine stores, and the verdict half is what the call
 * hands back. Handing the pair itself to `apply` would store the tuple as the
 * state and corrupt every frame after it.
 */
export const VERDICTS = ["move", "autoMove"] as const;

/**
 * Every operation the surface must carry, in the order
 * specs/instrumentation.md lists them.
 *
 * `instrumentation/surface-present` reads this table: a build missing any one of
 * these is missing a deliverable the case requires, and the point names it.
 */
export const REQUIRED_OPS = [
  "reset",
  "snapshot",

  "setScreen",

  "addCard",
  "removeCard",
  "setCardFaceUp",
  "clearPile",
  "clearTable",

  "addWasteSet",
  "clearWasteSets",

  "deal",
  "turnStock",
  "move",
  "autoMove",

  "pointerDown",
  "pointerMove",
  "pointerUp",

  "setAutoFlip",
  "setWinDetect",
  "setLaunching",
  "setTrailPainting",

  "addFlyer",
  "setFlyerPosition",
  "setFlyerVelocity",
  "removeFlyer",
  "clearFlyers",
  "setLaunchClock",
  "clearTrail",
] as const;
