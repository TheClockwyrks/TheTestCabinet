// Meltdown — the floor's bodies, as actors the engine constructs and renders.
//
// Every tower and every surge unit on the floor is an actor carrying its tag
// from `TAGS`, so `world.byTag` finds it under the name the specification uses,
// and the held preview and the build panel are actors of their own. None of
// them holds authoritative state: each carries the id of the entry it draws and
// reads that entry off the world's `MeltdownState` at the call, so the picture
// is always the frame the mode just settled (specs/state.md, The contract).
//
// `syncActors` is what keeps the actor set equal to the rosters. It runs at the
// end of the mode's tick and again after every debug pose that adds or removes
// an entity, so a scenario posed from code leaves the world as whole as a
// scenario reached by playing.

import { Actor, DrawComponent } from "@clockwyrks/structured-2d";
import type { DrawApi, World } from "@clockwyrks/structured-2d";
import { TAGS } from "./constants";
import { sizeOf } from "./geometry";
import { footprintCentre } from "./constants";
import {
  drawFloor,
  drawPanel,
  drawPreview,
  drawScreen,
  drawTower,
  drawUnit,
  showsFloor,
} from "./render";
import { meltdownState } from "./game";

/** The layer each part of the picture is drawn on. */
export const LAYER = {
  floor: 0,
  towers: 10,
  units: 20,
  preview: 30,
  panel: 40,
  screens: 50,
} as const;

class FloorLayer extends DrawComponent {
  constructor() {
    super();
    this.layer = LAYER.floor;
  }

  draw(api: DrawApi): void {
    const state = meltdownState(this.actor.world);
    if (!showsFloor(state)) return;
    drawFloor(state, api.ctx);
  }
}

/** The casing, the floor, the grid, and any build zone. */
export class FloorActor extends Actor {
  constructor() {
    super();
    this.attach(new FloorLayer());
  }
}

class TowerLayer extends DrawComponent {
  constructor() {
    super();
    this.layer = LAYER.towers;
  }

  draw(api: DrawApi): void {
    const actor = this.actor as TowerActor;
    const state = meltdownState(actor.world);
    if (!showsFloor(state)) return;
    const tower = state.towers.find((entry) => entry.id === actor.towerId);
    if (tower === undefined) return;
    drawTower(state, tower, api.ctx);
  }
}

/** One tower standing on the floor. */
export class TowerActor extends Actor {
  /** The roster entry this actor draws. */
  towerId = 0;

  constructor() {
    super();
    this.attach(new TowerLayer());
  }

  override tick(): void {
    const state = meltdownState(this.world);
    const tower = state.towers.find((entry) => entry.id === this.towerId);
    if (tower === undefined) return;
    const centre = footprintCentre(tower.col, tower.row, sizeOf(tower.type));
    this.transform.x = centre.x;
    this.transform.y = centre.y;
  }
}

class UnitLayer extends DrawComponent {
  constructor() {
    super();
    this.layer = LAYER.units;
  }

  draw(api: DrawApi): void {
    const actor = this.actor as UnitActor;
    const state = meltdownState(actor.world);
    if (!showsFloor(state)) return;
    const unit = state.surge.find((entry) => entry.id === actor.unitId);
    if (unit === undefined) return;
    drawUnit(unit, api.ctx);
  }
}

/** One surge unit crossing the floor. */
export class UnitActor extends Actor {
  /** The roster entry this actor draws. */
  unitId = 0;

  constructor() {
    super();
    this.attach(new UnitLayer());
  }

  override tick(): void {
    const state = meltdownState(this.world);
    const unit = state.surge.find((entry) => entry.id === this.unitId);
    if (unit === undefined) return;
    this.transform.x = unit.x;
    this.transform.y = unit.y;
  }
}

class PreviewLayer extends DrawComponent {
  constructor() {
    super();
    this.layer = LAYER.preview;
  }

  draw(api: DrawApi): void {
    const state = meltdownState(this.actor.world);
    if (!showsFloor(state)) return;
    drawPreview(state, api.ctx);
  }
}

/** The held build preview and the range ring of a selected tower. */
export class PreviewActor extends Actor {
  constructor() {
    super();
    this.attach(new PreviewLayer());
  }
}

class PanelLayer extends DrawComponent {
  constructor() {
    super();
    this.layer = LAYER.panel;
  }

  draw(api: DrawApi): void {
    const state = meltdownState(this.actor.world);
    if (!showsFloor(state)) return;
    drawPanel(state, api.ctx);
  }
}

/** The build panel: every readout and every control the game offers. */
export class PanelActor extends Actor {
  constructor() {
    super();
    this.attach(new PanelLayer());
  }
}

class ScreenLayer extends DrawComponent {
  constructor() {
    super();
    this.layer = LAYER.screens;
  }

  draw(api: DrawApi): void {
    drawScreen(meltdownState(this.actor.world), api.ctx);
  }
}

/** The title, the two choice screens, the how-to, the pause menu, and the ends. */
export class ScreenActor extends Actor {
  constructor() {
    super();
    this.attach(new ScreenLayer());
  }
}

/** Bring the actor set level with the rosters the state declares. */
export function syncActors(world: World): void {
  const state = meltdownState(world);

  const towerActors = new Map<number, TowerActor>();
  for (const actor of world.ofType(TowerActor)) {
    towerActors.set(actor.towerId, actor);
  }
  for (const tower of state.towers) {
    if (towerActors.has(tower.id)) continue;
    const centre = footprintCentre(tower.col, tower.row, sizeOf(tower.type));
    world.spawn(TowerActor, {
      transform: { x: centre.x, y: centre.y },
      tags: [TAGS.tower],
      configure: (actor) => {
        actor.towerId = tower.id;
      },
    });
  }
  for (const [id, actor] of towerActors) {
    if (!state.towers.some((tower) => tower.id === id)) actor.destroy();
  }

  const unitActors = new Map<number, UnitActor>();
  for (const actor of world.ofType(UnitActor)) {
    unitActors.set(actor.unitId, actor);
  }
  for (const unit of state.surge) {
    if (unitActors.has(unit.id)) continue;
    world.spawn(UnitActor, {
      transform: { x: unit.x, y: unit.y },
      tags: [TAGS.unit],
      configure: (actor) => {
        actor.unitId = unit.id;
      },
    });
  }
  for (const [id, actor] of unitActors) {
    if (!state.surge.some((unit) => unit.id === id)) actor.destroy();
  }
}
