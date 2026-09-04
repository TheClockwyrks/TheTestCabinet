// Volute — the effects that play over the finished hall (specs/assets.md).
//
// A tick reports WHERE something happened; this layer is what plays over it. Two
// kinds of effect, both from produced files:
//
//   * the SHEETS, animated frame by frame — the extraction flash over each core a
//     run gave up, the maw's swallow over the intake, and the barrel's recoil over
//     the injector;
//   * the PARTICLE SYSTEMS, simulated live through `@test-cabinet/particle-runtime`'s
//     canvas binding — the extraction burst, the bore detonation, the intake spray,
//     and the shimmer that separates a grant from an ordinary extraction.
//
// None of it is game state: the simulation reaches the same state with these
// running and with them absent, and a tick decides nothing from them.
//
// THE PARTICLE PLAYER IS HANDED THE FIELD'S OWN CONTEXT, as `specs/assets.md`
// asks. It maps its system's field across the whole backing store, so each
// instance is drawn under a transform that folds that box down onto the
// footprint the event calls for; the two maps compose to a uniform scale, so a
// particle lands exactly where the simulation put it.

import { ParticleCanvasPlayer } from "@test-cabinet/particle-runtime/canvas";
import type { Assets, SheetName, SystemName } from "./assets";
import type { ChargeId } from "./constants";
import type { FxEvent } from "./events";
import { CHARGE_COLOR } from "./theme";

/** Seconds a frame of each produced sheet holds the screen. */
const FRAME_SECONDS: Readonly<Record<SheetName, number>> = {
  // Four frames inside the 0.18 s fire cooldown, so consecutive shots each read.
  "fire-recoil": 0.045,
  "maw-swallow": 0.06,
  // Six frames well inside the 0.4 s recoil hold, so a run of extractions reads
  // as a run rather than as one long glare.
  "extraction-flash": 0.055,
};

/** The field box, in logical units, each produced system is played across. */
const FOOTPRINT: Readonly<Record<SystemName, number>> = {
  "extraction-burst": 96,
  // `BORE_RADIUS` is 90, so the detonation covers the ground the bore clears.
  "bore-detonation": 180,
  "intake-spray": 110,
  "pickup-shimmer": 96,
};

/** How a unit-size particle is sized before the field-to-canvas fit is applied. */
const PARTICLE_PIXEL_RADIUS = 4;

/** One playing sheet. */
interface SheetPlay {
  readonly sheet: SheetName;
  readonly x: number;
  readonly y: number;
  readonly charge: ChargeId | null;
  age: number;
}

/** One playing particle system. */
interface SystemPlay {
  readonly system: SystemName;
  readonly x: number;
  readonly y: number;
  readonly tint: ChargeId | null;
  age: number;
  player: ParticleCanvasPlayer | null;
}

/** How the tinting step obtains a scratch canvas of its own. */
export type CanvasFactory = (
  width: number,
  height: number,
) => HTMLCanvasElement;

/** The page's own canvas element, which is what the browser build uses. */
function domCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** The live effects, spawned from a tick's report and retired when they are spent. */
export class Effects {
  private readonly assets: Assets;
  private readonly createCanvas: CanvasFactory;
  private readonly sheets: SheetPlay[] = [];
  private readonly systems: SystemPlay[] = [];
  /** Tinted copies of the shared flash frames, built once per charge and frame. */
  private readonly tinted = new Map<string, HTMLCanvasElement>();
  /** The barrel's recoil, which replaces the barrel sprite while it plays. */
  private recoil = Infinity;

  constructor(assets: Assets, createCanvas: CanvasFactory = domCanvas) {
    this.assets = assets;
    this.createCanvas = createCanvas;
  }

  /** Play whatever a tick's event calls for. */
  spawn(event: FxEvent): void {
    switch (event.kind) {
      case "extract":
        this.sheets.push({
          sheet: "extraction-flash",
          x: event.x,
          y: event.y,
          charge: event.charge ?? null,
          age: 0,
        });
        this.play("extraction-burst", event.x, event.y, event.charge ?? null);
        break;
      case "grant":
        this.play("pickup-shimmer", event.x, event.y, null);
        break;
      case "bore":
        this.play("bore-detonation", event.x, event.y, null);
        break;
      case "intake":
        this.sheets.push({
          sheet: "maw-swallow",
          x: event.x,
          y: event.y,
          charge: null,
          age: 0,
        });
        this.play("intake-spray", event.x, event.y, null);
        break;
      case "fire":
        this.recoil = 0;
        break;
    }
  }

  /** Drop every live effect: what a cell spend and a fresh level leave behind. */
  clear(): void {
    this.sheets.length = 0;
    this.systems.length = 0;
    this.recoil = Infinity;
  }

  /** The frame of the recoil sheet the barrel is drawn on, or `null` for the sprite. */
  recoilFrame(): HTMLImageElement | null {
    const frames = this.assets.sheets["fire-recoil"];
    const index = Math.floor(this.recoil / FRAME_SECONDS["fire-recoil"]);
    return index >= 0 && index < frames.length ? frames[index] : null;
  }

  /** Age every live effect and retire the ones that have played through. */
  update(dt: number): void {
    if (dt <= 0) return;
    this.recoil += dt;

    for (let i = this.sheets.length - 1; i >= 0; i -= 1) {
      const play = this.sheets[i];
      play.age += dt;
      const frames = this.assets.sheets[play.sheet].length;
      if (play.age >= frames * FRAME_SECONDS[play.sheet])
        this.sheets.splice(i, 1);
    }

    for (let i = this.systems.length - 1; i >= 0; i -= 1) {
      const play = this.systems[i];
      play.age += dt;
      const duration = this.assets.systems[play.system].durationMs / 1000;
      const spent =
        play.player === null || play.player.simulator.liveCount === 0;
      if (play.age > duration && spent) this.systems.splice(i, 1);
    }
  }

  /**
   * Draw every live effect over the finished frame.
   *
   * `dt` is the frame's own delta: the sheets were already aged by `update`, and
   * the particle systems are stepped here, because the player that simulates them
   * is the same object that composites them.
   */
  draw(ctx: CanvasRenderingContext2D, dt: number): void {
    for (const play of this.sheets) {
      if (play.sheet === "fire-recoil") continue;
      const frames = this.assets.sheets[play.sheet];
      const index = Math.min(
        frames.length - 1,
        Math.floor(play.age / FRAME_SECONDS[play.sheet]),
      );
      const image = frames[index];
      const w = image.width;
      const h = image.height;
      const x = play.x - w / 2;
      const y = play.y - h / 2;

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      if (play.charge !== null) {
        ctx.drawImage(this.tint(play.sheet, index, play.charge), x, y, w, h);
        // The produced frame itself, over its own tint, so the flash keeps a
        // white-hot centre and the sheet is what the picture is actually made of.
        ctx.globalAlpha = 0.35;
      }
      ctx.drawImage(image, 0, 0, w, h, x, y, w, h);
      ctx.restore();
    }

    for (const play of this.systems) {
      this.drawSystem(ctx, play, dt);
    }
  }

  private play(
    system: SystemName,
    x: number,
    y: number,
    tint: ChargeId | null,
  ): void {
    this.systems.push({ system, x, y, tint, age: 0, player: null });
  }

  /**
   * Composite one live system.
   *
   * The player is built on the first draw rather than at spawn, because building
   * one composites its opening state at once and that has to happen under the
   * transform that puts it in the right place.
   */
  private drawSystem(
    ctx: CanvasRenderingContext2D,
    play: SystemPlay,
    dt: number,
  ): void {
    const canvas = ctx.canvas;
    if (!(canvas.width > 0) || !(canvas.height > 0)) return;
    const system = this.assets.systems[play.system];
    const box = FOOTPRINT[play.system];

    ctx.save();

    // A colored ground under the neutral particles: the produced burst is authored
    // white-to-grey so one system serves every charge, and this is what carries
    // the extracted charge's color (specs/assets.md).
    if (play.tint !== null && play.age < 0.25) {
      const radius = box * (0.2 + play.age);
      const glow = ctx.createRadialGradient(
        play.x,
        play.y,
        0,
        play.x,
        play.y,
        radius,
      );
      glow.addColorStop(0, CHARGE_COLOR[play.tint]);
      glow.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = Math.max(0, 0.55 - play.age * 2);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(play.x, play.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.translate(play.x - box / 2, play.y - box / 2);
    ctx.scale(box / canvas.width, box / canvas.height);
    if (play.player === null) {
      play.player = new ParticleCanvasPlayer(system, ctx, {
        pixelRadius: PARTICLE_PIXEL_RADIUS,
        // The ash of the intake's spray reads as something lost; everything else
        // is light, and adds.
        composite: play.system === "intake-spray" ? "source-over" : "lighter",
        // The field is already drawn: the player composites onto it.
        clear: false,
      });
    } else {
      // Composited on EVERY frame, a zero delta included: a frame that ran no tick
      // still draws the whole field afresh, and the effects have to be laid back
      // over it or a stepped scenario's screenshot would lose them. `update(0)`
      // steps the simulation by nothing and re-composites what it already holds.
      play.player.update(dt);
    }
    ctx.restore();
  }

  /** A copy of one shared flash frame, filled with a charge's own color. */
  private tint(
    sheet: SheetName,
    frame: number,
    charge: ChargeId,
  ): HTMLCanvasElement {
    const key = `${sheet}:${frame}:${charge}`;
    const cached = this.tinted.get(key);
    if (cached !== undefined) return cached;

    const image = this.assets.sheets[sheet][frame];
    const canvas = this.createCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d");
    if (ctx !== null) {
      ctx.drawImage(image, 0, 0);
      ctx.globalCompositeOperation = "source-in";
      ctx.fillStyle = CHARGE_COLOR[charge];
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    this.tinted.set(key, canvas);
    return canvas;
  }
}
