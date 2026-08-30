// Volute — the hall's bodies (specs/state.md, specs/assets.md).
//
// Four actors populate the hall, each carrying its tag from `TAGS` so
// `world.byTag` finds it under the name the specification uses: the cores on the
// channel, the cores in flight, the injector, and the intake. Each carries its
// produced sprite on a sprite component, as `specs/assets.md` states, and each
// holds the fields the specification gives that body — a core its charge, arc
// position, mark and recoil hold; the injector its aim, cooldown, and loaded and
// queued charges.
//
// None of them ticks. Volute's rules are a strict ORDER over the whole train
// (specs/channel.md, "The order of a tick"), so the game mode advances every
// body from one place, after the controllers have written the frame's input.
// What an actor owns is its own fields and its own picture.

import {
  Actor,
  DrawComponent,
  SpriteComponent,
  type DrawApi,
} from "@test-cabinet/structured-2d";
import { assets } from "./assets";
import { pointAt } from "./channel";
import {
  AIM_START,
  CORE_RADIUS,
  INJECTOR_X,
  INJECTOR_Y,
  PROJECTILE_RADIUS,
} from "./constants";
import type { ChargeId, MachineryKind } from "./constants";
import { radians } from "./math";
import { CHARGE_COLOR, LAYER, fade } from "./theme";

/** The drawn size of a core: its diameter, and its produced sprite's canvas. */
const CORE_SIZE = CORE_RADIUS * 2;
/** The drawn size of a machinery mark badge. */
const MARK_SIZE = 16;
/** The drawn size of the core the injector holds seated in its hub. */
const HELD_CORE_SIZE = 20;
/** The produced barrel's canvas, and where along it the injector pivots. */
const BARREL = { width: 44, height: 20, pivotX: 6 } as const;
/** The produced injector base's canvas. */
const BASE_SIZE = 44;
/** The produced intake maw's canvas. */
const MAW_SIZE = 64;

/** The whole of a sprite's own image, as an explicit source region. */
function whole(size: number): { x: 0; y: 0; width: number; height: number } {
  return { x: 0, y: 0, width: size, height: size };
}

/**
 * The halo a core carries, under its produced sprite.
 *
 * The hall is dark and the cores are the one thing in it that carries its own
 * light, so each is drawn over a soft radial wash in its charge's color.
 */
class CoreGlow extends DrawComponent {
  /** The charge the wash is colored by, written when the core's charge is. */
  charge: ChargeId = "halide";

  draw(api: DrawApi): void {
    if (api.mode !== "shaded") return;
    const { ctx } = api;
    const at = this.worldTransform();
    const radius = CORE_RADIUS + 4;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const glow = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, radius);
    glow.addColorStop(0, fade(CHARGE_COLOR[this.charge], 0.42));
    glow.addColorStop(0.7, fade(CHARGE_COLOR[this.charge], 0.22));
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(at.x, at.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/** One core standing on the channel, at the point its arc position gives. */
export class Core extends Actor {
  /** The charge it carries. */
  charge: ChargeId = "halide";
  /** Its arc position, the distance from the inlet walked along the channel. */
  s = 0;
  /** The machinery extracting it grants, or `null` on an unmarked core. */
  mark: MachineryKind | null = null;
  /**
   * The seconds of recoil hold this core stands under.
   *
   * `specs/extraction.md` carries the hold on the SEGMENT; a segment's
   * boundaries, though, follow from the spacing and so change under every
   * insertion, extraction and merge. Holding it per core and reading a segment's
   * hold off its head is the same rule with nothing to keep in step, and
   * {@link import("./train").resegment} normalizes the rest.
   */
  hold = 0;

  private readonly glow: CoreGlow;
  private readonly body: SpriteComponent;
  private readonly badge: SpriteComponent;

  constructor() {
    super();
    const art = assets();

    this.glow = this.attach(new CoreGlow());
    this.glow.layer = LAYER.coreGlow;

    this.body = this.attach(
      new SpriteComponent({
        image: art.cores.halide,
        source: whole(CORE_SIZE),
        width: CORE_SIZE,
        height: CORE_SIZE,
      }),
    );
    this.body.layer = LAYER.core;

    this.badge = this.attach(
      new SpriteComponent({
        image: art.marks.choke,
        source: whole(MARK_SIZE),
        width: MARK_SIZE,
        height: MARK_SIZE,
      }),
    );
    this.badge.layer = LAYER.coreMark;
    this.badge.offset.x = 10;
    this.badge.offset.y = -10;
    this.badge.visible = false;

    this.tickEnabled = false;
  }

  /** Move the core to an arc position, and with it the body that draws there. */
  setArc(s: number): void {
    this.s = s;
    const point = pointAt(s);
    this.transform.x = point.x;
    this.transform.y = point.y;
  }

  /** Set the charge the core carries, and the sprite and halo that show it. */
  setCharge(charge: ChargeId): void {
    this.charge = charge;
    this.body.image = assets().cores[charge];
    this.glow.charge = charge;
  }

  /** Set the machinery the core's mark grants, or clear the mark. */
  setMark(mark: MachineryKind | null): void {
    this.mark = mark;
    this.badge.visible = mark !== null;
    if (mark !== null) this.badge.image = assets().marks[mark];
  }
}

/** The streak a core in flight leaves behind it. */
class ProjectileTrail extends DrawComponent {
  /** The charge the streak is colored by. */
  charge: ChargeId = "halide";
  /** The heading it was fired along, in degrees. */
  angle = 0;

  draw(api: DrawApi): void {
    if (api.mode !== "shaded") return;
    const { ctx } = api;
    const at = this.worldTransform();
    const heading = radians(this.angle);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = fade(CHARGE_COLOR[this.charge], 0.35);
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(at.x, at.y);
    ctx.lineTo(at.x - Math.cos(heading) * 26, at.y - Math.sin(heading) * 26);
    ctx.stroke();
    ctx.restore();
  }
}

/** One core in flight, between the injector and what it meets. */
export class Projectile extends Actor {
  /** The charge it carries and seats. */
  charge: ChargeId = "halide";
  /** The heading it was fired along, in degrees, in `[0, 360)`. */
  angle = 0;

  private readonly trail: ProjectileTrail;
  private readonly body: SpriteComponent;

  constructor() {
    super();
    this.trail = this.attach(new ProjectileTrail());
    this.trail.layer = LAYER.projectile;

    this.body = this.attach(
      new SpriteComponent({
        image: assets().cores.halide,
        source: whole(CORE_RADIUS * 2),
        width: PROJECTILE_RADIUS * 2,
        height: PROJECTILE_RADIUS * 2,
      }),
    );
    this.body.layer = LAYER.projectile;

    this.tickEnabled = false;
  }

  /** Set the charge in flight and the heading it travels along. */
  launch(charge: ChargeId, angle: number): void {
    this.charge = charge;
    this.angle = angle;
    this.body.image = assets().cores[charge];
    this.trail.charge = charge;
    this.trail.angle = angle;
  }
}

/**
 * The injector the channel winds around: the machine the player works.
 *
 * It never moves, so its transform is the fixed center `specs/injector.md`
 * gives. What it holds is the aim, the cooldown, and the two charges — and the
 * aim keeps its value through a pause, an interlude, and a level change, which
 * it does by living here rather than being rebuilt with each level of the run.
 */
export class Injector extends Actor {
  /** The direction it points, in degrees, in `[0, 360)`. */
  aim: number = AIM_START;
  /** The seconds until it may fire again. */
  cooldown = 0;
  /** The charge it fires next; `null` while no level is open. */
  loaded: ChargeId | null = null;
  /** The charge that becomes `loaded` on the next firing. */
  queued: ChargeId | null = null;

  private readonly barrel: SpriteComponent;
  private readonly held: SpriteComponent;

  constructor() {
    super();
    const art = assets();
    this.transform.x = INJECTOR_X;
    this.transform.y = INJECTOR_Y;

    // Authored pointing toward `+x`, with its center line halfway down the
    // canvas, so the component's anchor puts the pivot inside the machine and
    // the sprite turns about it.
    this.barrel = this.attach(
      new SpriteComponent({
        image: art.injectorBarrel,
        source: { x: 0, y: 0, width: BARREL.width, height: BARREL.height },
        width: BARREL.width,
        height: BARREL.height,
        anchorX: BARREL.pivotX / BARREL.width,
        anchorY: 0.5,
      }),
    );
    this.barrel.layer = LAYER.injector;

    const base = this.attach(
      new SpriteComponent({
        image: art.injectorBase,
        source: whole(BASE_SIZE),
        width: BASE_SIZE,
        height: BASE_SIZE,
      }),
    );
    base.layer = LAYER.injector;

    this.held = this.attach(
      new SpriteComponent({
        image: art.cores.halide,
        source: whole(CORE_SIZE),
        width: HELD_CORE_SIZE,
        height: HELD_CORE_SIZE,
      }),
    );
    this.held.layer = LAYER.injector;
    this.held.visible = false;

    this.tickEnabled = false;
    this.setAim(AIM_START);
  }

  /** Point the barrel along an aim, in degrees. */
  setAim(degrees: number): void {
    this.aim = degrees;
    this.barrel.offset.rotation = radians(degrees);
  }

  /** Seat a charge in the hub, or empty it. */
  setLoaded(charge: ChargeId | null): void {
    this.loaded = charge;
    this.held.visible = charge !== null;
    if (charge !== null) this.held.image = assets().cores[charge];
  }

  /** Draw the barrel on a frame of the produced recoil sheet, or on its sprite. */
  setBarrelFrame(frame: ImageBitmap | null): void {
    this.barrel.image = frame ?? assets().injectorBarrel;
  }
}

/** The intake: the opening that takes cores in, and the heaviest thing on the field. */
export class Intake extends Actor {
  private readonly swallow: SpriteComponent;

  constructor() {
    super();
    const art = assets();
    const maw = this.attach(
      new SpriteComponent({
        image: art.intakeMaw,
        source: whole(MAW_SIZE),
        width: MAW_SIZE,
        height: MAW_SIZE,
      }),
    );
    maw.layer = LAYER.intake;

    this.swallow = this.attach(
      new SpriteComponent({
        image: art.sheets["maw-swallow"][0],
        source: whole(MAW_SIZE),
        width: MAW_SIZE,
        height: MAW_SIZE,
      }),
    );
    this.swallow.layer = LAYER.intake;
    this.swallow.visible = false;

    this.tickEnabled = false;
  }

  /** Play a frame of the produced swallow sheet over the maw, or none. */
  setSwallowFrame(frame: ImageBitmap | null): void {
    this.swallow.visible = frame !== null;
    if (frame !== null) this.swallow.image = frame;
  }
}
