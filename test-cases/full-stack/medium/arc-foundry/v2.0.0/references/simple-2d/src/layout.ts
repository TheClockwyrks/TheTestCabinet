// Arc Foundry — where every control sits (specs/hud.md, specs/ui.md).
//
// One PURE function of the state, `controls`, returns every hit-testable region the game
// draws, in draw order. It is the single source for three readers that must agree
// exactly:
//
// - `src/render.ts` draws each control at the rectangle named here.
// - `src/game.ts` resolves a pointer press by hit-testing this list, topmost first.
// - `src/debug.ts` reports the panel, menu, and status controls from it, so what a
//   caller reads back is the region a press would actually activate
//   (specs/instrumentation.md).
//
// It is a function of the state and of nothing else — no canvas, no measured text — so
// a reading of the controls needs no frame to have been drawn first, and the rectangle
// reported is the rectangle drawn. The layout changes only when the player changes it:
// selecting a different structure, deselecting, or opening an overlay
// (specs/hud.md, "The action controls hold fixed slots").

import {
  BAR_H,
  BOARD_W,
  BOARD_X,
  COMBO_IDS,
  COMBO_MAX_LEVEL,
  DIFFICULTIES,
  MAPS,
  PANEL_ACTION_LABELS,
  PANEL_X,
  PANEL_W,
  STAGE_H,
  STAGE_W,
  type ComboId,
  type ComponentType,
  type MenuAction,
  type PanelAction,
  type StatusControl as StatusControlName,
  type StatusReadout as StatusReadoutName,
} from "./constants";
import { isMenuScreen, menuItems } from "./menus";
import {
  canCombine,
  canStamp,
  canUpgradeCombo,
  canUpgradeQuality,
  combineSet,
  comboUpgradeCostFor,
  reachableCombosFor,
  selected,
  statsOf,
  unbuffedStats,
} from "./sim";
import { COMBO_BY_ID, baseStats } from "./tables";
import { difficulty } from "./sim";
import { QUALITY_LABEL, TARGETING_LABEL, qualityIndex } from "./theme";
import type { FoundryView } from "./world";
import type { Component } from "./types";

/**
 * What a control is, which decides where it fires and which reading reports it.
 *
 * `menu` is navigation and fires on every screen. `bar`, `panel`, `press`, and
 * `overlay` are the yard's own and fire on `playing` alone, so a press aimed at the
 * pause menu can never reach the panel behind it. `noop` swallows a press so it does
 * not fall through an overlay onto the yard.
 */
export type ControlKind =
  "menu" | "bar" | "panel" | "press" | "overlay" | "noop";

/** One hit-testable region, as drawn. */
export interface Control {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: ControlKind;
  /** What activating it commits. */
  action: string;
  /** The text drawn on it, which the readings report. */
  label: string;
  /** Whether it currently ignores activation. */
  disabled: boolean;
  /** The combination tower a `combine-special` row would build. */
  payload?: string;
}

// ---- The build panel's fixed geometry ------------------------------------

/** The panel's content column. */
const PANEL_PAD = 14;
const PANEL_CONTENT_X = PANEL_X + PANEL_PAD;
const PANEL_CONTENT_W = PANEL_W - PANEL_PAD * 2;

/** The quality-odds block: a label, a stacked bar, and its legend. */
export const ODDS_Y = 74;
export const ODDS_BAR_Y = ODDS_Y + 14;
export const ODDS_BAR_H = 12;
export const ODDS_BOTTOM = ODDS_BAR_Y + ODDS_BAR_H + 18;

/** The refinement control. */
export const REFINE_Y = ODDS_BOTTOM + 8;
export const REFINE_H = 44;

/** The press control. */
export const STAMP_Y = REFINE_Y + REFINE_H + 10;
export const STAMP_H = 46;

/** Where the harvest prompt sits, and so where everything above it stops. */
export const PANEL_PROMPT_Y = STAGE_H - 34;

/** The inspector's frame, and the column inside it. */
export const INFO_Y = STAMP_Y + STAMP_H + 12;
export const INFO_H = PANEL_PROMPT_Y - 4 - INFO_Y;
export const INSPECT_X = PANEL_CONTENT_X + PANEL_PAD;
export const INSPECT_Y = INFO_Y + 12;
export const INSPECT_W = PANEL_CONTENT_W - PANEL_PAD * 2;

/** The action controls stack upward from here, with this gap between them. */
const ACTION_BOTTOM = PANEL_PROMPT_Y - 4 - 6;
const ACTION_GAP = 6;

/** The panel's column, for the renderer. */
export const PANEL_COL_X = PANEL_CONTENT_X;
export const PANEL_COL_W = PANEL_CONTENT_W;

// ---- The status bar's fixed geometry -------------------------------------

const BAR_Y = 12;
const BAR_CTRL_H = 32;

/** The maze-length readout, which is a hover target rather than a control. */
export const MAZE_READOUT = { x: 700, y: 8, w: 120, h: 40 };

/**
 * Each status-bar READOUT's slot, in the order the bar draws them left to right.
 *
 * `specs/hud.md` fixes what the bar shows and the order it shows it in and leaves each
 * rectangle to the build, so these are this build's choice, reported through
 * `statusReadouts` (specs/instrumentation.md). The rectangle is where the read is drawn,
 * which is what the maze-length hover of `specs/controls.md` acts on.
 *
 * `paused` and `overload` are the two conditional reads. They share the wave group's
 * tail slot and its finale slot respectively, and are reported only on the frames they
 * are drawn on.
 */
const BAR_READOUT_SLOTS: readonly {
  readout: StatusReadoutName;
  x: number;
  y: number;
  w: number;
  h: number;
}[] = [
  { readout: "charge", x: 20, y: 8, w: 140, h: 40 },
  { readout: "integrity", x: 170, y: 8, w: 190, h: 40 },
  { readout: "wave", x: 374, y: 8, w: 160, h: 40 },
  { readout: "maze-length", ...MAZE_READOUT },
  { readout: "paused", x: 466, y: 24, w: 64, h: 22 },
  { readout: "overload", x: 554, y: 8, w: 130, h: 40 },
];

/** Each status-bar control's slot, in the order the bar draws them. */
const BAR_SLOTS: readonly {
  action: StatusControlName;
  x: number;
  w: number;
}[] = [
  { action: "combos", x: 838, w: 80 },
  { action: "damage", x: 926, w: 80 },
  { action: "speed", x: 1112, w: 52 },
  { action: "pause", x: 1172, w: 40 },
  { action: "mute", x: 1220, w: 40 },
];

// ---- The overlays' fixed geometry ----------------------------------------

/** The recipe book's panel, inset inside the yard region. */
export const BOOK = {
  x0: BOARD_X + 18,
  y0: BAR_H + 14,
  x1: BOARD_X + BOARD_W - 18,
  y1: STAGE_H - 14,
};

/** The damage leaderboard's panel. */
export const BOARD_PANEL = {
  x: BOARD_X + 12,
  y: BAR_H + 12,
  w: 250,
  rowH: 26,
  headH: 30,
};

/** The first leaderboard row's top. */
export const BOARD_ROW0 = BOARD_PANEL.y + BOARD_PANEL.headH + 6;

/** The most rows the leaderboard shows. */
export const BOARD_ROWS = 8;

/** The leaderboard's ranking: every firing structure that has dealt damage. */
export function leaderboardTop(w: FoundryView): Component[] {
  const firing = w.structures.filter(
    (s): s is Component => s.kind === "component" && s.damageDealt > 0,
  );
  return [...firing]
    .sort((a, b) => b.damageDealt - a.damageDealt)
    .slice(0, BOARD_ROWS);
}

/** The structure whose leaderboard row the pointer is over, or `null`. */
export function leaderboardHoverId(w: FoundryView): number | null {
  if (!w.showDamage || w.screen !== "playing") return null;
  const top = leaderboardTop(w);
  for (let i = 0; i < top.length; i++) {
    const y = BOARD_ROW0 + i * BOARD_PANEL.rowH;
    if (
      inRect(
        w.pointerX,
        w.pointerY,
        BOARD_PANEL.x,
        y,
        BOARD_PANEL.w,
        BOARD_PANEL.rowH,
      )
    ) {
      return top[i]!.id;
    }
  }
  return null;
}

/** Whether a point falls inside a rectangle. */
export function inRect(
  px: number,
  py: number,
  x: number,
  y: number,
  w: number,
  h: number,
): boolean {
  return px >= x && px <= x + w && py >= y && py <= y + h;
}

// ---- The whole list ------------------------------------------------------

/** Every control the current state draws, in draw order: the last is on top. */
export function controls(w: FoundryView): Control[] {
  switch (w.screen) {
    case "title":
      return verticalMenu(w, 410, 62, 400, 52, 26);
    case "mapselect":
      return mapSelectControls(w);
    case "difficultyselect":
      return difficultySelectControls(w);
    case "howto":
      return [menu(w, 0, STAGE_W / 2 - 90, STAGE_H - 52, 180, 38)];
    default:
      return yardControls(w);
  }
}

/** The title menu: one full-width row per choice, centered. */
function verticalMenu(
  w: FoundryView,
  y0: number,
  gap: number,
  width: number,
  height: number,
  rise: number,
): Control[] {
  return menuItems(w.screen).map((_, i) =>
    menu(w, i, STAGE_W / 2 - width / 2, y0 + i * gap - rise, width, height),
  );
}

/** One menu choice's control, from the screen's own list. */
function menu(
  w: FoundryView,
  index: number,
  x: number,
  y: number,
  width: number,
  height: number,
): Control {
  const item = menuItems(w.screen)[index]!;
  return {
    x,
    y,
    w: width,
    h: height,
    kind: "menu",
    action: item.action,
    label: item.label,
    disabled: false,
  };
}

/** The map cards, in a row, and the entry that backs out. */
function mapSelectControls(w: FoundryView): Control[] {
  const cardW = 356;
  const gap = 28;
  const total = MAPS.length * cardW + (MAPS.length - 1) * gap;
  const x0 = (STAGE_W - total) / 2;
  const out = MAPS.map((_, i) =>
    menu(w, i, x0 + i * (cardW + gap), MAP_CARD_Y, cardW, MAP_CARD_H),
  );
  out.push(
    menu(
      w,
      MAPS.length,
      STAGE_W / 2 - 90,
      MAP_CARD_Y + MAP_CARD_H + 24,
      180,
      42,
    ),
  );
  return out;
}

export const MAP_CARD_Y = 150;
export const MAP_CARD_H = 402;
export const DIFF_CARD_Y = 170;
export const DIFF_CARD_H = 340;

/** The difficulty cards, in a row, and the entry that backs out. */
function difficultySelectControls(w: FoundryView): Control[] {
  const cardW = 320;
  const gap = 30;
  const n = DIFFICULTIES.length;
  const total = n * cardW + (n - 1) * gap;
  const x0 = (STAGE_W - total) / 2;
  const out = DIFFICULTIES.map((_, i) =>
    menu(w, i, x0 + i * (cardW + gap), DIFF_CARD_Y, cardW, DIFF_CARD_H),
  );
  out.push(
    menu(w, n, STAGE_W / 2 - 90, DIFF_CARD_Y + DIFF_CARD_H + 26, 180, 42),
  );
  return out;
}

/**
 * The yard's controls: the status bar, the panel, whichever overlay is open, and the
 * modal menu on top when the run is paused or over.
 *
 * The order is the drawing order, so a press resolved from the end of the list reaches
 * the topmost control first.
 */
function yardControls(w: FoundryView): Control[] {
  // The status bar and the build panel are drawn on `playing` and `paused` alone,
  // because those are the two screens the yard is shown on (specs/hud.md,
  // specs/ui.md). A result screen shows neither, so neither is hit-testable there.
  const yardShown = w.screen === "playing" || w.screen === "paused";
  const out: Control[] = yardShown
    ? [...barControls(w), ...panelControls(w)]
    : [];
  if (w.screen === "playing" && w.showCombos) out.push(...bookControls());
  if (w.screen === "playing" && w.showDamage) out.push(...damageControls(w));
  if (w.screen === "paused") {
    out.push(
      ...menuItems("paused").map((_, i) =>
        menu(w, i, STAGE_W / 2 - 130, 320 + i * 56, 260, 44),
      ),
    );
  }
  if (w.screen === "victory" || w.screen === "overload") {
    const xs = [STAGE_W / 2 - 170, STAGE_W / 2 + 10];
    out.push(
      ...menuItems(w.screen).map((_, i) => menu(w, i, xs[i]!, 452, 160, 46)),
    );
  }
  return out;
}

/** The status bar's five controls, each reading its own current value. */
function barControls(w: FoundryView): Control[] {
  return BAR_SLOTS.map((slot) => ({
    x: slot.x,
    y: BAR_Y,
    w: slot.w,
    h: BAR_CTRL_H,
    kind: "bar" as const,
    action: slot.action,
    label: barLabel(w, slot.action),
    disabled: false,
  }));
}

/** What each status-bar control draws. */
export function barLabel(w: FoundryView, action: StatusControlName): string {
  switch (action) {
    case "combos":
      return "COMBOS";
    case "damage":
      return "DMG BOARD";
    case "speed":
      return `${w.speed}×`;
    case "pause":
      return w.paused ? "▶" : "❚❚";
    case "mute":
      return w.muted ? "♪̸" : "♪";
  }
}

/** The value each status-bar control currently reads (specs/instrumentation.md). */
export function barState(
  w: FoundryView,
  action: StatusControlName,
): boolean | number {
  switch (action) {
    case "combos":
      return w.showCombos;
    case "damage":
      return w.showDamage;
    case "speed":
      return w.speed;
    case "pause":
      return w.paused;
    case "mute":
      return w.muted;
  }
}

/**
 * The panel's two standing controls, then the inspector's actions.
 *
 * The refinement control carries `refine`, which is the press's own act and not the
 * inspector's `upgrade`: activating it refines the press whatever is selected, and it
 * is disabled by the refinement track alone (specs/hud.md).
 */
function panelControls(w: FoundryView): Control[] {
  const out: Control[] = [
    {
      x: PANEL_CONTENT_X,
      y: REFINE_Y,
      w: PANEL_CONTENT_W,
      h: REFINE_H,
      kind: "press",
      action: "refine",
      label: "UPGRADE QUALITY",
      disabled: !canUpgradeQuality(w),
    },
    {
      x: PANEL_CONTENT_X,
      y: STAMP_Y,
      w: PANEL_CONTENT_W,
      h: STAMP_H,
      kind: "press",
      action: "stamp",
      label: "STAMP",
      disabled: !canStamp(w),
    },
  ];
  // With a rock on the cursor the inspector shows the held rock, and with nothing
  // selected the coming wave, so neither offers an action.
  if (!w.holding) out.push(...inspectorControls(w));
  return out;
}

/**
 * The inspector's action controls for the selected structure, in slot order.
 *
 * Every action the selected structure can EVER offer holds a slot for as long as that
 * structure stays selected, so a control that is unavailable right now is present and
 * disabled rather than missing, and nothing around it moves. Two are absent rather than
 * disabled, because the structure has no priority to cycle at all: a candidate, which
 * does not fire, and a Regulator, which never does (specs/hud.md).
 */
export function inspectorControls(w: FoundryView): Control[] {
  const sel = selected(w);
  if (!sel) return [];
  // On `paused` the pause menu takes the input and every control on the panel is
  // inert (specs/controls.md), so every slot is drawn disabled there whatever the
  // phase underneath it says.
  const live = w.screen === "playing";
  const inBuild = live && w.phase === "build";
  const out: Control[] = [];
  let y = ACTION_BOTTOM - 26;

  const slot = (
    action: PanelAction,
    label: string,
    enabled: boolean,
    h = 26,
    payload?: string,
  ): void => {
    out.push({
      x: INSPECT_X,
      y,
      w: INSPECT_W,
      h,
      kind: "panel",
      action,
      label,
      disabled: !enabled,
      payload,
    });
    y -= h + ACTION_GAP;
  };

  if (sel.kind === "blocker") {
    out.push({
      x: INSPECT_X,
      y: ACTION_BOTTOM - 30,
      w: INSPECT_W,
      h: 30,
      kind: "panel",
      action: "dismantle",
      label: "DISMANTLE ROCK",
      disabled: !inBuild,
    });
    return out;
  }

  const comp = sel.kind === "component" ? sel : null;
  const stats = comp ? statsOf(comp) : baseStats(sel.type, sel.quality);

  if (comp?.combo) {
    slot("dismantle", "DISMANTLE TOWER", inBuild, 24);
    if (stats.fires) {
      slot("targeting", `TARGET · ${TARGETING_LABEL[comp.targeting]}`, live);
    }
    const cost = comboUpgradeCostFor(comp);
    slot(
      "upgrade",
      cost === null
        ? `UPGRADE · ${COMBO_MAX_LEVEL}/${COMBO_MAX_LEVEL} MAX`
        : `UPGRADE  ${cost}`,
      cost !== null && canUpgradeCombo(w, comp.id),
      26,
    );
    return out;
  }

  const set = combineSet(w);
  const explicit = set.length >= 2 && set[0] === sel.id;
  slot("dismantle", PANEL_ACTION_LABELS.dismantle, inBuild);
  if (comp && stats.fires) {
    slot("targeting", `TARGET · ${TARGETING_LABEL[comp.targeting]}`, live);
  }
  if (sel.kind === "candidate") {
    const lower = QUALITY_LABEL[qualityIndex(Math.max(1, sel.quality - 1))]!;
    slot("downgrade", `DOWNGRADE ${lower}`, inBuild && sel.quality > 1);
    slot("keep", PANEL_ACTION_LABELS.keep, inBuild);
  }
  slot(
    "combine",
    explicit ? "COMBINE SELECTED" : PANEL_ACTION_LABELS.combine,
    live && canCombine(w, sel),
    26,
  );
  // One row per reachable recipe, each naming the tower it would build. They stack above
  // the fixed actions, so a recipe coming into reach never moves a control already drawn.
  for (const recipe of reachableCombosFor(w, sel.id)) {
    slot(
      "combine-special",
      COMBO_BY_ID[recipe.combo].name,
      live,
      30,
      recipe.combo,
    );
  }
  return out;
}

/** The recipe book: a backdrop that swallows presses, its body, and its close control. */
function bookControls(): Control[] {
  const close = 26;
  return [
    {
      x: BOARD_X,
      y: BAR_H,
      w: BOARD_W,
      h: STAGE_H - BAR_H,
      kind: "noop",
      action: "noop",
      label: "",
      disabled: false,
    },
    {
      x: BOOK.x0,
      y: BOOK.y0,
      w: BOOK.x1 - BOOK.x0,
      h: BOOK.y1 - BOOK.y0,
      kind: "noop",
      action: "noop",
      label: "",
      disabled: false,
    },
    {
      x: BOOK.x1 - close - 12,
      y: BOOK.y0 + 12,
      w: close,
      h: close,
      kind: "overlay",
      action: "combos",
      label: "✕",
      disabled: false,
    },
  ];
}

/** The damage leaderboard: its body, which swallows presses, and its close control. */
function damageControls(w: FoundryView): Control[] {
  const rows = Math.max(1, leaderboardTop(w).length);
  const h = BOARD_PANEL.headH + 8 + rows * BOARD_PANEL.rowH + 8;
  const close = 20;
  return [
    {
      x: BOARD_PANEL.x,
      y: BOARD_PANEL.y,
      w: BOARD_PANEL.w,
      h,
      kind: "noop",
      action: "noop",
      label: "",
      disabled: false,
    },
    {
      x: BOARD_PANEL.x + BOARD_PANEL.w - close - 8,
      y: BOARD_PANEL.y + 6,
      w: close,
      h: close,
      kind: "overlay",
      action: "damage",
      label: "✕",
      disabled: false,
    },
  ];
}

/** The menu choices of the screen showing, in the order they are presented. */
export function menuControls(w: FoundryView): Control[] {
  if (!isMenuScreen(w.screen)) return [];
  return controls(w).filter((c) => c.kind === "menu");
}

/** The inspector's action controls, in slot order. */
export function panelButtonControls(w: FoundryView): Control[] {
  return controls(w).filter((c) => c.kind === "panel");
}

/** The panel's own two controls, in the order the panel draws them. */
export function pressPanelControls(w: FoundryView): Control[] {
  return controls(w).filter((c) => c.kind === "press");
}

/** The status bar's controls, and none at all on a screen with no bar. */
export function statusBarControls(w: FoundryView): Control[] {
  return controls(w).filter((c) => c.kind === "bar");
}

/** One of the bar's reads, as `statusReadouts` reports it. */
export interface Readout {
  readout: StatusReadoutName;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The text each read draws, which is the figure a player reads off the bar. */
function readoutLabel(w: FoundryView, readout: StatusReadoutName): string {
  switch (readout) {
    case "charge":
      return `${Math.floor(w.charge)}`;
    case "integrity":
      return `${Math.max(0, Math.floor(w.integrity))}`;
    case "wave":
      return `WAVE ${w.wave === 0 ? 1 : w.wave} / ${difficulty(w).waves}`;
    case "maze-length":
      return `${Math.round(w.mazeLength)}`;
    case "paused":
      return "PAUSED";
    case "overload":
      return `${Math.round(w.mazeRating)}`;
  }
}

/**
 * The bar's reads, and none at all on a screen with no bar.
 *
 * The four the bar always carries come first, in draw order; the two conditional reads
 * follow, each present only while the bar is actually drawing it (specs/hud.md).
 */
export function statusBarReadouts(w: FoundryView): Readout[] {
  if (w.screen !== "playing" && w.screen !== "paused") return [];
  return BAR_READOUT_SLOTS.filter((slot) => {
    if (slot.readout === "paused") return w.paused;
    if (slot.readout === "overload") return w.finale;
    return true;
  }).map((slot) => ({
    readout: slot.readout,
    label: readoutLabel(w, slot.readout),
    x: slot.x,
    y: slot.y,
    w: slot.w,
    h: slot.h,
  }));
}

// ---- The recipe book's grid ----------------------------------------------
//
// The book is twelve cards in two columns of six, and each card carries its recipe as a
// fixed grid of ingredient cells: two columns and two rows, which holds the longest
// recipe the twelve provide. Every rectangle here is a function of the stage and of
// nothing else, so `src/render.ts` draws each token inside the cell named here and
// `src/debug.ts` reports that same rectangle (specs/instrumentation.md).

/** The book's card grid. */
const BOOK_HEAD_H = 56;
const BOOK_PAD = 18;
const BOOK_GAP = 12;
const BOOK_COLS = 2;
const BOOK_ROWS = 6;

/** Where a card's recipe strip starts, and the room it is given. */
const RECIPE_TOP = 52;
const RECIPE_BOTTOM_PAD = 8;
const RECIPE_SIDE_PAD = 12;
const RECIPE_CELL_COLS = 2;
const RECIPE_CELL_ROWS = 2;

/** One tower's card in the book. */
export interface ComboCard {
  combo: ComboId;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The twelve cards, in the order the book draws them. */
export function bookCards(): ComboCard[] {
  const { x0, y0, x1, y1 } = BOOK;
  const width = x1 - x0;
  const gridY = y0 + BOOK_HEAD_H;
  const cellW = (width - 2 * BOOK_PAD - BOOK_GAP) / BOOK_COLS;
  const cellH = (y1 - gridY - 16 - (BOOK_ROWS - 1) * BOOK_GAP) / BOOK_ROWS;
  return COMBO_IDS.map((combo, i) => ({
    combo,
    x: x0 + BOOK_PAD + (i % BOOK_COLS) * (cellW + BOOK_GAP),
    y: gridY + Math.floor(i / BOOK_COLS) * (cellH + BOOK_GAP),
    w: cellW,
    h: cellH,
  }));
}

/** One ingredient cell of one recipe, with the ingredient it stands for. */
export interface IngredientCell {
  combo: ComboId;
  ingredient: number;
  type: ComponentType;
  quality: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Every ingredient cell the book draws, card by card and recipe order within a card.
 *
 * The cells are a fixed two-by-two grid inside each card's recipe strip, so a recipe of
 * three fills three of the four and a recipe of four fills all of them. The grid is the
 * same whatever the yard holds, because `specs/hud.md` fixes the book's layout against
 * the player rather than against the state: what a state changes is the STATE each cell
 * is drawn in, never where it is.
 */
export function bookIngredientCells(): IngredientCell[] {
  const out: IngredientCell[] = [];
  for (const card of bookCards()) {
    const stripX = card.x + RECIPE_SIDE_PAD;
    const stripY = card.y + RECIPE_TOP;
    const stripW = card.w - RECIPE_SIDE_PAD * 2;
    const stripH = card.h - RECIPE_TOP - RECIPE_BOTTOM_PAD;
    const cellW = stripW / RECIPE_CELL_COLS;
    const cellH = stripH / RECIPE_CELL_ROWS;
    const recipe = COMBO_BY_ID[card.combo].recipe;
    for (let i = 0; i < recipe.length; i++) {
      const r = recipe[i]!;
      out.push({
        combo: card.combo,
        ingredient: i,
        type: r.type,
        quality: r.tier,
        x: stripX + (i % RECIPE_CELL_COLS) * cellW,
        y: stripY + Math.floor(i / RECIPE_CELL_COLS) * cellH,
        w: cellW,
        h: cellH,
      });
    }
  }
  return out;
}

/** The three states an ingredient reads in, against the yard as it stands. */
export type IngredientState = "selected" | "owned" | "missing";

/** The selection's own ingredient, when it is one, for the book to fold against. */
export function selectedIngredient(
  w: FoundryView,
): { type: ComponentType; quality: number } | null {
  const sel = selected(w);
  if (!sel) return null;
  if (sel.kind === "candidate") return { type: sel.type, quality: sel.quality };
  if (sel.kind === "component" && !sel.combo) {
    return { type: sel.type, quality: sel.quality };
  }
  return null;
}

/**
 * The yard's ingredient pool, as counts, excluding the current selection.
 *
 * Blockers and combination towers are never ingredients and never count as owned
 * (specs/hud.md), so neither enters the pool.
 */
export function ownedIngredients(w: FoundryView): Map<string, number> {
  const selectedId = selected(w)?.id ?? null;
  const out = new Map<string, number>();
  for (const s of w.structures) {
    if (s.id === selectedId) continue;
    if (s.kind === "blocker") continue;
    if (s.kind === "component" && s.combo) continue;
    const key = `${s.type}@${s.quality}`;
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

/**
 * Each of a recipe's ingredients, resolved to its state.
 *
 * Ownership is a multiset, so a recipe calling for two ingredients at the same type and
 * quality reads as covered only when the yard holds two: the pool is decremented as it
 * is spent, and the selection covers exactly one slot (specs/hud.md).
 */
export function recipeStates(
  combo: ComboId,
  held: { type: ComponentType; quality: number } | null,
  owned: ReadonlyMap<string, number>,
): IngredientState[] {
  const pool = new Map(owned);
  let spent = false;
  return COMBO_BY_ID[combo].recipe.map((r) => {
    if (
      !spent &&
      held !== null &&
      r.type === held.type &&
      r.tier === held.quality
    ) {
      spent = true;
      return "selected";
    }
    const key = `${r.type}@${r.tier}`;
    const have = pool.get(key) ?? 0;
    if (have > 0) {
      pool.set(key, have - 1);
      return "owned";
    }
    return "missing";
  });
}

/** One ingredient cell with the state the yard puts it in, as the book draws it. */
export interface BookEntry extends IngredientCell {
  state: IngredientState;
}

/**
 * Every ingredient cell the book is currently drawing, in the order it draws them.
 *
 * Empty whenever the book is not on screen — closed, or open on a screen that does
 * not draw the yard — because what this reports is what was drawn
 * (specs/instrumentation.md).
 */
export function bookEntries(w: FoundryView): BookEntry[] {
  if (!w.showCombos || w.screen !== "playing") return [];
  const held = selectedIngredient(w);
  const owned = ownedIngredients(w);
  const states = new Map<ComboId, IngredientState[]>();
  return bookIngredientCells().map((cell) => {
    let resolved = states.get(cell.combo);
    if (!resolved) {
      resolved = recipeStates(cell.combo, held, owned);
      states.set(cell.combo, resolved);
    }
    return { ...cell, state: resolved[cell.ingredient]! };
  });
}

/** Whether a structure's own block would ever offer a targeting priority. */
export function everFires(w: FoundryView): boolean {
  const sel = selected(w);
  if (!sel || sel.kind !== "component") return false;
  return unbuffedStats(sel).fires;
}

/** The menu entry the pointer is over, or `null`. */
export function menuHoverIndex(w: FoundryView): number | null {
  const items = menuControls(w);
  for (let i = 0; i < items.length; i++) {
    const c = items[i]!;
    if (inRect(w.pointerX, w.pointerY, c.x, c.y, c.w, c.h)) return i;
  }
  return null;
}

/** Whether a menu entry is drawn as the highlighted one. */
export function isHighlighted(w: FoundryView, index: number): boolean {
  if (w.menuIndex === index) return true;
  return menuHoverIndex(w) === index;
}

/** The action a `MenuAction` identifier stands for, narrowed for the router. */
export function asMenuAction(action: string): MenuAction {
  return action as MenuAction;
}
