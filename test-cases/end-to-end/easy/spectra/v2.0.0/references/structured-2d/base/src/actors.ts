// Spectra — the field's actors and the components that draw them.
//
// The world holds one actor per THING on the field, each tagged with the name
// `TAGS` gives it (`specs/state.md`), so the ship, the drones, the two bullet
// kinds and the bursts are each found by tag. `syncField` is what keeps that
// population and the game state's rosters in step: it is called at the end of the
// game mode's tick, after the simulation has advanced and before the pipeline
// renders, so every actor on the field this frame is an entity the state holds and
// stands exactly where the state puts it.
//
// THE STATE IS THE AUTHORITY AND AN ACTOR IS ITS PRESENTATION. An actor holds its
// entity's `id` and nothing else — no position of its own, no band, no phase — and
// each of its draw components reads the entity out of the live state at the call.
// That is what `specs/state.md`'s contract asks for: every value carried from one
// frame to the next lives on the state, and what an actor holds is derived data
// rebuilt from it. A frame that finds its entity gone draws nothing, which cannot
// outlast the frame because `syncField` destroys the actor in the same tick.
//
// WHY THERE ARE NO COLLIDERS. The engine's collision system reports pairs once per
// frame, after the actors have moved; `specs/simulation.md` divides a frame into
// whole sub-steps of at most `SUBSTEP_MAX` and resolves contacts at the end of EACH
// of them, in a stated order, so one frame of Spectra resolves contact up to a
// hundred and twenty times. The contact model is a circle overlap the game runs
// itself inside that loop (`src/simulate.ts`), which is what makes an interval of
// game time reach the same state however it was divided into frames. A collider
// per entity would report a second, coarser set of contacts that no rule reads.

import { Actor, DrawComponent } from "@test-cabinet/structured-2d";
import type { DrawApi, World } from "@test-cabinet/structured-2d";
import { SHIP_Y, TAGS } from "./constants";
import { spectraState, type SpectraState } from "./game";
import {
  fieldVisible,
  renderBullet,
  renderBurst,
  renderDischarge,
  renderDrone,
  renderGround,
  renderHud,
  renderInversion,
  renderScreen,
  renderShip,
  renderStrips,
} from "./render";
import { LAYER } from "./theme";

/** One layer of the picture, drawn from the live state at its own place. */
abstract class Layer extends DrawComponent {
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

/** A layer that is part of the play field, and so absent on the two front screens. */
abstract class FieldLayer extends Layer {
  override draw(api: DrawApi): void {
    if (!fieldVisible(spectraState(this.actor.world).screen)) return;
    super.draw(api);
  }
}

/** The play field's ground and the starfield behind everything on it. */
class Ground extends Layer {
  constructor() {
    super(LAYER.field);
  }

  protected override paint(
    state: SpectraState,
    ctx: CanvasRenderingContext2D,
  ): void {
    renderGround(state, ctx);
  }
}

/** The field-wide mark a spectral inversion carries. */
class Inversion extends Layer {
  constructor() {
    super(LAYER.inversion);
  }

  protected override paint(
    state: SpectraState,
    ctx: CanvasRenderingContext2D,
  ): void {
    renderInversion(state, ctx);
  }
}

/** The two HUD strips' own ground, under everything the field carries. */
class Strips extends Layer {
  constructor() {
    super(LAYER.strips);
  }

  protected override paint(
    _state: SpectraState,
    ctx: CanvasRenderingContext2D,
  ): void {
    renderStrips(ctx);
  }
}

/** The live discharge wave, over everything it crosses. */
class Discharge extends FieldLayer {
  constructor() {
    super(LAYER.discharge);
  }

  protected override paint(
    state: SpectraState,
    ctx: CanvasRenderingContext2D,
  ): void {
    renderDischarge(state, ctx);
  }
}

/** Both strips' readouts. */
class Hud extends Layer {
  constructor() {
    super(LAYER.hud);
  }

  protected override paint(
    state: SpectraState,
    ctx: CanvasRenderingContext2D,
  ): void {
    renderHud(state, ctx);
  }
}

/** Whichever screen is up. */
class ScreenOverlay extends Layer {
  constructor() {
    super(LAYER.screens);
  }

  protected override paint(
    state: SpectraState,
    ctx: CanvasRenderingContext2D,
  ): void {
    renderScreen(state, ctx);
  }
}

/**
 * The stage: the one actor the level places beside the ship.
 *
 * It carries everything about the picture that is not an entity of a roster — the
 * field, the inversion's mark, the HUD strips and their readouts, the discharge
 * wave, and whichever screen is up — one `DrawComponent` per layer.
 */
export class Stage extends Actor {
  constructor() {
    super();
    this.attach(new Ground());
    this.attach(new Inversion());
    this.attach(new Strips());
    this.attach(new Discharge());
    this.attach(new Hud());
    this.attach(new ScreenOverlay());
  }
}

/** The ship's hull, drawn at the actor's own place in its lane. */
class ShipBody extends FieldLayer {
  constructor() {
    super(LAYER.ship);
  }

  override draw(api: DrawApi): void {
    const state = spectraState(this.actor.world);
    // The ship is gone for the length of the ready hold and on the game-over
    // screen (`specs/progression.md`).
    if (state.phase === "ready" || state.screen === "gameOver") return;
    super.draw(api);
  }

  protected override paint(
    state: SpectraState,
    ctx: CanvasRenderingContext2D,
  ): void {
    renderShip(state, ctx, this.worldTransform().x);
  }
}

/**
 * The ship. The level places one, and `syncField` carries its transform to the
 * lane position the state holds.
 */
export class Ship extends Actor {
  constructor() {
    super();
    this.attach(new ShipBody());
  }
}

/** An actor standing for one entity of a roster, found by the entity's id. */
abstract class Entity extends Actor {
  /** The id of the entity in the state this actor draws. */
  entityId = 0;
}

/** One drone, drawn from its own record in the state. */
class DroneBody extends FieldLayer {
  constructor() {
    super(LAYER.drones);
  }

  protected override paint(
    state: SpectraState,
    ctx: CanvasRenderingContext2D,
  ): void {
    const id = (this.actor as Entity).entityId;
    const drone = state.drones.find((entry) => entry.id === id);
    if (drone === undefined) return;
    const at = this.worldTransform();
    renderDrone(state, ctx, drone, at.x, at.y);
  }
}

/** One drone on the field. */
export class Drone extends Entity {
  constructor() {
    super();
    this.attach(new DroneBody());
  }
}

/** One bullet, drawn from its own record in the state. */
class BulletBody extends FieldLayer {
  constructor() {
    super(LAYER.bullets);
  }

  protected override paint(
    state: SpectraState,
    ctx: CanvasRenderingContext2D,
  ): void {
    const id = (this.actor as Entity).entityId;
    const bullet = state.bullets.find((entry) => entry.id === id);
    if (bullet === undefined) return;
    const at = this.worldTransform();
    renderBullet(state, ctx, bullet, at.x, at.y);
  }
}

/** One bullet in flight, the player's or a drone's. */
export class Bullet extends Entity {
  constructor() {
    super();
    this.attach(new BulletBody());
  }
}

/** One drone-burst, drawn from its own simulation. */
class BurstBody extends FieldLayer {
  constructor() {
    super(LAYER.bursts);
  }

  protected override paint(
    state: SpectraState,
    ctx: CanvasRenderingContext2D,
  ): void {
    const id = (this.actor as Entity).entityId;
    const burst = state.bursts.find((entry) => entry.id === id);
    if (burst === undefined) return;
    const at = this.worldTransform();
    renderBurst(ctx, burst, at.x, at.y);
  }
}

/** One drone-burst playing. */
export class Burst extends Entity {
  constructor() {
    super();
    this.attach(new BurstBody());
  }
}

/** The entities of one roster, as the actors standing for them. */
function entities(world: World, tag: string): Entity[] {
  return world
    .byTag(tag)
    .filter((actor): actor is Entity => actor instanceof Entity && actor.alive);
}

/** One record of a roster, as far as the population needs it. */
interface Placed {
  id: number;
  x: number;
  y: number;
}

/**
 * Bring the actors carrying `tag` into line with `records`.
 *
 * An actor whose entity has left the roster is destroyed, an entity with no actor
 * yet is given one, and every remaining actor is carried to its entity's centre.
 * Ids are never reused while their entity is alive (`specs/instrumentation.md`),
 * so matching on the id is exact.
 */
function syncRoster(
  world: World,
  tag: string,
  type: new () => Entity,
  records: readonly Placed[],
): void {
  const actors = new Map(
    entities(world, tag).map((actor) => [actor.entityId, actor]),
  );
  for (const record of records) {
    const actor =
      actors.get(record.id) ??
      world.spawn(type, {
        tags: [tag],
        configure: (spawned: Entity) => {
          spawned.entityId = record.id;
        },
      });
    actors.delete(record.id);
    actor.transform.x = record.x;
    actor.transform.y = record.y;
  }
  for (const stale of actors.values()) stale.destroy();
}

/**
 * Bring the field's actors into line with the state's rosters.
 *
 * Called from the game mode's `beginPlay` and at the end of its tick, so the
 * population the pipeline renders is the population the frame's simulation left
 * behind.
 */
export function syncField(world: World, state: SpectraState): void {
  const ship = world.byTag(TAGS.ship)[0];
  if (ship !== undefined) {
    ship.transform.x = state.ship.x;
    ship.transform.y = SHIP_Y;
  }

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
}
