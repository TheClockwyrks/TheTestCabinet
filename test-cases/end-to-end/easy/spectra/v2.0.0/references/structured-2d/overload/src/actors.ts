// Spectra — the field's actors and the pass that keeps them in step with the
// state (specs/state.md, specs/overview.md).
//
// The state is the whole of the authoritative game, and these actors are how the
// engine's pipeline draws it. Each one carries the id of the entity it stands for
// and holds nothing authoritative of its own: its draw component looks its entity
// up in the world's game state at the call, so the picture is always the frame the
// simulation just produced. The actors the field carries are tagged with the names
// in `TAGS` — the ship, the drones, the two bullet kinds and the bursts — so each
// kind is found by tag.
//
// `syncField` runs at the end of the game mode's tick, after the simulation has
// left its rosters settled and before the pipeline renders: it spawns an actor for
// an entity that has appeared, destroys the one whose entity is gone, and writes
// each survivor's transform. A destroyed actor stops rendering at once, so a
// bullet consumed this frame is not drawn this frame.
//
// THERE ARE NO COLLIDERS. The engine's collision pass runs once a frame, and
// `specs/simulation.md` decides a contact at the end of every sub-step of at most
// `SUBSTEP_MAX` — a finer grain than one frame — as an overlap of two circles about
// their centres. The contact model is therefore the game's own, in
// `src/contacts.ts`, and declaring colliders the game never reads would only
// describe the field twice.

import { Actor, DrawComponent } from "@clockwyrks/structured-2d";
import type { ActorSpec, DrawApi, World } from "@clockwyrks/structured-2d";
import { SHIP_Y, TAGS } from "./constants";
import { spectraState, type SpectraState } from "./game";
import {
  drawBullet,
  drawBurst,
  drawDischarge,
  drawDrone,
  drawShip,
  renderField,
  renderHud,
  renderInversion,
  renderScreens,
  renderStarfield,
} from "./render";
import { LAYER } from "./theme";

/** One layer of the picture, drawn from the live state at its own place. */
abstract class Painter extends DrawComponent {
  constructor(layer: number) {
    super();
    this.layer = layer;
  }

  draw(api: DrawApi): void {
    this.paint(spectraState(this.actor.world), api.ctx);
  }

  protected abstract paint(
    state: SpectraState,
    ctx: CanvasRenderingContext2D,
  ): void;
}

/** A painter built from one of `src/render.ts`'s whole-state functions. */
function painter(
  layer: number,
  paint: (state: SpectraState, ctx: CanvasRenderingContext2D) => void,
): Painter {
  return new (class extends Painter {
    constructor() {
      super(layer);
    }

    protected override paint(
      state: SpectraState,
      ctx: CanvasRenderingContext2D,
    ): void {
      paint(state, ctx);
    }
  })();
}

/**
 * The stage itself: the play field and its two HUD strips, the starfield behind
 * them, the mark an inversion carries, the live discharge wave, the HUD's
 * readouts, and whichever screen is up. One actor, one component per layer, so the
 * order the picture overlaps in is the pipeline's.
 */
export class Field extends Actor {
  constructor() {
    super();
    this.attach(painter(LAYER.field, renderField));
    this.attach(painter(LAYER.starfield, renderStarfield));
    this.attach(painter(LAYER.inversion, renderInversion));
    this.attach(painter(LAYER.discharge, drawDischarge));
    this.attach(painter(LAYER.hud, renderHud));
    this.attach(painter(LAYER.screens, renderScreens));
  }
}

/** The ship, inside its lane. */
export class Ship extends Actor {
  constructor() {
    super();
    this.transform.y = SHIP_Y;
    this.attach(painter(LAYER.ship, drawShip));
  }

  override tick(): void {
    // The transform follows the state so the world describes where the ship is;
    // the state is what decides it.
    this.transform.x = spectraState(this.world).ship.x;
  }
}

/** An actor standing for one entity of a roster, found by its id. */
abstract class Entity extends Actor {
  id = 0;
}

/**
 * A painter for one entity of a roster. It reads the id off the actor it is
 * attached to, so the component holds nothing and the actor is the only thing that
 * knows which entity it stands for.
 */
abstract class EntityPainter extends Painter {
  protected entityId(): number {
    const owner = this.actor;
    return owner instanceof Entity ? owner.id : 0;
  }
}

class DronePainter extends EntityPainter {
  constructor() {
    super(LAYER.drones);
  }

  protected override paint(
    state: SpectraState,
    ctx: CanvasRenderingContext2D,
  ): void {
    const id = this.entityId();
    const drone = state.drones.find((entry) => entry.id === id);
    if (drone !== undefined) drawDrone(state, ctx, drone);
  }
}

class BulletPainter extends EntityPainter {
  constructor() {
    super(LAYER.bullets);
  }

  protected override paint(
    state: SpectraState,
    ctx: CanvasRenderingContext2D,
  ): void {
    const id = this.entityId();
    const bullet = state.bullets.find((entry) => entry.id === id);
    if (bullet !== undefined) drawBullet(state, ctx, bullet);
  }
}

class BurstPainter extends EntityPainter {
  constructor() {
    super(LAYER.bursts);
  }

  protected override paint(
    state: SpectraState,
    ctx: CanvasRenderingContext2D,
  ): void {
    const id = this.entityId();
    const burst = state.bursts.find((entry) => entry.id === id);
    if (burst !== undefined) drawBurst(state, ctx, burst);
  }
}

/** One drone on the field. */
export class Drone extends Entity {
  constructor() {
    super();
    this.attach(new DronePainter());
  }
}

/** One bullet in flight, of either kind. */
export class Bullet extends Entity {
  constructor() {
    super();
    this.attach(new BulletPainter());
  }
}

/** One drone-burst playing. */
export class Burst extends Entity {
  constructor() {
    super();
    this.attach(new BurstPainter());
  }
}

/** The actors the level itself places: the stage, and the ship inside it. */
export function fieldActors(): ActorSpec[] {
  return [{ type: Field }, { type: Ship, tags: [TAGS.ship] }];
}

/** The live actors of one roster, by the id each stands for. */
function held(world: World, tag: string): Map<number, Entity> {
  const byId = new Map<number, Entity>();
  for (const actor of world.byTag(tag)) {
    if (actor instanceof Entity && actor.alive) byId.set(actor.id, actor);
  }
  return byId;
}

/** One roster's actors, brought into step with the entities it holds. */
function syncRoster<E extends { id: number; x: number; y: number }>(
  world: World,
  tag: string,
  type: new () => Entity,
  entities: readonly E[],
): void {
  const actors = held(world, tag);
  for (const entity of entities) {
    const actor =
      actors.get(entity.id) ??
      world.spawn(type, {
        tags: [tag],
        configure: (spawned) => {
          spawned.id = entity.id;
        },
      });
    actors.delete(entity.id);
    actor.transform.x = entity.x;
    actor.transform.y = entity.y;
  }
  for (const orphan of actors.values()) orphan.destroy();
}

/**
 * Bring the field's actors into step with the state's rosters.
 *
 * Called at the end of the game mode's tick, so the actors the pipeline collects a
 * moment later are exactly the entities this frame's simulation left standing.
 */
export function syncField(world: World, state: SpectraState): void {
  syncRoster(world, TAGS.drone, Drone, state.drones);
  syncRoster(
    world,
    TAGS.playerBullet,
    Bullet,
    state.bullets.filter((bullet) => bullet.friendly),
  );
  syncRoster(
    world,
    TAGS.enemyBullet,
    Bullet,
    state.bullets.filter((bullet) => !bullet.friendly),
  );
  syncRoster(world, TAGS.burst, Burst, state.bursts);

  const ship = world.byTag(TAGS.ship)[0];
  if (ship !== undefined) ship.transform.x = state.ship.x;
}
