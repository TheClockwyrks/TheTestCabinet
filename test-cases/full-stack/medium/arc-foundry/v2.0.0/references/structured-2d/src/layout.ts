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
  COMBO_MAX_LEVEL,
  DIFFICULTIES,
  MAPS,
  PANEL_ACTION_LABELS,
  PANEL_X,
  PANEL_W,
  STAGE_H,
  STAGE_W,
  type MenuAction,
  type PanelAction,
  type StatusControl as StatusControlName,
} from "./constants";
import { isMenuScreen, menuItems } from "./menus";
import {
  canCombine,
  canStamp,
  canUpgradeCombo,
  canUpgradeQuality,
  combineSet,
  comboUpgradeCostFor,
  difficulty,
  reachableCombosFor,
  selected,
  statsOf,
  unbuffedStats,
} from "./sim";
import { COMBO_BY_ID, baseStats } from "./tables";
import { QUALITY_LABEL, TARGETING_LABEL, qualityIndex } from "./theme";
import type { FoundryState } from "./state";
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
  | "menu"
  | "bar"
  | "panel"
  | "press"
  | "overlay"
  | "noop";

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

/** The status bar's reads, as `specs/instrumentation.md` names them. */
export type ReadoutName =
  | "charge"
  | "integrity"
  | "wave"
  | "maze-length"
  | "paused"
  | "overload";

/** One read of the bar, with the text it is drawing and the rectangle it drew it at. */
export interface StatusReadout {
  readout: ReadoutName;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The bar's READS — what it draws that is not a control — with the rectangle each
 * was drawn at, which `statusReadouts` reports (`specs/instrumentation.md`).
 *
 * `specs/hud.md` fixes the reads and their left-to-right order and leaves each one's
 * rectangle to the build, so this table is that choice written down once and drawn
 * from. `paused` and `overload` are the two conditional reads, present only on the
 * frames the bar is actually drawing them.
 */
const READOUT_SLOTS: readonly {
  readout: ReadoutName;
  x: number;
  y: number;
  w: number;
  h: number;
}[] = [
  { readout: "charge", x: 20, y: 8, w: 146, h: 40 },
  { readout: "integrity", x: 170, y: 8, w: 200, h: 40 },
  { readout: "wave", x: 374, y: 8, w: 176, h: 40 },
  { readout: "maze-length", ...MAZE_READOUT },
  // The `PAUSED` read replaces the wave slot's progress sub-read while the game is
  // paused in place, so it sits inside the wave slot rather than beside it.
  { readout: "paused", x: 464, y: 24, w: 84, h: 24 },
  { readout: "overload", x: 554, y: 8, w: 130, h: 40 },
];

/** The two screens the bar is drawn on (`specs/hud.md`). */
function barIsDrawn(w: FoundryState): boolean {
  return w.screen === "playing" || w.screen === "paused";
}

/** The bar's reads, each with the text it is drawing, on the frames it draws them. */
export function statusReadouts(w: FoundryState): StatusReadout[] {
  if (!barIsDrawn(w)) return [];
  const total = difficulty(w).waves;
  const shown: Record<ReadoutName, string | null> = {
    charge: `${Math.floor(w.charge)}`,
    integrity: `${Math.max(0, Math.floor(w.integrity))}`,
    wave: `${w.wave === 0 ? 1 : w.wave} / ${total}`,
    "maze-length": `${Math.round(w.mazeLength)}`,
    paused: w.paused ? "PAUSED" : null,
    overload: w.finale ? `${Math.round(w.mazeRating)}` : null,
  };
  const out: StatusReadout[] = [];
  for (const slot of READOUT_SLOTS) {
    const label = shown[slot.readout];
    if (label === null) continue;
    out.push({ ...slot, label });
  }
  return out;
}

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
export function leaderboardTop(w: FoundryState): Component[] {
  const firing = w.structures.filter(
    (s): s is Component => s.kind === "component" && s.damageDealt > 0,
  );
  return [...firing]
    .sort((a, b) => b.damageDealt - a.damageDealt)
    .slice(0, BOARD_ROWS);
}

/** The structure whose leaderboard row the pointer is over, or `null`. */
export function leaderboardHoverId(w: FoundryState): number | null {
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
export function controls(w: FoundryState): Control[] {
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
  w: FoundryState,
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
  w: FoundryState,
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
function mapSelectControls(w: FoundryState): Control[] {
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
function difficultySelectControls(w: FoundryState): Control[] {
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
function yardControls(w: FoundryState): Control[] {
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
function barControls(w: FoundryState): Control[] {
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
export function barLabel(w: FoundryState, action: StatusControlName): string {
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
  w: FoundryState,
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
function panelControls(w: FoundryState): Control[] {
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
export function inspectorControls(w: FoundryState): Control[] {
  const sel = selected(w);
  if (!sel) return [];
  // On `paused` the pause menu takes the input and every control on the panel is
  // inert (specs/controls.md), so every slot is drawn disabled there whatever the
  // phase underneath it says.
  const live = w.screen === "playing";
  const inBuild = live && w.runPhase === "build";
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
function damageControls(w: FoundryState): Control[] {
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
export function menuControls(w: FoundryState): Control[] {
  if (!isMenuScreen(w.screen)) return [];
  return controls(w).filter((c) => c.kind === "menu");
}

/** The inspector's action controls, in slot order. */
export function panelButtonControls(w: FoundryState): Control[] {
  return controls(w).filter((c) => c.kind === "panel");
}

/** The panel's own two controls, in the order the panel draws them. */
export function pressPanelControls(w: FoundryState): Control[] {
  return controls(w).filter((c) => c.kind === "press");
}

/** The status bar's controls, and none at all on a screen with no bar. */
export function statusBarControls(w: FoundryState): Control[] {
  return controls(w).filter((c) => c.kind === "bar");
}

/** Whether a structure's own block would ever offer a targeting priority. */
export function everFires(w: FoundryState): boolean {
  const sel = selected(w);
  if (!sel || sel.kind !== "component") return false;
  return unbuffedStats(sel).fires;
}

/** The menu entry the pointer is over, or `null`. */
export function menuHoverIndex(w: FoundryState): number | null {
  const items = menuControls(w);
  for (let i = 0; i < items.length; i++) {
    const c = items[i]!;
    if (inRect(w.pointerX, w.pointerY, c.x, c.y, c.w, c.h)) return i;
  }
  return null;
}

/** Whether a menu entry is drawn as the highlighted one. */
export function isHighlighted(w: FoundryState, index: number): boolean {
  if (w.menuIndex === index) return true;
  return menuHoverIndex(w) === index;
}

/** The action a `MenuAction` identifier stands for, narrowed for the router. */
export function asMenuAction(action: string): MenuAction {
  return action as MenuAction;
}
