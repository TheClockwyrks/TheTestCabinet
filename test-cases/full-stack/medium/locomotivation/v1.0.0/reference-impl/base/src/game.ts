// Locomotivation — the game orchestrator: state machine + fixed-timestep loop.
//
// Owns the screen state machine (title → level select → playing → results → victory,
// specs/flow.md), drives the deterministic core sim (sim/step.ts) on a fixed accumulator
// decoupled from the render frame rate (specs/controls.md), drains the sim's events to the
// produced audio (audio.ts) and particle VFX (particles.ts), and renders the yard
// (render.ts) + HUD (hud.ts) and every menu. The core sim stays pure; this module holds the
// wall-clock/RAF, rendering, audio, and navigation.

import {
  DT,
  FONT_STACK,
  LOW_CLOCK_THRESHOLD,
  MAX_FRAME_DT,
  PALETTE,
  STAGE_H,
  STAGE_W,
  VIEW_H,
  VIEW_Y,
} from "./constants";
import { LEVELS } from "./levels";
import { buildWorld, tileCenter, type SimEvent, type SimState } from "./sim/world";
import { stepSim } from "./sim/step";
import { drawWorld } from "./render";
import { drawHud } from "./hud";
import { Input, type MenuAction } from "./input";
import { AudioEngine } from "./audio";
import { Particles } from "./particles";
import { anyApproaching, computeSignalStates, nearestTrainProximity } from "./telegraph";
import type { GameAssets } from "./assets";

export type GameScreen =
  | "title"
  | "level-select"
  | "how-to-play"
  | "playing"
  | "pause"
  | "level-complete"
  | "level-failed"
  | "victory";

const MENUS: Partial<Record<GameScreen, string[]>> = {
  title: ["PLAY", "HOW TO PLAY"],
  "how-to-play": ["BACK"],
  pause: ["RESUME", "RESTART LEVEL", "QUIT TO MENU"],
  "level-complete": ["NEXT", "MENU"],
  "level-failed": ["RETRY", "MENU"],
  victory: ["PLAY AGAIN", "MENU"],
};

export class Game {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly assets: GameAssets;
  private readonly input = new Input();
  private readonly audio: AudioEngine;
  private readonly particles: Particles;

  private screen: GameScreen = "title";
  private sim: SimState | null = null;
  private levelIndex = 0;
  private menuIndex = 0;
  /** Highest unlocked level (0-based) and best score per completed level. */
  private unlocked = 0;
  private readonly bestScores: number[] = [];

  private accumulator = 0;
  private lastTime = 0;
  private running = false;
  private wallTime = 0; // seconds since boot, for menu animation only

  // Telegraph-audio edge tracking.
  private prevApproaching = false;
  private alarmTimer = 0;

  constructor(ctx: CanvasRenderingContext2D, assets: GameAssets) {
    this.ctx = ctx;
    this.assets = assets;
    this.audio = new AudioEngine(assets.audio);
    this.particles = new Particles(assets.systems);
  }

  /** Attach input and begin the RAF loop. */
  start(): void {
    this.input.attach(window);
    this.input.setFirstInputHandler(() => void this.audio.resume());
    this.installDevHooks();
    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame(this.loop);
  }

  // ─── Level lifecycle ──────────────────────────────────────────────────────────────

  /** Enter a campaign level by index, building a fresh deterministic world. */
  private enterLevel(index: number): void {
    this.levelIndex = index;
    this.sim = buildWorld(LEVELS[index]);
    this.screen = "playing";
    this.menuIndex = 0;
    this.accumulator = 0;
    this.prevApproaching = false;
    this.alarmTimer = 0;
    this.particles.clear();
    this.audio.startLoop("music");
    this.audio.startLoop("rumble");
    this.audio.setLoopGain("rumble", 0);
  }

  private leavePlay(): void {
    this.audio.stopLoop("rumble");
  }

  private toMenu(): void {
    this.leavePlay();
    this.audio.stopLoop("music");
    this.screen = "level-select";
    this.menuIndex = Math.min(this.levelIndex, this.unlocked);
  }

  private onWin(): void {
    this.leavePlay();
    const s = this.sim!;
    this.bestScores[this.levelIndex] = Math.max(this.bestScores[this.levelIndex] ?? 0, s.score);
    if (this.levelIndex + 1 < LEVELS.length) {
      this.unlocked = Math.max(this.unlocked, this.levelIndex + 1);
      this.screen = "level-complete";
    } else {
      this.screen = "victory";
    }
    this.menuIndex = 0;
    this.audio.play("confirm");
  }

  private onLoss(): void {
    this.leavePlay();
    this.screen = "level-failed";
    this.menuIndex = 0;
  }

  // ─── The loop ─────────────────────────────────────────────────────────────────────

  private readonly loop = (now: number): void => {
    if (!this.running) return;
    let frameDt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (frameDt > MAX_FRAME_DT) frameDt = MAX_FRAME_DT;
    this.wallTime += frameDt;

    this.accumulator += frameDt;
    while (this.accumulator >= DT) {
      this.update(DT);
      this.accumulator -= DT;
    }
    this.render();
    requestAnimationFrame(this.loop);
  };

  /** One fixed simulation step of whatever screen is active. */
  private update(dt: number): void {
    for (const action of this.input.drainMenuActions()) this.handleMenuAction(action);

    if (this.screen !== "playing" || !this.sim) {
      this.input.sampleNeutral(); // keep press edges from leaking into the next level
      return;
    }

    const sim = this.sim;
    const live = sim.phase === "playing";
    const input = live ? this.input.sample() : this.input.sampleNeutral();
    stepSim(sim, input, dt);
    this.particles.update(dt);
    this.drainEvents(sim.events);
    this.updateTelegraphAudio(sim, dt);

    if (sim.phase === "won") this.onWin();
    else if (sim.phase === "lost") this.onLoss();
  }

  // ─── Menu navigation ──────────────────────────────────────────────────────────────

  private menuItems(): string[] {
    if (this.screen === "level-select") return LEVELS.map((l) => l.name);
    return MENUS[this.screen] ?? [];
  }

  private handleMenuAction(action: MenuAction): void {
    if (action === "mute") {
      this.audio.toggleMute();
      return;
    }

    if (this.screen === "playing") {
      if (action === "pause") {
        this.screen = "pause";
        this.menuIndex = 0;
      }
      return; // gameplay keys are handled by the sim sample
    }

    const items = this.menuItems();
    const count = Math.max(1, items.length);
    switch (action) {
      case "up":
        this.menuIndex = (this.menuIndex + count - 1) % count;
        return;
      case "down":
        this.menuIndex = (this.menuIndex + 1) % count;
        return;
      case "left":
      case "right":
        if (this.screen === "level-select") {
          const step = action === "right" ? 1 : -1;
          this.menuIndex = (this.menuIndex + count + step) % count;
        }
        return;
      case "confirm":
        this.confirmMenu();
        return;
      case "pause":
        this.backOut();
        return;
    }
  }

  private confirmMenu(): void {
    switch (this.screen) {
      case "title":
        if (this.menuIndex === 0) {
          this.screen = "level-select";
          this.menuIndex = Math.min(this.unlocked, LEVELS.length - 1);
        } else {
          this.screen = "how-to-play";
          this.menuIndex = 0;
        }
        return;
      case "how-to-play":
        this.screen = "title";
        this.menuIndex = 0;
        return;
      case "level-select": {
        if (this.menuIndex <= this.unlocked) this.enterLevel(this.menuIndex);
        return;
      }
      case "pause":
        if (this.menuIndex === 0) this.screen = "playing";
        else if (this.menuIndex === 1) this.enterLevel(this.levelIndex);
        else this.toMenu();
        return;
      case "level-complete":
        if (this.menuIndex === 0) this.enterLevel(Math.min(this.levelIndex + 1, LEVELS.length - 1));
        else this.toMenu();
        return;
      case "level-failed":
        if (this.menuIndex === 0) this.enterLevel(this.levelIndex);
        else this.toMenu();
        return;
      case "victory":
        if (this.menuIndex === 0) {
          this.unlocked = Math.max(this.unlocked, 0);
          this.enterLevel(0);
        } else this.toMenu();
        return;
    }
  }

  private backOut(): void {
    switch (this.screen) {
      case "level-select":
      case "how-to-play":
        this.screen = "title";
        this.menuIndex = 0;
        return;
      case "pause":
        this.screen = "playing";
        return;
      case "level-complete":
      case "level-failed":
      case "victory":
        this.toMenu();
        return;
    }
  }

  // ─── Event → audio + particles ──────────────────────────────────────────────────────

  private drainEvents(events: SimEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case "pickup":
          this.audio.play("pickup");
          break;
        case "denied":
          this.audio.play("pickup", 0.4);
          break;
        case "deliver":
          this.audio.play("delivery");
          this.particles.spawn({ kind: "delivery-burst", x: e.pos.x, y: e.pos.y - 8, scale: 1.1 });
          break;
        case "drop":
          this.audio.play("pickup", 0.5);
          break;
        case "cargo-destroyed":
          this.audio.play("impact", 0.8);
          this.particles.spawn({ kind: "cargo-splinter", x: e.pos.x, y: e.pos.y, scale: 1.1 });
          break;
        case "death":
          this.audio.play("impact");
          this.particles.spawn({ kind: "worker-squish", x: e.pos.x, y: e.pos.y, scale: 1.2 });
          break;
        case "board":
          this.audio.play("whistle");
          break;
        case "lever":
          this.audio.play("confirm", 0.7);
          this.particles.spawn({ kind: "signal-spark", x: e.pos.x, y: e.pos.y - 12 });
          break;
        case "quota-complete":
          this.audio.play("confirm");
          break;
        case "last-train":
          this.audio.play("whistle");
          this.particles.spawn({ kind: "last-train-smoke", x: e.pos.x, y: e.pos.y - 10, scale: 1.4 });
          break;
        case "footstep":
          this.audio.play("footstep", 0.6);
          this.particles.spawn({ kind: "footstep-dust", x: e.pos.x, y: e.pos.y, scale: 0.9 });
          break;
        case "near-miss":
          this.audio.play("horn", 0.4);
          break;
      }
    }
  }

  /** Rising-rumble + horn telegraph, and the low-clock alarm (specs/trains.md, flow.md). */
  private updateTelegraphAudio(sim: SimState, dt: number): void {
    if (sim.phase !== "playing" && sim.phase !== "boarding") {
      this.audio.setLoopGain("rumble", 0);
      return;
    }
    const prox = nearestTrainProximity(sim);
    this.audio.setLoopGain("rumble", prox);

    const states = computeSignalStates(sim);
    const approaching = anyApproaching(states);
    if (approaching && !this.prevApproaching) this.audio.play("horn");
    this.prevApproaching = approaching;

    this.alarmTimer -= dt;
    if (sim.clock <= LOW_CLOCK_THRESHOLD && sim.clock > 0 && this.alarmTimer <= 0) {
      this.audio.play("alarm");
      this.alarmTimer = 1.0;
    }
  }

  // ─── Rendering ──────────────────────────────────────────────────────────────────────

  private render(): void {
    const { ctx } = this;
    ctx.fillStyle = PALETTE.letterbox;
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);

    switch (this.screen) {
      case "playing":
        this.renderPlay();
        break;
      case "pause":
        this.renderPlay();
        this.renderPauseOverlay();
        break;
      case "title":
        this.renderTitle();
        break;
      case "level-select":
        this.renderLevelSelect();
        break;
      case "how-to-play":
        this.renderHowTo();
        break;
      case "level-complete":
        this.renderPlayFrozen();
        this.renderResult("SHIFT COMPLETE", PALETTE.signalClear, true);
        break;
      case "level-failed":
        this.renderPlayFrozen();
        this.renderResult("SHIFT FAILED", PALETTE.signalDanger, false);
        break;
      case "victory":
        this.renderVictory();
        break;
    }
  }

  private renderPlay(): void {
    if (!this.sim) return;
    drawWorld(this.ctx, this.sim, this.assets);
    this.particles.draw(this.ctx);
    drawHud(this.ctx, this.sim, this.audio.isMuted, this.assets);
  }

  private renderPlayFrozen(): void {
    this.renderPlay();
    // Darken the frozen yard behind the result panel.
    this.ctx.fillStyle = "#0d0f12aa";
    this.ctx.fillRect(0, VIEW_Y, STAGE_W, VIEW_H);
  }

  // ─── Screens ────────────────────────────────────────────────────────────────────────

  private renderTitle(): void {
    const ctx = this.ctx;
    // Backdrop rails.
    ctx.fillStyle = PALETTE.panel;
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);
    this.decorRails();

    ctx.textAlign = "center";
    ctx.fillStyle = PALETTE.workerHiVis;
    ctx.font = `bold 84px ${FONT_STACK}`;
    ctx.fillText("LOCOMOTIVATION", STAGE_W / 2, 250);
    ctx.font = `18px ${FONT_STACK}`;
    ctx.fillStyle = PALETTE.textSecondary;
    ctx.fillText("Haul the freight. Beat the trains.", STAGE_W / 2, 292);

    this.drawMenu(["PLAY", "HOW TO PLAY"], 400, 46);
    this.drawFooter("↑/↓ or W/S to choose · ENTER to confirm · M to mute");
    ctx.textAlign = "left";
  }

  private renderLevelSelect(): void {
    const ctx = this.ctx;
    ctx.fillStyle = PALETTE.panel;
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);
    ctx.textAlign = "center";
    ctx.fillStyle = PALETTE.textPrimary;
    ctx.font = `bold 40px ${FONT_STACK}`;
    ctx.fillText("SELECT SHIFT", STAGE_W / 2, 110);

    const cols = 3;
    const cardW = 300;
    const cardH = 150;
    const gapX = 40;
    const gapY = 36;
    const totalW = cols * cardW + (cols - 1) * gapX;
    const x0 = (STAGE_W - totalW) / 2;
    const y0 = 170;

    LEVELS.forEach((lvl, i) => {
      const cx = x0 + (i % cols) * (cardW + gapX);
      const cy = y0 + Math.floor(i / cols) * (cardH + gapY);
      const locked = i > this.unlocked;
      const selected = i === this.menuIndex;
      ctx.fillStyle = locked ? "#12151a" : "#1d222a";
      ctx.fillRect(cx, cy, cardW, cardH);
      ctx.lineWidth = selected ? 4 : 2;
      ctx.strokeStyle = selected ? PALETTE.workerHiVis : "#2c323b";
      ctx.strokeRect(cx, cy, cardW, cardH);

      ctx.textAlign = "left";
      ctx.fillStyle = locked ? PALETTE.textTertiary : PALETTE.textPrimary;
      ctx.font = `bold 22px ${FONT_STACK}`;
      ctx.fillText(`${i + 1}. ${lvl.name}`, cx + 18, cy + 40);
      ctx.font = `13px ${FONT_STACK}`;
      ctx.fillStyle = PALETTE.textSecondary;
      ctx.fillText(`Clock ${lvl.clock}s · ${describeQuota(lvl)}`, cx + 18, cy + 68);
      if (lvl.lastTrain) {
        ctx.fillStyle = PALETTE.score;
        ctx.fillText("★ Last train bonus", cx + 18, cy + 92);
      }
      const best = this.bestScores[i];
      if (best !== undefined) {
        ctx.fillStyle = PALETTE.score;
        ctx.font = `bold 14px ${FONT_STACK}`;
        ctx.fillText(`BEST ${best}`, cx + 18, cy + cardH - 16);
      }
      if (locked) {
        ctx.fillStyle = PALETTE.textTertiary;
        ctx.textAlign = "right";
        ctx.font = `12px ${FONT_STACK}`;
        ctx.fillText("LOCKED", cx + cardW - 14, cy + cardH - 16);
      }
      ctx.textAlign = "left";
    });

    ctx.textAlign = "center";
    this.drawFooter("←/→/↑/↓ to choose · ENTER to play · ESC to go back");
    ctx.textAlign = "left";
  }

  private renderHowTo(): void {
    const ctx = this.ctx;
    ctx.fillStyle = PALETTE.panel;
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);
    ctx.textAlign = "center";
    ctx.fillStyle = PALETTE.textPrimary;
    ctx.font = `bold 40px ${FONT_STACK}`;
    ctx.fillText("HOW TO PLAY", STAGE_W / 2, 96);

    const lines = [
      ["MOVE", "W A S D or Arrow keys — crisp cardinal movement, no sliding."],
      ["SPRINT", "Hold Shift — a short recharging burst; locked out over 80% load."],
      ["PICK UP / LEVER", "E or Space — lift a package or throw an adjacent junction lever."],
      ["DROP", "Q — set down your most-recent package (the emergency valve)."],
      ["DELIVER", "Walk carried freight into its matching-color drop zone (automatic)."],
      ["TRAINS KILL", "Any contact with any car — sides included — is instantly lethal."],
      ["CARGO ON RAILS", "A package left on a track is smashed by the next train."],
      ["THE LOAD", "Heavier freight slows you; past 80% you crawl and lose sprint."],
      ["THE SHIFT", "Meet the quota before the clock runs out. You have 3 lives."],
      ["UNIQUE FREIGHT", "Losing a one-of-a-kind package fails the shift immediately."],
      ["LAST TRAIN", "When offered, board a flat-top car as the shift ends for a bonus."],
      ["PAUSE / MUTE", "Esc pauses · M mutes all audio."],
    ];
    ctx.textAlign = "left";
    let y = 150;
    for (const [k, v] of lines) {
      ctx.font = `bold 15px ${FONT_STACK}`;
      ctx.fillStyle = PALETTE.workerHiVis;
      ctx.fillText(k, 150, y);
      ctx.font = `15px ${FONT_STACK}`;
      ctx.fillStyle = PALETTE.textSecondary;
      ctx.fillText(v, 360, y);
      y += 38;
    }
    ctx.textAlign = "center";
    this.drawFooter("ENTER or ESC to go back");
    ctx.textAlign = "left";
  }

  private renderPauseOverlay(): void {
    const ctx = this.ctx;
    ctx.fillStyle = "#0d0f12cc";
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);
    ctx.textAlign = "center";
    ctx.fillStyle = PALETTE.textPrimary;
    ctx.font = `bold 48px ${FONT_STACK}`;
    ctx.fillText("PAUSED", STAGE_W / 2, 250);
    this.drawMenu(MENUS.pause!, 340, 44);
    this.drawFooter(`M toggles mute (${this.audio.isMuted ? "MUTED" : "on"})`);
    ctx.textAlign = "left";
  }

  private renderResult(title: string, color: string, complete: boolean): void {
    const ctx = this.ctx;
    const sim = this.sim;
    ctx.textAlign = "center";
    ctx.fillStyle = color;
    ctx.font = `bold 56px ${FONT_STACK}`;
    ctx.fillText(title, STAGE_W / 2, 180);

    if (sim && !complete && sim.failReason) {
      const reason =
        sim.failReason === "out-of-time"
          ? "Out of time — the quota was not met."
          : sim.failReason === "out-of-lives"
            ? "Out of lives — three deaths under the trains."
            : "A unique package was lost.";
      ctx.font = `18px ${FONT_STACK}`;
      ctx.fillStyle = PALETTE.textSecondary;
      ctx.fillText(reason, STAGE_W / 2, 220);
    }

    if (sim) {
      const p = sim.scoreParts;
      const rows: [string, number][] = [
        ["Required deliveries", p.required],
        ["Optional deliveries", p.optional],
        ["Near-miss bonus", p.nearMiss],
        ["Last-train bonus", p.lastTrain],
        ["Time bonus", p.time],
        ["Lives bonus", p.lives],
      ];
      let y = 280;
      ctx.font = `18px ${FONT_STACK}`;
      for (const [label, val] of rows) {
        ctx.textAlign = "left";
        ctx.fillStyle = PALETTE.textSecondary;
        ctx.fillText(label, STAGE_W / 2 - 200, y);
        ctx.textAlign = "right";
        ctx.fillStyle = val > 0 ? PALETTE.textPrimary : PALETTE.textTertiary;
        ctx.fillText(`${val}`, STAGE_W / 2 + 200, y);
        y += 30;
      }
      ctx.textAlign = "left";
      ctx.fillStyle = PALETTE.score;
      ctx.font = `bold 24px ${FONT_STACK}`;
      ctx.fillText("TOTAL", STAGE_W / 2 - 200, y + 14);
      ctx.textAlign = "right";
      ctx.fillText(`${sim.score}`, STAGE_W / 2 + 200, y + 14);
    }

    ctx.textAlign = "center";
    this.drawMenu(complete ? MENUS["level-complete"]! : MENUS["level-failed"]!, 560, 42);
    ctx.textAlign = "left";
  }

  private renderVictory(): void {
    const ctx = this.ctx;
    ctx.fillStyle = PALETTE.panel;
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);
    this.decorRails();
    ctx.textAlign = "center";
    ctx.fillStyle = PALETTE.workerHiVis;
    ctx.font = `bold 64px ${FONT_STACK}`;
    ctx.fillText("SHIFT'S OVER", STAGE_W / 2, 150);
    ctx.font = `20px ${FONT_STACK}`;
    ctx.fillStyle = PALETTE.textSecondary;
    ctx.fillText("You cleared every shift in the yard.", STAGE_W / 2, 190);

    let total = 0;
    let y = 250;
    ctx.font = `18px ${FONT_STACK}`;
    LEVELS.forEach((lvl, i) => {
      const best = this.bestScores[i] ?? 0;
      total += best;
      ctx.textAlign = "left";
      ctx.fillStyle = PALETTE.textSecondary;
      ctx.fillText(`${i + 1}. ${lvl.name}`, STAGE_W / 2 - 220, y);
      ctx.textAlign = "right";
      ctx.fillStyle = PALETTE.textPrimary;
      ctx.fillText(`${best}`, STAGE_W / 2 + 220, y);
      y += 30;
    });
    ctx.textAlign = "left";
    ctx.fillStyle = PALETTE.score;
    ctx.font = `bold 26px ${FONT_STACK}`;
    ctx.fillText("CAMPAIGN TOTAL", STAGE_W / 2 - 220, y + 20);
    ctx.textAlign = "right";
    ctx.fillText(`${total}`, STAGE_W / 2 + 220, y + 20);

    ctx.textAlign = "center";
    this.drawMenu(MENUS.victory!, y + 80, 42);
    ctx.textAlign = "left";
  }

  // ─── Menu / decoration helpers ────────────────────────────────────────────────────

  private drawMenu(items: string[], y0: number, gap: number): void {
    const ctx = this.ctx;
    ctx.textAlign = "center";
    items.forEach((label, i) => {
      const selected = i === this.menuIndex;
      const y = y0 + i * gap;
      if (selected) {
        ctx.fillStyle = PALETTE.workerHiVis;
        ctx.font = `bold 26px ${FONT_STACK}`;
        ctx.fillText(`▶ ${label} ◀`, STAGE_W / 2, y);
      } else {
        ctx.fillStyle = PALETTE.textSecondary;
        ctx.font = `24px ${FONT_STACK}`;
        ctx.fillText(label, STAGE_W / 2, y);
      }
    });
  }

  private drawFooter(text: string): void {
    const ctx = this.ctx;
    ctx.textAlign = "center";
    ctx.font = `13px ${FONT_STACK}`;
    ctx.fillStyle = PALETTE.textTertiary;
    ctx.fillText(text, STAGE_W / 2, STAGE_H - 40);
  }

  private decorRails(): void {
    // A few faint sleepers-and-rails bands for atmosphere on menu screens.
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = 0.25;
    for (const y of [90, STAGE_H - 120]) {
      ctx.fillStyle = PALETTE.ballast;
      ctx.fillRect(0, y, STAGE_W, 34);
      ctx.fillStyle = PALETTE.sleeper;
      for (let x = 0; x < STAGE_W; x += 24) ctx.fillRect(x, y + 3, 12, 28);
      ctx.fillStyle = PALETTE.rail;
      ctx.fillRect(0, y + 9, STAGE_W, 3);
      ctx.fillRect(0, y + 24, STAGE_W, 3);
    }
    ctx.restore();
  }

  // ─── Dev hooks for later capture (no proof media produced here) ─────────────────────

  private installDevHooks(): void {
    const api = {
      jumpToLevel: (n: number) => {
        const idx = Math.max(0, Math.min(LEVELS.length - 1, n - 1));
        this.unlocked = Math.max(this.unlocked, idx);
        this.enterLevel(idx);
      },
      setWorkerTile: (col: number, row: number) => {
        if (this.sim) this.sim.worker.pos = tileCenter({ col, row });
      },
      fundQuota: () => {
        const s = this.sim;
        if (!s) return;
        for (const u of s.level.uniques) s.uniquesDelivered[u.id] = true;
        for (const q of s.level.quota) s.delivered[q.color] = Math.max(s.delivered[q.color], q.required);
      },
      forceLastTrain: () => {
        const s = this.sim;
        if (!s || !s.level.lastTrain) return;
        s.lastTrainSpawnTime = s.time;
        s.lastTrainSpawned = false;
      },
      win: () => {
        if (this.sim) this.sim.phase = "won";
      },
      state: () => this.sim,
    };
    (window as unknown as { __loco?: typeof api }).__loco = api;
  }
}

// ─── Level-select summary ──────────────────────────────────────────────────────────────

function describeQuota(lvl: SimState["level"]): string {
  return lvl.quota.map((q) => `${q.required} ${q.color}`).join(" · ");
}
