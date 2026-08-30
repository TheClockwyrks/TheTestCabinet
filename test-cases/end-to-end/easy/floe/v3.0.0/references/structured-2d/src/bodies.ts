// Floe — the bodies on the strait, as actors in the world.
//
// `specs/state.md` puts the strait's bodies in the world the engine owns: the
// critter, the bears, the vehicles, the floes and the bonus catch are actors,
// each carrying its tag from `TAGS`, so `world.byTag` finds them under the names
// the specification uses. An actor's transform is its position, in the two
// conventions `specs/overview.md` fixes without exception: the critter's, a
// bear's and the bonus catch's transform is its CENTER, and a vehicle's or a
// floe's is its LEFT EDGE, with `transform.y` on its row's top edge so the frame
// covers exactly the tiles the item spans.
//
// NOTHING HERE TICKS. The simulation runs on a fixed step and the game mode's
// tick is the whole of it (`src/sim.ts`), so a body's own `tick` would run
// against the frame's delta rather than the tick's. What each class carries
// instead is `sync`, called by the mode after it has run the frame's whole ticks:
// it chooses the frame to draw and writes the interpolation offset.
//
// EVERY MOVING BODY CARRIES WHERE IT STOOD WHEN THE TICK BEGAN. The simulation
// runs at a fixed 120 Hz and a frame is presented when the display asks for it,
// so the picture is drawn between two ticks: a component's `offset` carries the
// body from where the tick left it back toward where the tick found it, by the
// fraction of the next tick still to run. Those `prev` fields are written by the
// tick and read only here; nothing in the simulation reads them back, so a posed
// scenario is drawn exactly as it was stepped.

import {
  Actor,
  DrawComponent,
  ShapeComponent,
  SpriteComponent,
  type DrawApi,
  type World,
} from "@test-cabinet/structured-2d";
import {
  ROW_NEAR,
  START_COL,
  TAGS,
  TILE,
  tileCX,
  tileCY,
  tileTop,
} from "./constants";
import type { Facing, FloeKind, ItemKind, VehicleKind } from "./game";
import {
  BEAR_LUNGE_BASE,
  BEAR_SWIM_BASE,
  art,
  facingPair,
  floeArt,
  vehicleFrames,
  type Frame,
} from "./sprites";
import {
  BEAR_LUNGE_FPS,
  BEAR_RUN_FPS,
  BEAR_SWIM_FPS,
  COLOR,
  CROSSER_FPS,
  LAYER,
  beat,
} from "./theme";

/** Where a value that moved from `prev` to `now` stands `alpha` into the next tick. */
function drift(prev: number, now: number, alpha: number): number {
  return (prev - now) * (1 - alpha);
}

/**
 * A body drawn from one 32-unit-square frame centered on its own center: the
 * critter and a bear. Both carry a sprite where the seeded frame arrived and a
 * flat block where it did not.
 */
abstract class TileBody extends Actor {
  /** Its center when the current tick began. */
  prevX = 0;
  prevY = 0;

  protected sprite: SpriteComponent | null = null;
  protected block: ShapeComponent | null = null;

  protected mount(frame: Frame, layer: number, fill: string): void {
    if (frame !== null) {
      this.sprite = this.attach(
        new SpriteComponent({
          image: frame,
          width: TILE,
          height: TILE,
          anchorX: 0.5,
          anchorY: 0.5,
        }),
      );
      this.sprite.layer = layer;
      return;
    }
    this.block = this.attach(
      new ShapeComponent({
        shape: { kind: "rect", width: TILE - 6, height: TILE - 6 },
        fill,
      }),
    );
    this.block.layer = layer;
  }

  /** Show or hide whichever component this body was mounted with. */
  protected show(visible: boolean): void {
    if (this.sprite !== null) this.sprite.visible = visible;
    if (this.block !== null) this.block.visible = visible;
  }

  /** Draw this body where it stood `alpha` into the next tick. */
  protected place(frame: Frame, alpha: number): void {
    const dx = drift(this.prevX, this.transform.x, alpha);
    const dy = drift(this.prevY, this.transform.y, alpha);
    if (this.sprite !== null) {
      if (frame !== null) this.sprite.image = frame;
      this.sprite.offset.x = dx;
      this.sprite.offset.y = dy;
    }
    if (this.block !== null) {
      this.block.offset.x = dx;
      this.block.offset.y = dy;
    }
  }
}

/**
 * The critter: one per crossing, so it carries no id.
 *
 * It stays in the world for the whole session and `present` says whether it is
 * on the strait, which is what lets the snapshot report the last values it held
 * while it is out of play (specs/instrumentation.md).
 */
export class Critter extends TileBody {
  /** Whether it is on the strait at all. `false` through a death's hold. */
  present = false;
  /** The direction of its last hop. */
  facing: Facing = "up";
  /** Seconds until it may hop again. */
  hopCooldown = 0;
  /** The topmost row it has stood on this crossing. */
  bestRow = ROW_NEAR;

  constructor() {
    super();
    this.transform.x = tileCX(START_COL);
    this.transform.y = tileCY(ROW_NEAR);
    this.prevX = this.transform.x;
    this.prevY = this.transform.y;
    this.mount(art().crosser[0], LAYER.critter, COLOR.critterBlock);
  }

  sync(alpha: number, simTime: number): void {
    this.show(this.present);
    if (!this.present) return;
    const index = facingPair(this.facing) + beat(simTime, CROSSER_FPS);
    this.place(art().crosser[index], alpha);
  }
}

/**
 * One bear on the strait.
 *
 * A bear is always settled on one tile or travelling into a neighboring one, and
 * it occupies both while it is between them (specs/hunter.md), so the two tiles
 * are held rather than derived from its center.
 */
export class Bear extends TileBody {
  /** Unique among the entities live at any moment. */
  id = 0;
  /** The tile it last settled on. */
  col = 0;
  row = 0;
  /** The tile it is travelling into; equal to `col`/`row` while it is settled. */
  stepCol = 0;
  stepRow = 0;
  /** The direction of the step it is travelling on. */
  facing: Facing = "up";
  /** The tile it is hunting. */
  target = { col: 0, row: 0 };
  /** Whether it reads the critter's tile. */
  sense = true;
  /** Whether it chooses a step on settling. */
  routing = true;
  /** Whether it travels at all. */
  travel = true;
  /**
   * Travel left over from the tick that settled it on a tile center, in stage
   * units, added to the next tick's travel so no distance is lost at a center.
   */
  carry = 0;
  /** Seconds left of the lunge the catch is drawn with; purely presentational. */
  lunge = 0;

  constructor() {
    super();
    this.mount(art().bear[0], LAYER.bear, COLOR.bearBlock);
  }

  /**
   * The run pair for its facing on ice, the submerged swim pair over open water,
   * and the lunge on the tick it catches (specs/assets.md). The swim frames
   * already carry the silhouette and its wake, and a bear draws above the floes,
   * so one passing beneath a raft stays trackable.
   */
  sync(alpha: number, simTime: number, swimming: boolean): void {
    const index =
      this.lunge > 0
        ? BEAR_LUNGE_BASE + beat(simTime, BEAR_LUNGE_FPS)
        : swimming
          ? BEAR_SWIM_BASE +
            facingPair(this.facing) +
            beat(simTime, BEAR_SWIM_FPS)
          : facingPair(this.facing) + beat(simTime, BEAR_RUN_FPS);
    this.place(art().bear[index], alpha);
  }
}

/**
 * One vehicle or one floe: a span rather than a point.
 *
 * Its transform is its LEFT EDGE and its row's top edge, and its frame is drawn
 * `TILE` units wide for every tile it spans, so the art covers exactly the tiles
 * the covering rule reads (specs/ice.md, specs/assets.md).
 */
export abstract class LaneBody extends Actor {
  /** Unique among the entities live at any moment. */
  id = 0;
  /** The strait row it runs on. */
  row = 0;
  /** Its kind, which fixes its length and the art it is drawn from. */
  kind: ItemKind = "pan";
  /** Its length, in tiles. */
  len = 1;
  /** Its left edge when the current tick began. */
  prevX = 0;

  /** The layer the subclass draws on. */
  protected abstract artLayer(): number;

  /** The frame and the sub-rect width this kind is drawn from. */
  protected abstract artFrame(): { frame: Frame; sourceW: number };

  /** The block drawn where the seeded frame did not arrive. */
  protected abstract blockFill(): string;

  private sprite: SpriteComponent | null = null;
  private block: ShapeComponent | null = null;

  /**
   * The art is chosen by `kind`, which a spawn's `configure` sets after the
   * constructor has run, so the components are attached here rather than there.
   */
  override beginPlay(): void {
    const width = TILE * this.len;
    const { frame, sourceW } = this.artFrame();
    if (frame !== null) {
      this.sprite = this.attach(
        new SpriteComponent({
          image: frame,
          source: { x: 0, y: 0, width: sourceW, height: TILE },
          width,
          height: TILE,
          anchorX: 0,
          anchorY: 0,
        }),
      );
      this.sprite.layer = this.artLayer();
      return;
    }
    this.block = this.attach(
      new ShapeComponent({
        shape: { kind: "rect", width: width - 4, height: TILE - 4 },
        fill: this.blockFill(),
      }),
    );
    this.block.layer = this.artLayer();
  }

  /**
   * Draw the item where it stood `alpha` into the next tick, mirrored where its
   * lane runs leftward.
   *
   * Each vehicle's art faces right, so a lane whose `dir` is `-1` draws it
   * flipped about its own middle and every vehicle faces the way its lane runs
   * (specs/assets.md). The engine pivots a component's scale about the
   * component's own world position, so anchoring the frame's right edge there
   * and scaling `x` by `-1` leaves the mirrored frame over exactly the tiles the
   * item spans.
   */
  sync(alpha: number, mirrored: boolean): void {
    const width = TILE * this.len;
    const dx = drift(this.prevX, this.transform.x, alpha);
    if (this.sprite !== null) {
      this.sprite.anchorX = mirrored ? 1 : 0;
      this.sprite.offset.scaleX = mirrored ? -1 : 1;
      this.sprite.offset.x = dx;
      return;
    }
    if (this.block !== null) {
      this.block.offset.x = dx + width / 2;
      this.block.offset.y = TILE / 2;
    }
  }
}

/** One sliding vehicle on the ice band (specs/ice.md). */
export class Vehicle extends LaneBody {
  protected override artLayer(): number {
    return LAYER.vehicles;
  }

  protected override artFrame(): { frame: Frame; sourceW: number } {
    return {
      frame: vehicleFrames(this.kind as VehicleKind)[0],
      sourceW: TILE * this.len,
    };
  }

  protected override blockFill(): string {
    return COLOR.vehicleBlock;
  }
}

/** One drifting floe on the water band (specs/water.md). */
export class IceFloe extends LaneBody {
  protected override artLayer(): number {
    return LAYER.floes;
  }

  protected override artFrame(): { frame: Frame; sourceW: number } {
    return floeArt(this.kind as FloeKind);
  }

  protected override blockFill(): string {
    return COLOR.floeBlock;
  }
}

/**
 * The bonus catch: a small fish that visits the open bays (specs/bays.md).
 *
 * No folder covers it, so it is drawn in code (specs/assets.md), which is what a
 * `DrawComponent` is for. Its transform is its center, on the center of the bay
 * it is in.
 */
class FishArt extends DrawComponent {
  draw(api: DrawApi): void {
    const { ctx } = api;
    const cx = this.actor.transform.x;
    const cy = this.actor.transform.y;
    if (api.mode === "wireframe") {
      ctx.strokeStyle = COLOR.fish;
      ctx.lineWidth = 1;
      ctx.strokeRect(cx - 14, cy - 7, 30, 14);
      return;
    }
    ctx.fillStyle = COLOR.fish;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 11, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + 9, cy);
    ctx.lineTo(cx + 17, cy - 6);
    ctx.lineTo(cx + 17, cy + 6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = COLOR.water;
    ctx.fillRect(cx - 6, cy - 2, 3, 3);
  }
}

/** The bonus catch, at most one on the strait at a time. */
export class Fish extends Actor {
  /** The bay it is in, `0` to `4` left to right. */
  bay = 0;

  constructor() {
    super();
    this.attach(new FishArt()).layer = LAYER.fish;
  }
}

/** The row's top edge, which is where a lane body's transform sits. */
export function laneBodyY(row: number): number {
  return tileTop(row);
}

// ---- Finding the bodies -------------------------------------------------
//
// `world.byTag` is the lookup `specs/state.md` names, and it reports live actors
// alone, so a body destroyed earlier in the same frame is already gone from
// every reading below.

/** The critter, which lives for the whole session. */
export function critterOf(world: World): Critter {
  const found = world.byTag(TAGS.critter)[0];
  if (!(found instanceof Critter)) {
    throw new Error("Floe: the open world carries no tagged critter");
  }
  return found;
}

/** Every bear on the strait, in roster order. */
export function bearsOf(world: World): Bear[] {
  return world
    .byTag(TAGS.bear)
    .filter((actor): actor is Bear => actor instanceof Bear);
}

/** Every vehicle on the ice band, in roster order. */
export function vehiclesOf(world: World): Vehicle[] {
  return world
    .byTag(TAGS.vehicle)
    .filter((actor): actor is Vehicle => actor instanceof Vehicle);
}

/** Every floe on the water band, in roster order. */
export function floesOf(world: World): IceFloe[] {
  return world
    .byTag(TAGS.floe)
    .filter((actor): actor is IceFloe => actor instanceof IceFloe);
}

/** The bonus catch, or `null` while none is out. */
export function fishOf(world: World): Fish | null {
  const found = world.byTag(TAGS.fish)[0];
  return found instanceof Fish ? found : null;
}

/** The bear with that id, or `null`. */
export function bearById(world: World, id: number): Bear | null {
  return bearsOf(world).find((bear) => bear.id === id) ?? null;
}
