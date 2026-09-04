// Cascade — the debug surface as the CASE specifies it. CASE-PROVIDED.
//
// specs/instrumentation.md fixes the surface the game instance's `initialize`
// returns, and this module is that specification written down as types: the
// operations, their arguments, the snapshot shape, and the version. It is the
// ONLY description of the surface the validators read. The build implements the
// surface under whatever module it likes and declares and exports its own type
// for it — the `CascadeDebugApi` of its `GameDefinition<CascadeDebugApi>`;
// nothing here imports it, and the harness reaches the object itself through
// `engine.debug` alone. So a build whose surface departs from the specification
// is held against the specification, not against its own idea of what it wrote.
//
// HOW THE SURFACE IS DRIVEN. Each operation acts on the running game at the
// moment of the call, through the same systems play uses. A POSE takes only the
// arguments its heading names, returns nothing, and arranges the live table
// (`addCard("tableau", 3, "hearts", 7, true)`, `setLaunchClock(0.1)`). A
// READING takes no arguments and returns plain data built at the call
// (`snapshot()`). Four operations are the game's OWN EVENTS rather than poses —
// `deal`, `turnStock`, `move` and `autoMove` — each routing through exactly the
// code a player's gesture routes through, and the last two return the verdict
// the game's own rules reached. A caller therefore drives every one of them
// directly — `engine.debug.addCard(...)`, `engine.debug.snapshot()` — with no
// wrapper in between. `version` is a plain number.
//
// The clock, the audio bus and the overlay belong to the engine under this
// engine, so the surface carries no operation for any of them: `setAutoStep`
// and `advance` exist under the engineless build alone, and demanding either
// here would fail a perfectly conformant build. There is no `setMuted` under
// any engine — `muted` is the runtime's bit, reached the way a player reaches
// it, through the HUD's `SOUND` control, and reported by the snapshot.

/**
 * One menu item's hit region, as `menuItemRect` reports it.
 *
 * `x` and `y` are the region's top-left corner and `w` and `h` its size, all in
 * logical stage units (specs/instrumentation.md). WHERE a build puts its items is
 * the build's own — specs/controls.md: "Each control occupies a rectangular hit
 * region the build lays out" — so a check drives the pointer at what this reports
 * and never at a rectangle of its own.
 */
export interface MenuRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The four screens the game moves between. */
export type Screen = "title" | "howto" | "playing" | "won";

/** The four suits, as the surface names them. */
export type Suit = "spades" | "hearts" | "diamonds" | "clubs";

/** The two colours a suit reads as. */
export type CardColor = "red" | "black";

/** The four kinds of pile a card operation addresses. */
export type PileKind = "stock" | "waste" | "foundation" | "tableau";

/** The three piles a run can be lifted FROM. */
export type SourcePile = "waste" | "foundation" | "tableau";

/** The two piles a run can be released ONTO. */
export type TargetPile = "foundation" | "tableau";

/**
 * One card, as every pile reports it.
 *
 * `color` is built at the call from the suit rather than held as a field
 * (specs/instrumentation.md, Snapshot shape).
 */
export interface SnapshotCard {
  id: number;
  suit: Suit;
  rank: number;
  color: CardColor;
  faceUp: boolean;
}

/**
 * The run currently in hand. `cards[0]` is the grabbed card — the one drawn at
 * the top of the run and the one a drop is resolved by — and `x`/`y` are its
 * top-left in logical stage units.
 */
export interface SnapshotDrag {
  cards: SnapshotCard[];
  fromPile: SourcePile;
  fromIndex: number;
  x: number;
  y: number;
}

/** The pile a release would land the held run on. */
export interface SnapshotDropTarget {
  pile: TargetPile;
  index: number;
}

/** Where the pointer is, and whether it is held. */
export interface SnapshotPointer {
  x: number;
  y: number;
  down: boolean;
}

/** The most recent press, which the double-click rule is measured against. */
export interface SnapshotPress {
  x: number;
  y: number;
  /** The `simTime` the press arrived at, in seconds. */
  at: number;
}

/** One card in flight: its top-left, and the velocity carrying it. */
export interface SnapshotFlyer {
  id: number;
  suit: Suit;
  rank: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * The plain, JSON-serializable view `snapshot()` returns.
 *
 * Every field an operation can set is present, so every operation is verifiable
 * by setting a value and reading it back. Five entries are built at the call
 * rather than read off a field of their own: `dealMode`, `turnCount` and
 * `dealModeLabel` are this build's deal-mode figures, a card's `color` is its
 * suit's, and `wasteVisibleCount` is the newest entry of `wasteSets` — `0` when
 * the memory is empty, whatever cards the waste still holds.
 */
export interface CascadeSnapshot {
  version: number;
  screen: Screen;
  /** The selected item on the menu the current screen shows. */
  menuIndex: number;
  /** The title menu's remembered selection: the entry last activated there. */
  titleIndex: number;
  /** This build's `DEAL_MODE`. */
  dealMode: string;
  /** This build's `TURN_COUNT`: how many cards one turn of the stock moves. */
  turnCount: number;
  /** This build's `DEAL_MODE_LABEL`, the text the title screen and HUD draw. */
  dealModeLabel: string;
  /** The game's copy of the runtime's mute bit, refreshed in every update. */
  muted: boolean;

  autoFlip: boolean;
  winDetect: boolean;
  launching: boolean;
  trailPainting: boolean;

  /** Bottom to top, so the last entry is the card on top. */
  stock: SnapshotCard[];
  /** Bottom to top, so the last entry is the waste's top card. */
  waste: SnapshotCard[];
  /** The cards on each turned set, oldest first. */
  wasteSets: number[];
  /** The cards on the set the waste is showing. */
  wasteVisibleCount: number;
  /** The four foundations, each bottom to top. */
  foundations: SnapshotCard[][];
  /** The seven columns, each bottom to top, so the last entry is the lowest drawn. */
  tableau: SnapshotCard[][];

  drag: SnapshotDrag | null;
  dropTarget: SnapshotDropTarget | null;

  pointer: SnapshotPointer;
  lastPress: SnapshotPress | null;

  /** Seconds accumulated toward the next launch. */
  launchClock: number;
  /** Cards the cascade has launched, `0` to `52`. */
  launched: number;
  flyers: SnapshotFlyer[];
  /** The cascade's own end flag: every card launched and none in flight. */
  cascadeDone: boolean;
  /** Stamps on the painted layer since it was last cleared. */
  trailStamps: number;

  /** Accumulated game time, in seconds, on every screen. */
  simTime: number;
}

/**
 * The surface the game instance's `initialize` returns, which the engine hands
 * back from `engine.debug`.
 *
 * Each pose acts on the live game at the moment of the call and returns
 * nothing; `snapshot` is a reading of that same running game, built at the
 * call. No frame has to be advanced between a pose and the reading that checks
 * it, and the three pointer operations resolve their event before the call
 * returns, so a whole gesture is driveable without advancing the game at all.
 *
 * Every `x` and `y` the surface takes or reports is a card's TOP-LEFT in the
 * stage's logical units, matching the anchors specs/table.md fixes.
 */
export interface CascadeDebugApi {
  version: number;

  reset(options?: { seed?: number }): void;
  snapshot(): CascadeSnapshot;
  /**
   * The hit region of item `index` on the menu the current screen shows, or
   * `null` on `won` and for an index naming no item of that menu.
   *
   * A reading like `snapshot`: it changes nothing, and it is the build's answer
   * to a question specs/controls.md leaves to the build.
   */
  menuItemRect(index: number): MenuRect | null;

  setScreen(screen: Screen): void;
  /** Sets the selected item on the menu the current screen shows. */
  setMenuIndex(index: number): void;
  /** Sets the title entry a return to the title restores. */
  setTitleIndex(index: number): void;

  addCard(
    pile: PileKind,
    index: number,
    suit: Suit,
    rank: number,
    faceUp: boolean,
  ): void;
  removeCard(id: number): void;
  setCardFaceUp(id: number, faceUp: boolean): void;
  clearPile(pile: PileKind, index: number): void;
  clearTable(): void;

  addWasteSet(count: number): void;
  clearWasteSets(): void;

  deal(): void;
  turnStock(): void;
  /** `true` when the game's own rules accepted the move. */
  move(
    fromPile: PileKind,
    fromIndex: number,
    fromRow: number,
    toPile: PileKind,
    toIndex: number,
  ): boolean;
  /** `true` when the named pile's playable card went home. */
  autoMove(pile: PileKind, index: number): boolean;

  pointerDown(x: number, y: number): void;
  pointerMove(x: number, y: number): void;
  pointerUp(x: number, y: number): void;

  setAutoFlip(enabled: boolean): void;
  setWinDetect(enabled: boolean): void;
  setLaunching(enabled: boolean): void;
  setTrailPainting(enabled: boolean): void;

  addFlyer(
    suit: Suit,
    rank: number,
    x: number,
    y: number,
    vx: number,
    vy: number,
  ): void;
  setFlyerPosition(id: number, x: number, y: number): void;
  setFlyerVelocity(id: number, vx: number, vy: number): void;
  removeFlyer(id: number): void;
  clearFlyers(): void;
  setLaunchClock(seconds: number): void;
  clearTrail(): void;
}

/**
 * The operations that READ the running game rather than pose it.
 *
 * The surface's shape alone cannot say at runtime which members return a value
 * and which arrange the world, so the specification names them: a check that
 * sweeps the surface (instrumentation/surface-present) calls a reading for its
 * value and a pose for its effect.
 */
export const READINGS = ["snapshot"] as const;

/**
 * The two operations that BOTH act on the live game and return a verdict.
 *
 * Each is one of the game's own events, so calling it changes the table; a
 * sweep that wants to touch every member without disturbing a posed board
 * leaves these — and the other two events, `deal` and `turnStock` — for the
 * checks whose requirement they are.
 */
export const VERDICT_OPS = ["move", "autoMove"] as const;

/**
 * Every operation the surface must carry under this engine. `setAutoStep` and
 * `advance` belong to the engineless build alone (specs/instrumentation.md):
 * the engine owns the clock here, so they are deliberately absent.
 */
export const REQUIRED_OPS = [
  "reset",
  "snapshot",
  "menuItemRect",

  "setScreen",
  "setMenuIndex",
  "setTitleIndex",

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

/** Every field the documented snapshot shape carries, in the order it lists them. */
export const SNAPSHOT_FIELDS = [
  "version",
  "screen",
  "menuIndex",
  "titleIndex",
  "dealMode",
  "turnCount",
  "dealModeLabel",
  "muted",
  "autoFlip",
  "winDetect",
  "launching",
  "trailPainting",
  "stock",
  "waste",
  "wasteSets",
  "wasteVisibleCount",
  "foundations",
  "tableau",
  "drag",
  "dropTarget",
  "pointer",
  "lastPress",
  "launchClock",
  "launched",
  "flyers",
  "cascadeDone",
  "trailStamps",
  "simTime",
] as const;
