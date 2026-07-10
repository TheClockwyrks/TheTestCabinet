/**
 * Sunfront — the top-level game controller and state machine (specs/flow.md).
 *
 * `Game` owns the whole player-facing shell: the five states (title / how-to-play /
 * in-match / paused / match-over) and every transition between them, the HUD overlay,
 * the menu screens, and all of the in-match controls — arming a build type, placing it
 * on the grid, selecting and managing a structure, pausing, and the camera. It drives
 * the render {@link World} every frame and steps the {@link Match} only while a match is
 * live, so a paused or finished match freezes with the field still on screen.
 *
 * Player commands go through the very same `World` economy API the AI uses; the renderer
 * and simulation are never reached directly by the DOM, only through this controller.
 */

import type { LoadedAssets, GameState, BuildStructureType } from "./types";
import { World } from "./render/world";
import { Match } from "./match";
import { Hud, type HudModel, type PanelModel } from "./hud";
import { Menus } from "./menus";
import { PlacementGhost } from "./render/ghost";
import { gridCellCenter } from "./render/terrain";
import {
  buildCost, upgradeCost, levelBonus, type BuildStructure,
} from "./sim/world";
import { distance } from "./mathutil";
import {
  BUILD_PALETTE_ORDER, BUILD_CELL_SIZE, BUILD_GRID_COLS, BUILD_GRID_ROWS,
  PLAYER_GRID_ORIGIN, PLAYER_BASE, PLAYER_RELIQUARY, BASE_HP, UNIT_STATS,
  SOLAR_EXTRACTOR_INCOME_BY_LEVEL, MAX_STRUCTURE_LEVEL, SELL_REFUND_FRACTION,
} from "./constants";

/** What the player currently has selected (a build structure by id, or a fixed one). */
type Selection =
  | { kind: "structure"; id: number }
  | { kind: "base" }
  | { kind: "reliquary" };

/** Radius (logical units) within which a click selects the player's base / Reliquary. */
const BASE_PICK_RADIUS = 85;
const RELIQUARY_PICK_RADIUS = 95;

export class Game {
  private state: GameState = "title";
  private match: Match | null = null;

  private readonly hud: Hud;
  private readonly menus: Menus;
  private readonly ghost: PlacementGhost;

  private armed: BuildStructureType | null = null;
  private selected: Selection | null = null;
  private readonly pointer = { x: 0, y: 0, inside: false };

  private last = performance.now();

  constructor(
    private readonly render: World,
    private readonly assets: LoadedAssets,
  ) {
    this.ghost = new PlacementGhost(render.scene);
    this.hud = new Hud(render.overlayRoot, {
      onArm: (t) => this.arm(t),
      onUpgrade: () => this.upgradeSelected(),
      onSell: () => this.sellSelected(),
    });
    this.menus = new Menus(render.overlayRoot, {
      onSkirmish: () => this.enterMatch(),
      onHowToPlay: () => this.toState("how-to-play"),
      onBackToTitle: () => this.toState("title"),
      onResume: () => this.resume(),
      onRestart: () => this.enterMatch(),
      onQuit: () => this.leaveToTitle(),
      onPlayAgain: () => this.enterMatch(),
      onMenu: () => this.leaveToTitle(),
    });

    this.bindInput();
    this.toState("title");
  }

  /** Start the render/update loop and show the title screen. */
  start(): void {
    this.last = performance.now();
    const frame = (now: number): void => {
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.tick(dt);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  // --- The frame ---------------------------------------------------------

  private tick(dt: number): void {
    if (this.state === "in-match" && this.match) {
      this.match.update(dt);
      if (this.match.world.result) this.toMatchOver();
    }
    if (this.match) this.hud.update(this.snapshot(this.match));
    this.updateGhost();
    this.render.render(dt);
  }

  // --- State transitions -------------------------------------------------

  /** Enter (or restart) a live match with a fresh simulation and field. */
  private enterMatch(): void {
    if (this.match) this.match.dispose();
    this.match = new Match(this.render, this.assets);
    this.armed = null;
    this.selected = null;
    this.ghost.hide();
    this.render.recenter();
    this.menus.hide();
    this.hud.show();
    this.render.setPanEnabled(true);
    this.state = "in-match";
  }

  private resume(): void {
    this.state = "in-match";
    this.menus.hide();
    this.render.setPanEnabled(true);
  }

  private toPaused(): void {
    if (this.state !== "in-match") return;
    this.state = "paused";
    this.armed = null;
    this.ghost.hide();
    this.render.setPanEnabled(false);
    this.menus.show("paused");
  }

  private toMatchOver(): void {
    if (!this.match) return;
    this.state = "match-over";
    this.armed = null;
    this.ghost.hide();
    this.render.setPanEnabled(false);
    this.menus.setMatchOver(this.match.world.result === "player", this.match.world.waveNumber);
    this.menus.show("match-over");
  }

  private leaveToTitle(): void {
    if (this.match) { this.match.dispose(); this.match = null; }
    this.armed = null;
    this.selected = null;
    this.ghost.hide();
    this.hud.hide();
    this.render.setPanEnabled(false);
    this.toState("title");
  }

  /** Show a non-match screen (title / how-to-play) and hide the HUD. */
  private toState(state: GameState): void {
    this.state = state;
    this.hud.hide();
    this.render.setPanEnabled(false);
    if (state === "title") this.menus.show("title");
    else if (state === "how-to-play") this.menus.show("how-to-play");
  }

  // --- Player build commands (specs/flow.md, specs/economy.md) -----------

  private arm(type: BuildStructureType): void {
    if (this.state !== "in-match") return;
    this.armed = type;
    this.selected = null;
  }

  private disarm(): void {
    this.armed = null;
    this.ghost.hide();
  }

  private upgradeSelected(): void {
    if (this.state !== "in-match" || !this.match) return;
    const s = this.selectedStructure(this.match);
    if (s) this.match.world.upgrade(s);
  }

  private sellSelected(): void {
    if (this.state !== "in-match" || !this.match) return;
    const s = this.selectedStructure(this.match);
    if (s) { this.match.world.sell(s); this.selected = null; }
  }

  // --- Picking + click handling ------------------------------------------

  private onLeftClick(clientX: number, clientY: number): void {
    if (this.state !== "in-match" || !this.match) return;
    const g = this.render.pickGround(clientX, clientY);
    if (this.armed) {
      if (!g) return;
      const cell = this.cellAt(g.x, g.z);
      // place() is affordability- and occupancy-guarded; a rejected placement is a
      // no-op and the ghost already shows the invalid colour (specs/flow.md).
      if (cell) this.match.world.place("player", this.armed, cell.col, cell.row);
      return;
    }
    this.selectAt(g);
  }

  /** Select the friendly structure / base / Reliquary under a ground point, or clear. */
  private selectAt(g: { x: number; z: number } | null): void {
    if (g) {
      const cell = this.cellAt(g.x, g.z);
      if (cell) {
        const s = this.match!.world.structureAt("player", cell.col, cell.row);
        if (s) { this.selected = { kind: "structure", id: s.id }; return; }
      }
      if (distance(g, PLAYER_BASE) <= BASE_PICK_RADIUS) { this.selected = { kind: "base" }; return; }
      if (distance(g, PLAYER_RELIQUARY) <= RELIQUARY_PICK_RADIUS) { this.selected = { kind: "reliquary" }; return; }
    }
    this.selected = null;
  }

  /** The player build-grid cell a ground point falls in, or null if off the grid. */
  private cellAt(x: number, z: number): { col: number; row: number } | null {
    const col = Math.round((x - PLAYER_GRID_ORIGIN.x) / BUILD_CELL_SIZE);
    const row = Math.round((z - PLAYER_GRID_ORIGIN.z) / BUILD_CELL_SIZE);
    if (col < 0 || col >= BUILD_GRID_COLS || row < 0 || row >= BUILD_GRID_ROWS) return null;
    const c = gridCellCenter("player", col, row);
    if (Math.abs(x - c.x) > BUILD_CELL_SIZE / 2 || Math.abs(z - c.z) > BUILD_CELL_SIZE / 2) return null;
    return { col, row };
  }

  private updateGhost(): void {
    if (this.state !== "in-match" || !this.match || !this.armed || !this.pointer.inside) {
      this.ghost.hide();
      return;
    }
    const g = this.render.pickGround(this.pointer.x, this.pointer.y);
    const cell = g ? this.cellAt(g.x, g.z) : null;
    if (!cell) { this.ghost.hide(); return; }
    const c = gridCellCenter("player", cell.col, cell.row);
    const allowed =
      this.match.world.cellFree("player", cell.col, cell.row) &&
      this.match.world.sol.player >= buildCost(this.armed);
    this.ghost.showAt(c.x, c.z, allowed);
  }

  // --- HUD snapshot ------------------------------------------------------

  private snapshot(match: Match): HudModel {
    const w = match.world;
    return {
      sol: w.sol.player,
      income: w.incomeRate("player"),
      wave: w.waveNumber,
      countdown: w.result ? null : w.waveTimer,
      playerBaseHp: w.bases.player.hp,
      enemyBaseHp: w.bases.enemy.hp,
      armed: this.armed,
      panel: this.panelModel(match),
    };
  }

  private panelModel(match: Match): PanelModel | null {
    if (!this.selected) return null;
    const w = match.world;
    if (this.selected.kind === "base") {
      const b = w.bases.player;
      return { kind: "fixed", name: "Command Base", hp: b.hp, max: BASE_HP };
    }
    if (this.selected.kind === "reliquary") {
      const r = w.reliquaries.player;
      return { kind: "fixed", name: "Reliquary", hp: r.hp, max: r.maxHp, note: "Regenerates +4 HP/s when undamaged" };
    }
    const s = this.selectedStructure(match);
    if (!s) { this.selected = null; return null; }
    return this.buildPanel(match, s);
  }

  private buildPanel(match: Match, s: BuildStructure): PanelModel {
    const sol = match.world.sol.player;
    let name: string;
    let effect: string;
    if (s.kind === "solar-extractor") {
      name = "Solar Extractor";
      effect = `Income +${SOLAR_EXTRACTOR_INCOME_BY_LEVEL[s.level - 1]}/s`;
    } else {
      const u = UNIT_STATS[s.kind];
      const f = levelBonus(s.level);
      name = `${u.name} Spawner`;
      effect = `Emits ${u.name} · ${Math.round(u.hp * f)} HP · ${Math.round(u.damage * f)} dmg`;
    }
    const upgrade =
      s.level >= MAX_STRUCTURE_LEVEL
        ? null
        : (() => {
            const cost = upgradeCost(s.kind);
            return { label: `UPGRADE [U] ${cost}`, affordable: sol >= cost };
          })();
    const refund = Math.round(s.investedSol * SELL_REFUND_FRACTION);
    return {
      kind: "build",
      name,
      level: s.level,
      maxLevel: MAX_STRUCTURE_LEVEL,
      effect,
      upgrade,
      sell: `SELL [X] +${refund}`,
    };
  }

  /** Resolve the currently-selected build structure (still standing), or null. */
  private selectedStructure(match: Match): BuildStructure | null {
    if (!this.selected || this.selected.kind !== "structure") return null;
    const id = this.selected.id;
    return match.world.structures.find((s) => s.id === id && s.team === "player") ?? null;
  }

  // --- Input -------------------------------------------------------------

  private bindInput(): void {
    window.addEventListener("keydown", (e) => this.onKeyDown(e));

    const canvas = this.render.domElement;
    canvas.addEventListener("pointerdown", (e) => {
      if (this.state !== "in-match") return;
      if (e.button === 2) { this.disarm(); return; }
      if (e.button !== 0) return;
      this.onLeftClick(e.clientX, e.clientY);
    });
    canvas.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (this.state === "in-match") this.disarm();
    });
    canvas.addEventListener("pointermove", (e) => {
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
      this.pointer.inside = true;
    });
    canvas.addEventListener("pointerleave", () => { this.pointer.inside = false; });
  }

  private onKeyDown(e: KeyboardEvent): void {
    // Menu states route to the active screen (Up/Down, Enter, Esc, W/S).
    if (this.state !== "in-match") {
      if (this.menus.handleKey(e.code)) e.preventDefault();
      return;
    }

    // In-match shortcuts.
    const shortcut = SHORTCUTS[e.code];
    if (shortcut) { this.arm(shortcut); return; }
    switch (e.code) {
      case "KeyU": this.upgradeSelected(); break;
      case "KeyX": this.sellSelected(); break;
      case "KeyP": this.toPaused(); break;
      case "Escape":
        if (this.armed) this.disarm();
        else if (this.selected) this.selected = null;
        else this.toPaused();
        break;
      default: break;
    }
  }

  // --- Headless drive hooks (screenshot proofs) --------------------------

  /** Test hook: jump straight into a live match. */
  debugStartMatch(): void { this.enterMatch(); }
  /** Test hook: arm a build type as if the palette entry were clicked. */
  debugArm(type: BuildStructureType): void { this.arm(type); }
  /** Test hook: place the armed (or given) type on a grid cell. */
  debugPlace(type: BuildStructureType, col: number, row: number): boolean {
    return this.match ? this.match.world.place("player", type, col, row) !== null : false;
  }
  /** Test hook: select the friendly structure occupying a grid cell. */
  debugSelectCell(col: number, row: number): void {
    if (!this.match) return;
    const s = this.match.world.structureAt("player", col, row);
    this.selected = s ? { kind: "structure", id: s.id } : null;
  }
  /** Test hook: open the pause menu. */
  debugPause(): void { this.toPaused(); }
  /** Test hook: the live match (for headless proof + performance drives), or null. */
  get liveMatch(): Match | null { return this.match; }
  /** Test hook: force the match to end for a side. */
  debugEndMatch(winner: "player" | "enemy"): void {
    if (!this.match) return;
    this.match.world.result = winner;
    this.match.world.waveNumber = Math.max(this.match.world.waveNumber, 1);
    this.toMatchOver();
  }
  /** The current state (for tests). */
  get currentState(): GameState { return this.state; }
}

/** Keyboard shortcut -> build type (specs/flow.md: 1-9, 0 = tenth unit, E = Extractor). */
const SHORTCUTS: Record<string, BuildStructureType | undefined> = {
  Digit1: BUILD_PALETTE_ORDER[0], Digit2: BUILD_PALETTE_ORDER[1], Digit3: BUILD_PALETTE_ORDER[2],
  Digit4: BUILD_PALETTE_ORDER[3], Digit5: BUILD_PALETTE_ORDER[4], Digit6: BUILD_PALETTE_ORDER[5],
  Digit7: BUILD_PALETTE_ORDER[6], Digit8: BUILD_PALETTE_ORDER[7], Digit9: BUILD_PALETTE_ORDER[8],
  Digit0: BUILD_PALETTE_ORDER[9], KeyE: "solar-extractor",
};
