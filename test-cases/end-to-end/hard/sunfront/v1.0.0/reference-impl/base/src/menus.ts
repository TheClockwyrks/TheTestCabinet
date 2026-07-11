/**
 * Sunfront — the menu screens and the state-machine surface (specs/flow.md).
 *
 * Every non-match state is a full-view DOM screen mounted inside the fitted 16:9 view:
 * the **title / main menu** (`SUNFRONT`, the tagline, then `SKIRMISH` and `HOW TO PLAY`),
 * the **how-to-play** briefing, the **pause** menu (Resume / Restart / Quit, over a frozen
 * field), and the **match-over** screen (`VICTORY` / `DEFEAT`, the wave reached, then Play
 * Again / Menu). Each carries a keyboard- and mouse-navigable {@link MenuList}: Up/Down or
 * W/S move, Enter/Space confirm, Esc backs out, and items are clickable — every state is
 * reachable, as `specs/flow.md` requires.
 *
 * `Game` owns the transitions; this module owns the DOM and the input routing for a menu.
 */

import { PALETTE, MONO_FONT_STACK } from "./constants";

export type Screen = "title" | "how-to-play" | "paused" | "match-over";

export interface MenusCallbacks {
  onSkirmish(): void;
  onHowToPlay(): void;
  onBackToTitle(): void;
  onResume(): void;
  onRestart(): void;
  onQuit(): void;
  onPlayAgain(): void;
  onMenu(): void;
}

/** A vertical, keyboard- and mouse-navigable menu (specs/flow.md controls). */
class MenuList {
  readonly root: HTMLDivElement;
  private index = 0;
  private readonly items: HTMLDivElement[] = [];
  private readonly labels: readonly string[];

  constructor(labels: readonly string[], private readonly onConfirm: (index: number) => void) {
    this.labels = labels;
    this.root = document.createElement("div");
    Object.assign(this.root.style, {
      display: "flex", flexDirection: "column", gap: "10px", alignItems: "center", marginTop: "8px",
    });
    labels.forEach((label, i) => {
      const item = document.createElement("div");
      Object.assign(item.style, {
        font: `18px ${MONO_FONT_STACK}`, color: PALETTE.textSecondary,
        padding: "6px 26px", borderRadius: "4px", cursor: "pointer",
        border: "1px solid transparent", letterSpacing: "1px", minWidth: "220px", textAlign: "center",
      });
      item.textContent = label;
      item.addEventListener("pointerenter", () => this.setIndex(i));
      item.addEventListener("pointerdown", (e) => { e.preventDefault(); this.setIndex(i); this.onConfirm(i); });
      this.items.push(item);
      this.root.appendChild(item);
    });
    this.render();
  }

  reset(): void { this.setIndex(0); }

  setIndex(i: number): void {
    this.index = (i + this.items.length) % this.items.length;
    this.render();
  }

  private render(): void {
    this.items.forEach((item, i) => {
      const on = i === this.index;
      item.style.color = on ? PALETTE.textPrimary : PALETTE.textSecondary;
      item.style.borderColor = on ? PALETTE.valid : "transparent";
      item.style.background = on ? "rgba(255,192,97,0.14)" : "transparent";
      item.textContent = on ? `> ${this.labels[i]} <` : this.labels[i];
    });
  }

  /** Handle a nav key; returns true if it was consumed. */
  handleKey(code: string): boolean {
    switch (code) {
      case "ArrowUp": case "KeyW": this.setIndex(this.index - 1); return true;
      case "ArrowDown": case "KeyS": this.setIndex(this.index + 1); return true;
      case "Enter": case "Space": case "NumpadEnter": this.onConfirm(this.index); return true;
      default: return false;
    }
  }
}

/** A full-view screen container in the fog colour, its content centred. */
function screen(dim: boolean): HTMLDivElement {
  const root = document.createElement("div");
  Object.assign(root.style, {
    position: "absolute", inset: "0", display: "none", flexDirection: "column",
    alignItems: "center", justifyContent: "center", textAlign: "center",
    background: dim ? "rgba(21,15,8,0.78)" : PALETTE.fog,
    font: `14px ${MONO_FONT_STACK}`, color: PALETTE.textPrimary,
    pointerEvents: "auto", padding: "24px", boxSizing: "border-box",
  });
  return root;
}

function heading(text: string, size: string, color: string): HTMLDivElement {
  const h = document.createElement("div");
  Object.assign(h.style, { fontSize: size, fontWeight: "800", letterSpacing: "4px", color });
  h.textContent = text;
  return h;
}

function line(text: string, color: string = PALETTE.textSecondary, size = "14px"): HTMLDivElement {
  const d = document.createElement("div");
  Object.assign(d.style, { fontSize: size, color, margin: "3px 0", lineHeight: "1.5", maxWidth: "620px" });
  d.textContent = text;
  return d;
}

export class Menus {
  private readonly title: HTMLDivElement;
  private readonly howto: HTMLDivElement;
  private readonly pause: HTMLDivElement;
  private readonly over: HTMLDivElement;

  private readonly titleList: MenuList;
  private readonly howtoList: MenuList;
  private readonly pauseList: MenuList;
  private readonly overList: MenuList;

  private readonly overHeading: HTMLDivElement;
  private readonly overWave: HTMLDivElement;

  private active: Screen | null = null;

  constructor(parent: HTMLElement, private readonly cb: MenusCallbacks) {
    // --- Title / main menu ------------------------------------------------
    this.title = screen(false);
    this.titleList = new MenuList(["SKIRMISH", "HOW TO PLAY"], (i) =>
      i === 0 ? this.cb.onSkirmish() : this.cb.onHowToPlay(),
    );
    this.title.append(
      heading("SUNFRONT", "58px", PALETTE.ember),
      line("TUG-OF-WAR ON THE DUNE FRONT", PALETTE.textSecondary, "15px"),
      spacer(18),
      this.titleList.root,
      spacer(22),
      line("Arrow keys / W-S to move · Enter to confirm", PALETTE.textFaint, "12px"),
    );

    // --- How to play ------------------------------------------------------
    this.howto = screen(false);
    this.howtoList = new MenuList(["BACK"], () => this.cb.onBackToTitle());
    this.howto.append(
      heading("HOW TO PLAY", "30px", PALETTE.emberLight),
      spacer(10),
      line("Build spawners and Solar Extractors on your staging grid. Every wave, each spawner", PALETTE.textSecondary),
      line("stamps out one unit that marches down the lane. Read what crosses the sand through", PALETTE.textSecondary),
      line("the fog, counter it, and raze the enemy base to win.", PALETTE.textSecondary),
      spacer(10),
      line("CLOCKS  —  +10 sol/s passive income; first wave at 20s, then every 45s.", PALETTE.textFaint),
      line("COUNTERS  —  Piercing beats Heavy · Splash beats swarms · Flak is the only answer to Air.", PALETTE.textFaint),
      line("Support (Lumen) heals; melee (Scarab, Bulwark) has no muzzle flash.", PALETTE.textFaint),
      spacer(10),
      line("CONTROLS  —  1-9 / 0 / E arm a build · click a grid cell to place · Esc or right-click disarm.", PALETTE.textFaint),
      line("Click a friendly structure to select it · U upgrade · X sell · Esc or P pause.", PALETTE.textFaint),
      line("Arrows / WASD or edge-scroll pan the camera · H recenter · F3 FPS · F4 wireframe.", PALETTE.textFaint),
      spacer(16),
      this.howtoList.root,
    );

    // --- Pause ------------------------------------------------------------
    this.pause = screen(true);
    this.pauseList = new MenuList(["RESUME", "RESTART", "QUIT TO MENU"], (i) => {
      if (i === 0) this.cb.onResume();
      else if (i === 1) this.cb.onRestart();
      else this.cb.onQuit();
    });
    this.pause.append(heading("PAUSED", "36px", PALETTE.textPrimary), spacer(16), this.pauseList.root);

    // --- Match over -------------------------------------------------------
    this.over = screen(true);
    this.overHeading = heading("VICTORY", "48px", PALETTE.healthHealthy);
    this.overWave = line("", PALETTE.textSecondary, "16px");
    this.overList = new MenuList(["PLAY AGAIN", "MENU"], (i) =>
      i === 0 ? this.cb.onPlayAgain() : this.cb.onMenu(),
    );
    this.over.append(this.overHeading, spacer(6), this.overWave, spacer(20), this.overList.root);

    parent.append(this.title, this.howto, this.pause, this.over);
  }

  /** Show one screen (hiding the others) and reset its selection to the top. */
  show(which: Screen): void {
    this.hide();
    this.active = which;
    const map: Record<Screen, { root: HTMLDivElement; list: MenuList }> = {
      title: { root: this.title, list: this.titleList },
      "how-to-play": { root: this.howto, list: this.howtoList },
      paused: { root: this.pause, list: this.pauseList },
      "match-over": { root: this.over, list: this.overList },
    };
    map[which].root.style.display = "flex";
    map[which].list.reset();
  }

  hide(): void {
    this.active = null;
    for (const s of [this.title, this.howto, this.pause, this.over]) s.style.display = "none";
  }

  /** Fill the match-over screen for a result before showing it. */
  setMatchOver(playerWon: boolean, wave: number): void {
    this.overHeading.textContent = playerWon ? "VICTORY" : "DEFEAT";
    this.overHeading.style.color = playerWon ? PALETTE.healthHealthy : PALETTE.healthCritical;
    this.overWave.textContent = `Reached wave ${wave}`;
  }

  /** Route a keydown to the active screen; returns true if a menu consumed it. */
  handleKey(code: string): boolean {
    if (!this.active) return false;
    if (code === "Escape") {
      switch (this.active) {
        case "how-to-play": this.cb.onBackToTitle(); return true;
        case "paused": this.cb.onResume(); return true;
        case "match-over": this.cb.onMenu(); return true;
        default: return true; // Esc on the title stays on the title
      }
    }
    const list = {
      title: this.titleList, "how-to-play": this.howtoList,
      paused: this.pauseList, "match-over": this.overList,
    }[this.active];
    return list.handleKey(code);
  }
}

function spacer(px: number): HTMLDivElement {
  const d = document.createElement("div");
  d.style.height = `${px}px`;
  return d;
}
