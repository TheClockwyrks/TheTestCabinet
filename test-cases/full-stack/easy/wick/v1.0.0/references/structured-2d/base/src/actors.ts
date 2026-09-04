// Wick — the actors that populate the night, and the components that draw
// them.
//
// The world's game state (`src/state.ts`) is the one authoritative record of
// the simulation; the actors here draw it and hold nothing of their own
// beyond which record each one shows. Each kind of thing in the night, the
// lamplighter, every enemy, projectile, zone, gem, and pickup, the HUD, and
// the screen chrome, carries its tag from `TAGS`, so a lookup by the build's
// fixed vocabulary finds it, and `reconcileActors` keeps the population
// mirroring the state after every frame's ticks: a record that appeared gains
// an actor, a record that resolved away loses one, wherever the change came
// from, play or a debug pose.
//
// Rendering goes through the engine's pipeline: every picture below is a
// render component collected and ordered by layer (`src/theme.ts` numbers
// them), drawing in world units at the position its record holds, and each
// `draw` is a pure read of the live state at the frame being drawn. The HUD
// and the screens are ordinary components on actors the mode keeps at the
// camera target's position, each offset in stage units from the stage
// center, so at zoom `1` they draw at fixed logical positions and keep their
// place in the layer order like any other picture.

import {
  Actor,
  CameraComponent,
  DrawComponent,
  Pawn,
  type DrawApi,
  type World,
} from "@test-cabinet/structured-2d";
import { wickAssets } from "./assets";
import { STAGE_CX, STAGE_CY, TAGS } from "./constants";
import { dim } from "./render/draw";
import { drawProjectile, drawZone } from "./render/effects";
import { drawHud, drawHurt } from "./render/hud";
import { HELD_SCREENS, HUD_SCREENS, drawScreen } from "./render/screens";
import { LAYERS } from "./render/theme";
import {
  drawEnemy,
  drawGem,
  drawGround,
  drawLamplight,
  drawLamplighterAt,
  drawPickup,
  drawPuff,
} from "./render/world";
import { wickState, type WickState } from "./state";
import type {
  EnemyState,
  GemState,
  PickupState,
  ProjectileState,
  Puff,
  ZoneState,
} from "./state";

// --- The ground -----------------------------------------------------------

/** The produced tile repeated in world space across the view. */
class GroundLayer extends DrawComponent {
  constructor() {
    super();
    this.layer = LAYERS.ground;
  }

  draw(api: DrawApi): void {
    const camera = api.camera();
    drawGround(api.ctx, camera.x, camera.y, wickAssets());
  }
}

/** The ground under everything. The level declares one. */
export class GroundActor extends Actor {
  constructor() {
    super();
    this.attach(new GroundLayer());
  }
}

// --- The lamplighter ------------------------------------------------------

/**
 * The lamplighter's picture. The facing mirror lives here, on the sprite
 * component's own transform rather than on the followed actor's, so the
 * camera the actor carries is never mirrored with it.
 */
export class LamplighterSprite extends DrawComponent {
  constructor() {
    super();
    this.layer = LAYERS.lamplighter;
  }

  override tick(): void {
    this.offset.scaleX =
      wickState(this.world).run.player.facing === "left" ? -1 : 1;
  }

  draw(api: DrawApi): void {
    const state = wickState(this.world);
    const at = this.worldTransform();
    const { ctx } = api;
    ctx.save();
    ctx.translate(at.x, at.y);
    ctx.scale(at.scaleX, at.scaleY);
    drawLamplighterAt(ctx, state.run, wickAssets(), 0, 0);
    ctx.restore();
  }
}

/** The lamp's light on the ground, under everything but the ground. */
class LamplightLayer extends DrawComponent {
  constructor() {
    super();
    this.layer = LAYERS.lamplight;
  }

  draw(api: DrawApi): void {
    const at = this.actor.transform;
    drawLamplight(api.ctx, at.x, at.y);
  }
}

/**
 * The lamplighter, the one pawn: the player controller possesses it, the
 * simulation's phase 2 is what moves it, and it carries the camera the world
 * follows at zoom `1`. Its transform mirrors the state's `player` after every
 * frame's ticks, so the camera formula of `specs/world.md` holds exactly.
 */
export class LamplighterPawn extends Pawn {
  readonly sprite: LamplighterSprite;

  constructor() {
    super();
    this.addTag(TAGS.lamplighter);
    this.attach(new LamplightLayer());
    this.sprite = this.attach(new LamplighterSprite());
    this.attach(new CameraComponent({ zoom: 1 }));
  }

  /** Put the actor where the state's lamplighter stands. */
  follow(state: WickState): void {
    this.transform.x = state.run.player.x;
    this.transform.y = state.run.player.y;
  }

  override tick(): void {
    this.follow(wickState(this.world));
  }
}

// --- The populated night --------------------------------------------------

/**
 * One actor following one record of the state, by identity. The reconciler
 * moves it to where its record stands after every frame's ticks, so its
 * transform describes the state the frame settled on.
 */
abstract class RecordActor<R extends { x: number; y: number }> extends Actor {
  record!: R;

  /** Put the actor where its record stands. */
  follow(): void {
    this.transform.x = this.record.x;
    this.transform.y = this.record.y;
  }
}

class EnemyLayer extends DrawComponent {
  constructor(private readonly owner: EnemyActor) {
    super();
    this.layer = LAYERS.enemies;
  }

  draw(api: DrawApi): void {
    drawEnemy(api.ctx, wickAssets(), this.owner.record);
  }
}

export class EnemyActor extends RecordActor<EnemyState> {
  constructor() {
    super();
    this.attach(new EnemyLayer(this));
  }
}

class ProjectileLayer extends DrawComponent {
  constructor(private readonly owner: ProjectileActor) {
    super();
    this.layer = LAYERS.projectiles;
  }

  draw(api: DrawApi): void {
    const state = wickState(this.world);
    drawProjectile(api.ctx, state.run, wickAssets(), this.owner.record);
  }
}

export class ProjectileActor extends RecordActor<ProjectileState> {
  constructor() {
    super();
    this.attach(new ProjectileLayer(this));
  }
}

/** The zones on the ground draw under the crowd; the ones in the air over it. */
class ZoneLayer extends DrawComponent {
  constructor(private readonly owner: ZoneActor) {
    super();
    this.layer = LAYERS.airZones;
  }

  override beginPlay(): void {
    const { kind } = this.owner.record;
    this.layer =
      kind === "puddle" || kind === "aura"
        ? LAYERS.groundZones
        : LAYERS.airZones;
  }

  draw(api: DrawApi): void {
    const state = wickState(this.world);
    drawZone(api.ctx, state.run, wickAssets(), this.owner.record);
  }
}

export class ZoneActor extends RecordActor<ZoneState> {
  constructor() {
    super();
    this.attach(new ZoneLayer(this));
  }
}

class GemLayer extends DrawComponent {
  constructor(private readonly owner: GemActor) {
    super();
    this.layer = LAYERS.gems;
  }

  draw(api: DrawApi): void {
    drawGem(api.ctx, wickAssets(), this.owner.record);
  }
}

export class GemActor extends RecordActor<GemState> {
  constructor() {
    super();
    this.attach(new GemLayer(this));
  }
}

class PickupLayer extends DrawComponent {
  constructor(private readonly owner: PickupActor) {
    super();
    this.layer = LAYERS.pickups;
  }

  draw(api: DrawApi): void {
    drawPickup(api.ctx, wickAssets(), this.owner.record);
  }
}

export class PickupActor extends RecordActor<PickupState> {
  constructor() {
    super();
    this.attach(new PickupLayer(this));
  }
}

class PuffLayer extends DrawComponent {
  constructor(private readonly owner: PuffActor) {
    super();
    this.layer = LAYERS.puffs;
  }

  draw(api: DrawApi): void {
    const state = wickState(this.world);
    drawPuff(api.ctx, state.run, wickAssets(), this.owner.record);
  }
}

/** A death puff: a picture, damaging nothing, gone after `PUFF_TIME`. */
export class PuffActor extends RecordActor<Puff> {
  constructor() {
    super();
    this.attach(new PuffLayer(this));
  }
}

// --- The HUD and the screens ----------------------------------------------

/**
 * A component drawn at a fixed logical position: its `offset` is the
 * stage's top-left in stage units from the stage center, so on an actor held
 * at the camera target it lands on the stage's top-left whatever the camera
 * shows, and the context is translated there before the picture is laid out
 * in stage coordinates.
 */
abstract class StageLayer extends DrawComponent {
  constructor(layer: number) {
    super();
    this.layer = layer;
    this.offset.x = -STAGE_CX;
    this.offset.y = -STAGE_CY;
  }

  abstract drawStage(ctx: CanvasRenderingContext2D, state: WickState): void;

  draw(api: DrawApi): void {
    const at = this.worldTransform();
    const { ctx } = api;
    ctx.save();
    ctx.translate(at.x, at.y);
    this.drawStage(ctx, wickState(this.world));
    ctx.restore();
  }
}

/**
 * The HUD: drawn on the night and on every overlay held over it, over the
 * dimming that quiets the held world and over the hurt cast the view carries
 * while the lamplighter's flash runs.
 */
class HudLayer extends StageLayer {
  constructor() {
    super(LAYERS.hud);
  }

  drawStage(ctx: CanvasRenderingContext2D, state: WickState): void {
    if (!HUD_SCREENS.includes(state.screen)) return;
    if (HELD_SCREENS.includes(state.screen)) dim(ctx);
    drawHurt(ctx, state.run.hurtFlash);
    drawHud(ctx, state.run, wickAssets());
  }
}

/** The menus, the overlays, and the end cards, over the HUD. */
class ScreenLayer extends StageLayer {
  constructor() {
    super(LAYERS.screen);
  }

  drawStage(ctx: CanvasRenderingContext2D, state: WickState): void {
    drawScreen(ctx, state, wickAssets());
  }
}

/** An actor the mode keeps at the camera target's position. */
export class PinnedActor extends Actor {
  override tick(): void {
    this.pin(wickState(this.world));
  }

  /** Put the actor where the camera target stands: the lamplighter. */
  pin(state: WickState): void {
    this.transform.x = state.run.player.x;
    this.transform.y = state.run.player.y;
  }
}

/** The HUD actor. The level declares one. */
export class HudActor extends PinnedActor {
  constructor() {
    super();
    this.addTag(TAGS.hud);
    this.attach(new HudLayer());
  }
}

/** The screen chrome actor. The level declares one. */
export class ScreenActor extends PinnedActor {
  constructor() {
    super();
    this.addTag(TAGS.screen);
    this.attach(new ScreenLayer());
  }
}

// --- Keeping the population honest ----------------------------------------

/** Spawn or destroy actors of `type` so one follows each record in `records`. */
function mirror<R extends { x: number; y: number }, A extends RecordActor<R>>(
  world: World,
  type: new () => A,
  tag: string | null,
  records: readonly R[],
): void {
  const wanted = new Set(records);
  for (const actor of world.ofType(type)) {
    if (wanted.has(actor.record)) {
      wanted.delete(actor.record);
      actor.follow();
    } else {
      actor.destroy();
    }
  }
  for (const record of wanted) {
    world.spawn(type, {
      transform: { x: record.x, y: record.y },
      tags: tag === null ? [] : [tag],
      configure: (actor) => {
        actor.record = record;
      },
    });
  }
}

/**
 * Make the actor population mirror the state: one tagged actor per live
 * enemy, projectile, zone, gem, pickup, and puff, spawned for a record that
 * appeared and destroyed for one that is gone, and the lamplighter and the
 * pinned actors moved to where the state puts them. Run from the game mode
 * after each frame's ticks, so the frame's picture, the camera, and every tag
 * query describe the state the frame settled on.
 */
export function reconcileActors(world: World, state: WickState): void {
  const { run } = state;
  mirror(world, EnemyActor, TAGS.enemy, run.enemies);
  mirror(world, ProjectileActor, TAGS.projectile, run.projectiles);
  mirror(world, ZoneActor, TAGS.zone, run.zones);
  mirror(world, GemActor, TAGS.gem, run.gems);
  mirror(world, PickupActor, TAGS.pickup, run.pickups);
  mirror(world, PuffActor, null, run.puffs);
  world.find(LamplighterPawn)?.follow(state);
  for (const pinned of world.ofType(PinnedActor)) pinned.pin(state);
}
