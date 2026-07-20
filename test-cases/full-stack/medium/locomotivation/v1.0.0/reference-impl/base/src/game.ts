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
  TRAIN_HALF_BAND,
  VIEW_H,
  VIEW_W,
  VIEW_Y,
} from "./constants";
import { LEVELS } from "./levels";
import {
  buildWorld,
  consistLength,
  nominalTrainLength,
  tileCenter,
  trainBody,
  trainSpeed,
  type Facing,
  type GroundPackage,
  type PackageInstance,
  type SimEvent,
  type SimState,
  type TrainInstance,
} from "./sim/world";
import { currentLoad, currentSpeed, loadFraction, sprintLocked, stepSim } from "./sim/step";
import { drawWorld } from "./render";
import { drawHud } from "./hud";
import { Input, type MenuAction } from "./input";
import { AudioEngine } from "./audio";
import { Particles } from "./particles";
import { anyApproaching, computeSignalStates, nearestTrainProximity, signalStateFor } from "./telegraph";
import type { GameAssets } from "./assets";
import type {
  FreightColor,
  LastTrainCar,
  Orientation,
  PackageArchetype,
  TrainDir,
  TrainKind,
  WeightClass,
} from "./types";

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

  // ─── Debug / automation state (see debug.ts; inert during normal play) ───────────────
  /**
   * The manual-clock flag (specs/instrumentation.md). True (the default) is normal human
   * play: the animation-frame loop advances the sim from the wall clock. False is a
   * driver-clocked session: the loop still renders every frame but the only thing that
   * advances the sim is an explicit `fixedStep()`. `debugReset()`/`debugStep()` re-arm
   * manual; `setAutoStep(true)` resumes live.
   */
  private autoStep = true;
  /** When on, `render()` draws the read-only debug overlay. Toggled with backtick. */
  private debugOverlay = false;
  /** Monotonic id source for debug-spawned packages/trains, so ids stay unique. */
  private debugSerial = 0;

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

    // Menu/UI input is drained every frame regardless of the clock, so injected menu
    // presses (and pause/mute) work whether the sim is running live or manually stepped.
    this.pumpFrameInput();

    // The sim advances from the wall clock only while running live (autoStep). In a
    // driver-clocked session (autoStep false) the loop renders but does not advance the
    // sim — an explicit fixedStep() is then the sole way it moves (specs/instrumentation.md).
    if (this.autoStep) {
      this.accumulator += frameDt;
      while (this.accumulator >= DT) {
        this.fixedStep(DT);
        this.accumulator -= DT;
      }
    }

    this.render();
    requestAnimationFrame(this.loop);
  };

  /**
   * Drain the queued menu actions (navigation, confirm, pause, mute) and apply them at
   * once. Called every frame by the loop and synchronously by the debug key injector, so a
   * one-shot menu action takes effect without waiting on a render frame. Off the playfield
   * it also clears the gameplay press edges so they never leak into the next level.
   */
  private pumpFrameInput(): void {
    const wasPlaying = this.screen === "playing";
    for (const action of this.input.drainMenuActions()) this.handleMenuAction(action);
    if (!wasPlaying) this.input.sampleNeutral();
  }

  /**
   * One fixed simulation step of the live level. This is the single point the sim advances:
   * the wall-clock loop calls it while running live, and the debug `step()` calls it
   * directly while driver-clocked. It has no effect off the playfield or while paused, so a
   * stepped scenario is exact and reproducible (specs/instrumentation.md).
   */
  fixedStep(dt: number): void {
    if (this.screen !== "playing" || !this.sim) return;

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

    if (this.debugOverlay) this.renderDebugOverlay();
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

  // ─── Debug / automation surface (used by debug.ts; inert in normal play) ─────────────
  //
  // Each control method routes through the same state and systems normal play uses — it
  // sets up a situation and never fabricates an outcome. After arranging a scenario, a
  // `fixedStep()` runs the real movement, trains, cargo, collision, clock, and win/fail
  // code forward, and `debugSnapshot()` (or the rendered canvas) reads the result. See
  // specs/instrumentation.md.

  /** Toggle the read-only debug overlay (the backtick affordance). Never touches gameplay. */
  toggleDebugOverlay(): void {
    this.debugOverlay = !this.debugOverlay;
  }

  /**
   * Apply any pending menu/UI input at once (used by the debug key injector so an injected
   * one-shot menu action takes effect immediately, without waiting on a render frame).
   */
  pumpInput(): void {
    this.pumpFrameInput();
  }

  /** Run the game live from the wall clock again (true) or return to manual stepping (false). */
  setAutoStep(enabled: boolean): void {
    this.autoStep = enabled;
    if (enabled) {
      // Resume live cleanly: discard any leftover accumulator so the sim does not lurch.
      this.lastTime = performance.now();
      this.accumulator = 0;
    }
  }

  /** Return to the initial title state and re-arm manual stepping. Seeds all randomness. */
  debugReset(seed?: number): void {
    // The base build is fully deterministic and uses no randomness, so the seed is accepted
    // and has no effect; a variant with a seeded generator would reseed it here.
    void seed;
    this.leavePlay();
    this.audio.stopLoop("music");
    this.sim = null;
    this.screen = "title";
    this.levelIndex = 0;
    this.menuIndex = 0;
    this.unlocked = 0;
    this.bestScores.length = 0;
    this.accumulator = 0;
    this.prevApproaching = false;
    this.alarmTimer = 0;
    this.particles.clear();
    this.autoStep = false;
  }

  /** Enter campaign level `n` (1-based), unlocking it if needed, exactly as the menu would. */
  debugStartLevel(n: number): void {
    const idx = Math.max(0, Math.min(LEVELS.length - 1, Math.round(n) - 1));
    this.unlocked = Math.max(this.unlocked, idx);
    this.enterLevel(idx);
  }

  /** Pose the worker through the same position the movement/collision systems read. */
  debugSetWorker(state: { col?: number; row?: number; x?: number; y?: number; facing?: Facing }): void {
    const s = this.sim;
    if (!s) return;
    const w = s.worker;
    if (state.col !== undefined && state.row !== undefined) {
      w.pos = tileCenter({ col: state.col, row: state.row });
    } else {
      if (state.x !== undefined) w.pos.x = state.x;
      if (state.y !== undefined) w.pos.y = state.y;
    }
    if (state.facing) w.facing = state.facing;
  }

  /** Set the shift clock remaining as a precondition; the real win/fail rules still resolve. */
  debugSetClock(seconds: number): void {
    if (this.sim) this.sim.clock = Math.max(0, seconds);
  }

  /** Set the remaining lives as a precondition. */
  debugSetLives(n: number): void {
    if (this.sim) this.sim.lives = Math.max(0, Math.round(n));
  }

  /** Set the delivered count toward a color's quota, as a partial-progress precondition. */
  debugSetDelivered(color: FreightColor, count: number): void {
    const s = this.sim;
    if (!s) return;
    s.delivered[color] = Math.max(0, Math.round(count));
  }

  /** Set a unique package's delivered flag, as a precondition on a multi-unique level. */
  debugMarkUnique(id: string, delivered: boolean): void {
    const s = this.sim;
    if (!s || !(id in s.uniquesDelivered)) return;
    s.uniquesDelivered[id] = delivered;
  }

  /** Put a package directly into the worker's carried set, arranging a load for a scenario. */
  debugGivePackage(spec: { color: FreightColor; weightClass: WeightClass; archetype?: PackageArchetype }): void {
    const s = this.sim;
    if (!s) return;
    const archetype = spec.archetype ?? "dispenser";
    const pkg: PackageInstance = {
      id: `debug#${this.debugSerial++}`,
      color: spec.color,
      weightClass: spec.weightClass,
      archetype,
      originId: `debug-${spec.color}`,
    };
    s.worker.carried.push(pkg);
  }

  /** Empty the worker's carried set, as a precondition reset. */
  debugClearCarried(): void {
    if (this.sim) this.sim.worker.carried = [];
  }

  /** Place a package resting on a tile, joining the same ground cargo the world holds. */
  debugSpawnGroundPackage(spec: {
    col: number;
    row: number;
    color: FreightColor;
    weightClass: WeightClass;
    archetype?: PackageArchetype;
  }): void {
    const s = this.sim;
    if (!s) return;
    const archetype = spec.archetype ?? "optional";
    const at = { col: spec.col, row: spec.row };
    const gp: GroundPackage = {
      pkg: {
        id: `debug#${this.debugSerial++}`,
        color: spec.color,
        weightClass: spec.weightClass,
        archetype,
        originId: `debug-${spec.color}`,
      },
      at,
      pos: tileCenter(at),
    };
    s.ground.push(gp);
  }

  /** Put a train onto a lane now, as a precondition; it then runs through the real train code. */
  debugSpawnTrain(spec: {
    line: number;
    orientation: Orientation;
    dir: TrainDir;
    kind: TrainKind;
    headPos?: number;
    isLast?: boolean;
    consist?: LastTrainCar[];
  }): void {
    const s = this.sim;
    if (!s) return;
    const isLast = Boolean(spec.isLast);
    const consist = isLast ? spec.consist ?? ["engine"] : undefined;
    const length = isLast && consist ? consistLength(spec.kind, consist) : nominalTrainLength(spec.kind);
    const train: TrainInstance = {
      trackId: isLast ? "LAST" : `debug-${this.debugSerial++}`,
      kind: spec.kind,
      orientation: spec.orientation,
      line: spec.line,
      dir: spec.dir,
      headPos: spec.headPos ?? 0,
      length,
      speed: trainSpeed(spec.kind),
      serial: 0,
      isLast: isLast || undefined,
      consist,
    };
    s.trains.push(train);
  }

  /** Bring the level's derived last train on now, so a scenario need not wait out the clock. */
  debugForceLastTrain(): void {
    const s = this.sim;
    if (!s || !s.level.lastTrain) return;
    s.lastTrainSpawnTime = s.time;
    s.lastTrainSpawned = false;
  }

  /** A pure read of the full observable state, shared by the debug API and the overlay. */
  debugSnapshot(): LocoSnapshot {
    const pureMenu =
      this.screen === "title" || this.screen === "level-select" || this.screen === "how-to-play";
    const s = pureMenu ? null : this.sim;

    const campaign = {
      levelCount: LEVELS.length,
      unlocked: this.unlocked,
      bestScores: Array.from({ length: LEVELS.length }, (_, i) => this.bestScores[i] ?? 0),
    };

    if (!s) {
      return {
        version: 1,
        screen: this.screen,
        phase: null,
        muted: this.audio.isMuted,
        autoStep: this.autoStep,
        simTime: 0,
        campaign,
        level: null,
        worker: null,
        trains: [],
        ground: [],
        dispensers: [],
        dropZones: [],
        levers: [],
        signals: [],
        quota: [],
        uniques: [],
      };
    }

    const w = s.worker;
    const load = currentLoad(w);
    const frac = loadFraction(load);

    return {
      version: 1,
      screen: this.screen,
      phase: s.phase,
      muted: this.audio.isMuted,
      autoStep: this.autoStep,
      simTime: s.time,
      campaign,
      level: {
        index: this.levelIndex,
        number: this.levelIndex + 1,
        name: s.level.name,
        clock: s.clock,
        lives: s.lives,
        quotaMet: s.quotaMet,
        failReason: s.failReason ?? null,
        score: s.score,
        scoreParts: { ...s.scoreParts },
        nearMisses: s.nearMisses,
        optionalsDelivered: s.optionalsDelivered,
      },
      worker: {
        x: w.pos.x,
        y: w.pos.y,
        facing: w.facing,
        anim: w.anim,
        moving: w.moving,
        sprinting: w.sprinting,
        sprintCharge: w.sprintCharge,
        sprintLocked: sprintLocked(frac),
        load,
        loadFraction: frac,
        speed: currentSpeed(w),
        carried: w.carried.map((p) => ({
          color: p.color,
          weightClass: p.weightClass,
          archetype: p.archetype,
        })),
      },
      trains: s.trains.map((t) => {
        const box = trainBody(t, VIEW_W, VIEW_H, TRAIN_HALF_BAND);
        const out: TrainSnapshot = {
          trackId: t.trackId,
          kind: t.kind,
          orientation: t.orientation,
          dir: t.dir,
          line: t.line,
          headPos: t.headPos,
          length: t.length,
          speed: t.speed,
          isLast: Boolean(t.isLast),
          box: { x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 },
        };
        if (t.consist) out.consist = [...t.consist];
        return out;
      }),
      ground: s.ground.map((gp) => ({
        color: gp.pkg.color,
        weightClass: gp.pkg.weightClass,
        archetype: gp.pkg.archetype,
        col: gp.at.col,
        row: gp.at.row,
        x: gp.pos.x,
        y: gp.pos.y,
      })),
      dispensers: s.level.dispensers.map((d) => ({
        id: d.id,
        color: d.color,
        weightClass: d.weight,
        ready: s.dispensers[d.id].ready,
        col: d.at.col,
        row: d.at.row,
      })),
      dropZones: s.level.dropZones.map((z) => ({
        id: z.id,
        color: z.color,
        col: z.at.col,
        row: z.at.row,
      })),
      levers: s.level.levers.map((l) => ({
        id: l.id,
        thrown: s.levers[l.id].thrown,
        col: l.at.col,
        row: l.at.row,
      })),
      signals: s.level.signals.map((sig) => ({
        id: sig.id,
        state: signalStateFor(s, sig.trackId),
        col: sig.at.col,
        row: sig.at.row,
      })),
      quota: s.level.quota.map((q) => ({
        color: q.color,
        required: q.required,
        delivered: s.delivered[q.color],
      })),
      uniques: s.level.uniques.map((u) => ({
        id: u.id,
        color: u.color,
        delivered: s.uniquesDelivered[u.id],
        lost: s.uniquesLost[u.id],
      })),
    };
  }

  // ─── The read-only debug overlay (specs/instrumentation.md) ──────────────────────────

  private renderDebugOverlay(): void {
    const snap = this.debugSnapshot();
    const ctx = this.ctx;
    const lines: string[] = [];
    lines.push(`screen=${snap.screen} phase=${snap.phase ?? "-"} auto=${snap.autoStep} t=${snap.simTime.toFixed(2)}`);
    if (snap.level) {
      const l = snap.level;
      lines.push(`L${l.number} "${l.name}" clock=${l.clock.toFixed(1)} lives=${l.lives} quotaMet=${l.quotaMet} fail=${l.failReason ?? "-"}`);
      lines.push(`score=${l.score} near=${l.nearMisses} opt=${l.optionalsDelivered}`);
    }
    if (snap.worker) {
      const wk = snap.worker;
      lines.push(`worker (${wk.x.toFixed(1)},${wk.y.toFixed(1)}) ${wk.facing}/${wk.anim} spd=${wk.speed.toFixed(1)}`);
      lines.push(`load=${wk.load} frac=${wk.loadFraction.toFixed(2)} sprint=${wk.sprintCharge.toFixed(2)}${wk.sprintLocked ? " LOCKED" : ""} moving=${wk.moving}`);
      lines.push(`carried=[${wk.carried.map((c) => `${c.color}:${c.weightClass}`).join(", ")}]`);
    }
    for (const t of snap.trains) {
      lines.push(`train ${t.kind}${t.isLast ? "*" : ""} ${t.orientation} line=${t.line} head=${t.headPos.toFixed(1)} v=${t.speed}`);
    }
    if (snap.signals.length) {
      lines.push(`signals ${snap.signals.map((s) => `${s.id}=${s.state}`).join(" ")}`);
    }
    if (snap.quota.length) {
      lines.push(`quota ${snap.quota.map((q) => `${q.color} ${q.delivered}/${q.required}`).join(" ")}`);
    }
    for (const u of snap.uniques) {
      lines.push(`unique ${u.id} ${u.color} delivered=${u.delivered} lost=${u.lost}`);
    }

    ctx.save();
    ctx.font = `12px ${FONT_STACK}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const pad = 8;
    const lh = 16;
    let maxW = 0;
    for (const ln of lines) maxW = Math.max(maxW, ctx.measureText(ln).width);
    ctx.fillStyle = "#000000cc";
    ctx.fillRect(8, 8, maxW + pad * 2, lines.length * lh + pad * 2);
    ctx.fillStyle = "#8affc0";
    lines.forEach((ln, i) => ctx.fillText(ln, 8 + pad, 8 + pad + i * lh));
    ctx.restore();
  }
}

// ─── The JSON-serializable state the debug API and overlay report (specs/instrumentation.md) ─

export interface CarriedSnapshot {
  color: FreightColor;
  weightClass: WeightClass;
  archetype: PackageArchetype;
}

export interface TrainSnapshot {
  trackId: string;
  kind: TrainKind;
  orientation: Orientation;
  dir: TrainDir;
  line: number;
  headPos: number;
  length: number;
  speed: number;
  isLast: boolean;
  box: { x0: number; y0: number; x1: number; y1: number };
  consist?: LastTrainCar[];
}

export interface LocoSnapshot {
  version: number;
  screen: GameScreen;
  phase: SimState["phase"] | null;
  muted: boolean;
  autoStep: boolean;
  simTime: number;
  campaign: { levelCount: number; unlocked: number; bestScores: number[] };
  level: {
    index: number;
    number: number;
    name: string;
    clock: number;
    lives: number;
    quotaMet: boolean;
    failReason: SimState["failReason"] | null;
    score: number;
    scoreParts: SimState["scoreParts"];
    nearMisses: number;
    optionalsDelivered: number;
  } | null;
  worker: {
    x: number;
    y: number;
    facing: Facing;
    anim: SimState["worker"]["anim"];
    moving: boolean;
    sprinting: boolean;
    sprintCharge: number;
    sprintLocked: boolean;
    load: number;
    loadFraction: number;
    speed: number;
    carried: CarriedSnapshot[];
  } | null;
  trains: TrainSnapshot[];
  ground: {
    color: FreightColor;
    weightClass: WeightClass;
    archetype: PackageArchetype;
    col: number;
    row: number;
    x: number;
    y: number;
  }[];
  dispensers: { id: string; color: FreightColor; weightClass: WeightClass; ready: boolean; col: number; row: number }[];
  dropZones: { id: string; color: FreightColor; col: number; row: number }[];
  levers: { id: string; thrown: boolean; col: number; row: number }[];
  signals: { id: string; state: "clear" | "warning" | "danger"; col: number; row: number }[];
  quota: { color: FreightColor; required: number; delivered: number }[];
  uniques: { id: string; color: FreightColor; delivered: boolean; lost: boolean }[];
}

// ─── Level-select summary ──────────────────────────────────────────────────────────────

function describeQuota(lvl: SimState["level"]): string {
  return lvl.quota.map((q) => `${q.required} ${q.color}`).join(" · ");
}
