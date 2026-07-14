/**
 * Sunfront — the in-match HUD overlay (specs/flow.md HUD, specs/overview.md palette).
 *
 * A screen-space DOM overlay drawn over the 3D world in the exact palette and the
 * monospace stack, mounted inside the fitted 16:9 view (`World.overlayRoot`) so every
 * element stays on-screen at any window size. It renders, each frame from a plain
 * {@link HudModel} snapshot (never reading the simulation itself):
 *
 * - **top-left:** the player's `sol` (large) and income `+N/s`, in Ember;
 * - **top-centre:** the wave number and the countdown to the next wave;
 * - **top strip:** both base health bars, flanking centre, filling healthy -> critical;
 * - **build palette:** the ten unit spawners + the Solar Extractor, each with its icon
 *   (team colour), name, cost, and shortcut, dimmed when unaffordable and highlighted
 *   when armed — clicking one arms it;
 * - **selected-structure panel:** a base/Reliquary's read-only health, or a build-grid
 *   structure's level pips, current effect, and Upgrade / Sell actions.
 *
 * The overlay root is click-through; only the palette and the panel opt back into
 * pointer events so the rest of the screen still drives placement and selection.
 */

import { PALETTE, MONO_FONT_STACK, BUILD_PALETTE_ORDER, UNIT_STATS, BASE_HP } from "./constants";
import type { BuildStructureType } from "./types";

/** A build-grid structure's live panel, or a read-only base/Reliquary panel. */
export type PanelModel =
  | { kind: "fixed"; name: string; hp: number; max: number; note?: string }
  | {
      kind: "build";
      name: string;
      level: number;
      maxLevel: number;
      effect: string;
      /** Upgrade action: label + whether it can be afforded (null once at max level). */
      upgrade: { label: string; affordable: boolean } | null;
      sell: string;
    };

/** Everything the HUD draws for one frame (computed by `Game`, never the sim directly). */
export interface HudModel {
  readonly sol: number;
  readonly income: number;
  readonly wave: number;
  /** Seconds to the next wave, or null before the clock is meaningful. */
  readonly countdown: number | null;
  readonly playerBaseHp: number;
  readonly enemyBaseHp: number;
  readonly armed: BuildStructureType | null;
  readonly panel: PanelModel | null;
}

/** The palette's fixed shortcut labels: 1-9, 0 for the tenth unit, E for the Extractor. */
function shortcutFor(index: number): string {
  if (index < 9) return String(index + 1);
  if (index === 9) return "0";
  return "E";
}

/** Display name + build cost for a palette slot. */
function slotInfo(type: BuildStructureType): { name: string; cost: number } {
  if (type === "solar-extractor") return { name: "Solar Extractor", cost: 180 };
  const s = UNIT_STATS[type];
  return { name: s.name, cost: s.cost };
}

/** The eleven palette slots in shortcut order (ten spawners, then the Extractor). */
const PALETTE_SLOTS: readonly BuildStructureType[] = [...BUILD_PALETTE_ORDER, "solar-extractor"];

interface PaletteCell {
  readonly type: BuildStructureType;
  readonly root: HTMLDivElement;
  readonly cost: number;
}

export interface HudCallbacks {
  onArm(type: BuildStructureType): void;
  onUpgrade(): void;
  onSell(): void;
}

export class Hud {
  readonly root: HTMLDivElement;

  private readonly solEl: HTMLDivElement;
  private readonly incomeEl: HTMLDivElement;
  private readonly waveEl: HTMLDivElement;
  private readonly countdownEl: HTMLDivElement;
  private readonly playerBar: HTMLDivElement;
  private readonly enemyBar: HTMLDivElement;
  private readonly cells: PaletteCell[] = [];

  // Selected-structure panel.
  private readonly panelRoot: HTMLDivElement;
  private readonly panelName: HTMLDivElement;
  private readonly panelHealth: HTMLDivElement;
  private readonly panelBuild: HTMLDivElement;
  private readonly pips: HTMLSpanElement[] = [];
  private readonly effectEl: HTMLDivElement;
  private readonly upgradeBtn: HTMLButtonElement;
  private readonly sellBtn: HTMLButtonElement;

  constructor(parent: HTMLElement, private readonly cb: HudCallbacks) {
    this.root = el("div", {
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
      font: `13px ${MONO_FONT_STACK}`,
      color: PALETTE.textPrimary,
      userSelect: "none",
      display: "none",
    });

    // --- Top-left: sol + income -------------------------------------------
    const topLeft = el("div", { position: "absolute", left: "16px", top: "12px", lineHeight: "1.05" });
    this.solEl = el("div", { fontSize: "30px", fontWeight: "700", color: PALETTE.ember, letterSpacing: "0.5px" });
    this.incomeEl = el("div", { fontSize: "13px", color: PALETTE.emberLight, marginTop: "2px" });
    topLeft.append(this.solEl, this.incomeEl);

    // --- Top-centre: wave + countdown, flanked by the two base bars -------
    const topCenter = el("div", {
      position: "absolute", left: "0", right: "0", top: "10px",
      display: "flex", alignItems: "center", justifyContent: "center", gap: "18px",
      pointerEvents: "none",
    });
    const playerSide = this.buildBaseBar("YOUR BASE", "flex-end");
    this.playerBar = playerSide.fill;
    const center = el("div", { textAlign: "center", minWidth: "150px" });
    this.waveEl = el("div", { fontSize: "17px", fontWeight: "700", color: PALETTE.textPrimary });
    this.countdownEl = el("div", { fontSize: "12px", color: PALETTE.textSecondary, marginTop: "1px" });
    center.append(this.waveEl, this.countdownEl);
    const enemySide = this.buildBaseBar("ENEMY BASE", "flex-start");
    this.enemyBar = enemySide.fill;
    topCenter.append(playerSide.root, center, enemySide.root);

    // --- Build palette (bottom row) ---------------------------------------
    const palette = el("div", {
      position: "absolute", left: "0", right: "0", bottom: "12px",
      display: "flex", justifyContent: "center", flexWrap: "wrap", gap: "6px",
      padding: "0 12px", pointerEvents: "none",
    });
    PALETTE_SLOTS.forEach((type, i) => {
      const info = slotInfo(type);
      const cell = this.buildPaletteCell(type, info.name, info.cost, shortcutFor(i));
      palette.appendChild(cell.root);
      this.cells.push(cell);
    });

    // --- Selected-structure panel (bottom-right) --------------------------
    this.panelRoot = el("div", {
      position: "absolute", right: "16px", bottom: "104px", width: "230px",
      background: "rgba(21,15,8,0.82)", border: `1px solid ${PALETTE.textFaint}`,
      borderRadius: "4px", padding: "10px 12px", pointerEvents: "auto", display: "none",
    });
    this.panelName = el("div", { fontSize: "15px", fontWeight: "700", color: PALETTE.textPrimary, marginBottom: "6px" });
    this.panelHealth = el("div", { fontSize: "13px", color: PALETTE.textSecondary, lineHeight: "1.5" });
    this.panelBuild = el("div", { display: "none" });

    const pipRow = el("div", { display: "flex", gap: "5px", margin: "2px 0 8px" });
    for (let i = 0; i < 3; i++) {
      const pip = el("span", {
        width: "20px", height: "8px", borderRadius: "2px",
        border: `1px solid ${PALETTE.textFaint}`, background: "transparent",
      });
      this.pips.push(pip);
      pipRow.appendChild(pip);
    }
    this.effectEl = el("div", { fontSize: "12px", color: PALETTE.textSecondary, lineHeight: "1.5", marginBottom: "9px" });
    const actions = el("div", { display: "flex", gap: "8px" });
    this.upgradeBtn = this.buildButton(PALETTE.valid, () => this.cb.onUpgrade());
    this.sellBtn = this.buildButton(PALETTE.invalid, () => this.cb.onSell());
    actions.append(this.upgradeBtn, this.sellBtn);
    this.panelBuild.append(pipRow, this.effectEl, actions);
    this.panelRoot.append(this.panelName, this.panelHealth, this.panelBuild);

    this.root.append(topLeft, topCenter, palette, this.panelRoot);
    parent.appendChild(this.root);
  }

  show(): void { this.root.style.display = "block"; }
  hide(): void { this.root.style.display = "none"; }

  /** Push one frame's snapshot into the DOM. */
  update(m: HudModel): void {
    this.solEl.textContent = Math.floor(m.sol).toLocaleString("en-US");
    this.incomeEl.textContent = `+${m.income.toFixed(0)}/s`;
    this.waveEl.textContent = m.wave > 0 ? `WAVE ${m.wave}` : "MUSTERING";
    this.countdownEl.textContent =
      m.countdown == null ? "" : `next wave in ${Math.max(0, Math.ceil(m.countdown))}s`;

    setBar(this.playerBar, m.playerBaseHp / BASE_HP);
    setBar(this.enemyBar, m.enemyBaseHp / BASE_HP);

    for (const cell of this.cells) {
      const affordable = m.sol >= cell.cost;
      const armed = m.armed === cell.type;
      cell.root.style.opacity = affordable ? "1" : "0.42";
      cell.root.style.borderColor = armed ? PALETTE.valid : "rgba(138,122,88,0.45)";
      cell.root.style.background = armed ? "rgba(255,192,97,0.16)" : "rgba(21,15,8,0.72)";
    }

    this.updatePanel(m.panel);
  }

  private updatePanel(p: PanelModel | null): void {
    if (!p) { this.panelRoot.style.display = "none"; return; }
    this.panelRoot.style.display = "block";
    this.panelName.textContent = p.name;

    if (p.kind === "fixed") {
      this.panelHealth.style.display = "block";
      this.panelBuild.style.display = "none";
      const hp = `HP ${Math.max(0, Math.ceil(p.hp))} / ${p.max}`;
      this.panelHealth.textContent = p.note ? `${hp}\n${p.note}` : hp;
      this.panelHealth.style.whiteSpace = "pre-line";
      return;
    }

    this.panelHealth.style.display = "none";
    this.panelBuild.style.display = "block";
    for (let i = 0; i < 3; i++) {
      this.pips[i].style.background = i < p.level ? PALETTE.emberLight : "transparent";
    }
    this.effectEl.textContent = p.effect;

    if (p.upgrade) {
      this.upgradeBtn.textContent = p.upgrade.label;
      this.upgradeBtn.style.display = "block";
      this.upgradeBtn.style.opacity = p.upgrade.affordable ? "1" : "0.45";
    } else {
      this.upgradeBtn.textContent = "MAX LEVEL";
      this.upgradeBtn.style.display = "block";
      this.upgradeBtn.style.opacity = "0.45";
    }
    this.sellBtn.textContent = p.sell;
  }

  // --- Builders ----------------------------------------------------------

  private buildBaseBar(label: string, align: string): { root: HTMLDivElement; fill: HTMLDivElement } {
    const root = el("div", { display: "flex", flexDirection: "column", alignItems: align as string, width: "210px" });
    const cap = el("div", { fontSize: "10px", letterSpacing: "1px", color: PALETTE.textFaint, marginBottom: "3px" });
    cap.textContent = label;
    const track = el("div", {
      width: "100%", height: "12px", background: "rgba(21,15,8,0.7)",
      border: `1px solid ${PALETTE.textFaint}`, borderRadius: "3px", overflow: "hidden",
    });
    const fill = el("div", { height: "100%", width: "100%", background: PALETTE.healthHealthy });
    track.appendChild(fill);
    root.append(cap, track);
    return { root, fill };
  }

  private buildPaletteCell(type: BuildStructureType, name: string, cost: number, key: string): PaletteCell {
    const root = el("div", {
      pointerEvents: "auto", cursor: "pointer", width: "88px",
      background: "rgba(21,15,8,0.72)", border: "1px solid rgba(138,122,88,0.45)",
      borderRadius: "4px", padding: "5px 6px", display: "flex", flexDirection: "column", gap: "2px",
    });
    const top = el("div", { display: "flex", alignItems: "center", gap: "5px" });
    const icon = el("span", { width: "12px", height: "12px", borderRadius: "2px", background: PALETTE.ember, flex: "0 0 auto" });
    const keyBadge = el("span", {
      marginLeft: "auto", fontSize: "10px", color: PALETTE.textPrimary,
      background: "rgba(138,122,88,0.35)", borderRadius: "2px", padding: "0 4px",
    });
    keyBadge.textContent = key;
    const nameEl = el("span", { fontSize: "11px", color: PALETTE.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
    nameEl.textContent = name;
    top.append(icon, nameEl, keyBadge);
    const costEl = el("div", { fontSize: "11px", color: PALETTE.emberLight });
    costEl.textContent = `${cost} sol`;
    root.append(top, costEl);
    root.addEventListener("pointerdown", (e) => { e.preventDefault(); this.cb.onArm(type); });
    return { type, root, cost };
  }

  private buildButton(color: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    Object.assign(b.style, {
      flex: "1", font: `12px ${MONO_FONT_STACK}`, color: PALETTE.textPrimary,
      background: "rgba(21,15,8,0.6)", border: `1px solid ${color}`, borderRadius: "3px",
      padding: "5px 4px", cursor: "pointer",
    });
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); onClick(); });
    return b;
  }
}

// ---------------------------------------------------------------------------
// Small DOM + colour helpers.
// ---------------------------------------------------------------------------

/** Create an element and apply inline styles. */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  style: Partial<CSSStyleDeclaration>,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node.style, style);
  return node;
}

/** Fraction 0..1 lerp from the healthy to the critical colour. */
function healthColor(frac: number): string {
  const f = Math.max(0, Math.min(1, frac));
  const a = hexToRgb(PALETTE.healthCritical);
  const b = hexToRgb(PALETTE.healthHealthy);
  const r = Math.round(a[0] + (b[0] - a[0]) * f);
  const g = Math.round(a[1] + (b[1] - a[1]) * f);
  const bl = Math.round(a[2] + (b[2] - a[2]) * f);
  return `rgb(${r},${g},${bl})`;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Set a health bar fill to `frac` of its track, coloured by remaining fraction. */
function setBar(fill: HTMLDivElement, frac: number): void {
  const f = Math.max(0, Math.min(1, frac));
  fill.style.width = `${(f * 100).toFixed(1)}%`;
  fill.style.background = healthColor(f);
}
