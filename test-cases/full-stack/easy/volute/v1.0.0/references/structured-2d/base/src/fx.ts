// Volute — the effects that play over the finished hall (specs/assets.md).
//
// A rule reports WHERE something happened; this layer is what plays over it.
// Two kinds of effect, both from produced files:
//
//   * the SHEETS, animated frame by frame — the extraction flash over each core
//     a run gave up, the maw's swallow over the intake, and the barrel's recoil
//     over the injector, the last two played by swapping the frame onto the
//     sprite the actor already carries;
//   * the PARTICLE SYSTEMS, simulated live through
//     `@test-cabinet/particle-runtime`'s canvas binding — the extraction burst,
//     the bore detonation, the intake spray, and the shimmer that separates a
//     grant from an ordinary extraction.
//
// None of it is game state (specs/state.md): the simulation reaches the same
// state with these running and with them absent, and no rule reads them.
//
// THE PARTICLE PLAYER IS HANDED THE FIELD'S OWN CONTEXT. It maps its system's
// field across the whole backing store, so each instance is drawn under a
// transform that folds that box down onto the footprint the event calls for; the
// two maps compose, so a particle lands where the event put it.

import {
  Actor,
  DrawComponent,
  type DrawApi,
} from "@test-cabinet/structured-2d";
import { ParticleCanvasPlayer } from "@test-cabinet/particle-runtime/canvas";
import { assets, type SheetName, type SystemName } from "./assets";
import { Injector, Intake } from "./actors";
import { TAGS } from "./constants";
import type { ChargeId } from "./constants";
import { advancesSimulation, HallState } from "./state";
import { CHARGE_COLOR, LAYER } from "./theme";

/**
 * One place something happened, for the layer that draws over the hall.
 *
 * The rules decide everything from the world alone (specs/instrumentation.md,
 * "Render-free core"), so they never reach the canvas; what they hand outward is
 * this, and the effects layer is what plays over it.
 */
export interface FxEvent {
  /** What happened. */
  readonly kind: "extract" | "grant" | "bore" | "intake" | "fire";
  /** Where it happened, in logical units. */
  readonly x: number;
  readonly y: number;
  /** The charge involved, where the effect is tinted by one. */
  readonly charge?: ChargeId;
}

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

/** A scratch 2D surface, or `null` on a host that offers none. */
function scratch(
  width: number,
  height: number,
): CanvasRenderingContext2D | null {
  const maker = globalThis as {
    document?: { createElement(tag: string): unknown };
    OffscreenCanvas?: new (w: number, h: number) => unknown;
  };
  const canvas =
    maker.document !== undefined
      ? (maker.document.createElement("canvas") as HTMLCanvasElement)
      : maker.OffscreenCanvas !== undefined
        ? (new maker.OffscreenCanvas(
            width,
            height,
          ) as unknown as HTMLCanvasElement)
        : null;
  if (canvas === null) return null;
  canvas.width = width;
  canvas.height = height;
  return canvas.getContext("2d");
}

/** Draws whatever the effects layer is holding, over the finished hall. */
class EffectsDraw extends DrawComponent {
  constructor(private readonly effects: Effects) {
    super();
    this.layer = LAYER.effects;
  }

  draw(api: DrawApi): void {
    if (api.mode !== "shaded") return;
    this.effects.paint(api.ctx, api.frame().lastDeltaMs / 1000);
  }
}

/**
 * The live effects: spawned from what a rule reported, aged each frame, and
 * retired when they are spent.
 */
export class Effects extends Actor {
  private readonly sheets: SheetPlay[] = [];
  private readonly systems: SystemPlay[] = [];
  /** Tinted copies of the shared flash frames, built once per charge and frame. */
  private readonly tinted = new Map<string, CanvasImageSource>();
  /** The barrel's recoil and the maw's swallow, each played on its own sprite. */
  private recoil = Infinity;
  private swallow = Infinity;
  /** Whether the screen the hall is on advances anything at all. */
  private frozen = false;
  private injector: Injector | null = null;
  private intake: Intake | null = null;

  constructor() {
    super();
    this.attach(new EffectsDraw(this));
  }

  override beginPlay(): void {
    const injector = this.world.byTag(TAGS.injector)[0];
    this.injector = injector instanceof Injector ? injector : null;
    const intake = this.world.byTag(TAGS.intake)[0];
    this.intake = intake instanceof Intake ? intake : null;
  }

  /** Play whatever a rule's event calls for. */
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
        this.swallow = 0;
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
    this.swallow = Infinity;
    this.pushFrames();
  }

  /** Age every live effect, and retire the ones that have played through. */
  override tick(dt: number): void {
    const state = this.world.state;
    this.frozen =
      state instanceof HallState && !advancesSimulation(state.screen);
    if (dt > 0 && !this.frozen) {
      this.recoil += dt;
      this.swallow += dt;

      for (let i = this.sheets.length - 1; i >= 0; i -= 1) {
        const play = this.sheets[i];
        play.age += dt;
        const frames = assets().sheets[play.sheet].length;
        if (play.age >= frames * FRAME_SECONDS[play.sheet]) {
          this.sheets.splice(i, 1);
        }
      }

      for (let i = this.systems.length - 1; i >= 0; i -= 1) {
        const play = this.systems[i];
        play.age += dt;
        const duration = assets().systems[play.system].durationMs / 1000;
        const spent =
          play.player === null || play.player.simulator.liveCount === 0;
        if (play.age > duration && spent) this.systems.splice(i, 1);
      }
    }
    this.pushFrames();
  }

  /** Put the barrel and the maw on the frame their own sheet has reached. */
  private pushFrames(): void {
    this.injector?.setBarrelFrame(this.frameOf("fire-recoil", this.recoil));
    this.intake?.setSwallowFrame(this.frameOf("maw-swallow", this.swallow));
  }

  /** The frame a sheet has reached at an age, or `null` once it has played out. */
  private frameOf(sheet: SheetName, age: number): ImageBitmap | null {
    const frames = assets().sheets[sheet];
    const index = Math.floor(age / FRAME_SECONDS[sheet]);
    return index >= 0 && index < frames.length ? frames[index] : null;
  }

  /**
   * Draw every live effect over the finished frame.
   *
   * `dt` is the frame's own delta: the sheets were already aged by `tick`, and
   * the particle systems are stepped here, because the player that simulates
   * them is the same object that composites them.
   */
  paint(ctx: CanvasRenderingContext2D, dt: number): void {
    for (const play of this.sheets) {
      const frames = assets().sheets[play.sheet];
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
      const tint =
        play.charge === null ? null : this.tint(play.sheet, index, play.charge);
      if (tint !== null) {
        ctx.drawImage(tint, x, y, w, h);
        // The produced frame itself, over its own tint, so the flash keeps a
        // white-hot centre and the sheet is what the picture is made of.
        ctx.globalAlpha = 0.35;
      }
      ctx.drawImage(image, 0, 0, w, h, x, y, w, h);
      ctx.restore();
    }

    for (const play of this.systems) {
      this.paintSystem(ctx, play, this.frozen ? 0 : dt);
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
  private paintSystem(
    ctx: CanvasRenderingContext2D,
    play: SystemPlay,
    dt: number,
  ): void {
    const canvas = ctx.canvas;
    if (!(canvas.width > 0) || !(canvas.height > 0)) return;
    const system = assets().systems[play.system];
    const box = FOOTPRINT[play.system];

    ctx.save();

    // A colored ground under the neutral particles: the produced burst is
    // authored white-to-grey so one system serves every charge, and this is what
    // carries the extracted charge's color (specs/assets.md).
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
      // Composited on EVERY frame, a zero delta included: the pipeline draws the
      // whole field afresh each frame, so the effects have to be laid back over
      // it or a stepped scenario's screenshot would lose them.
      play.player.update(dt);
    }
    ctx.restore();
  }

  /** A copy of one shared flash frame, filled with a charge's own color. */
  private tint(
    sheet: SheetName,
    frame: number,
    charge: ChargeId,
  ): CanvasImageSource | null {
    const key = `${sheet}:${frame}:${charge}`;
    const cached = this.tinted.get(key);
    if (cached !== undefined) return cached;

    const image = assets().sheets[sheet][frame];
    const ctx = scratch(image.width, image.height);
    if (ctx === null) return null;
    ctx.drawImage(image, 0, 0);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = CHARGE_COLOR[charge];
    ctx.fillRect(0, 0, image.width, image.height);
    this.tinted.set(key, ctx.canvas);
    return ctx.canvas;
  }
}
