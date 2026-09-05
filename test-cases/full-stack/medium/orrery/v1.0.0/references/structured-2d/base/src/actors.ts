// Orrery — the actors that populate the world, and the components that draw
// them.
//
// The world's game state (`src/state.ts`) is the one authoritative record of
// the game; the actors here DRAW it and hold nothing of their own beyond which
// record each one shows. Each kind of thing on the field — every mote, every
// filament, every placed part — carries its tag from `TAGS`, so a lookup by the
// build's fixed vocabulary finds it, and `reconcileActors` keeps the actor
// population mirroring the state after every frame's ticks: a record that
// appeared gains an actor, a record that resolved away loses one, wherever the
// change came from — play, or a debug pose.
//
// Rendering goes through the engine's pipeline: every picture below is a render
// component collected and ordered by layer (`LAYERS` in `src/theme.ts` numbers
// them), and each `draw` is a pure read of the live state at the frame being
// drawn, so a pose made between frames is on screen the next frame.
//
// The field's pictures are CLIPPED to the field's own region. Motes rest off
// the field freely and an effect is a soft cloud around its event, so clipping
// is what keeps the run inside the region `specs/editor.md` gives it rather
// than spilling over the tray and the readout.

import {
  Actor,
  DrawComponent,
  type DrawApi,
  type World,
} from "@clockwyrks/structured-2d";
import { orrerySprites } from "./assets";
import {
  HEADING_H,
  READOUT_X0,
  STAGE_H,
  STAGE_W,
  TAGS,
  TAPE_Y0,
  TRAY_REGION_W,
} from "./constants";
import { fillRect } from "./draw";
import {
  drawCells,
  drawEngraving,
  drawFilament,
  drawHands,
  drawMechanism,
  drawMote,
  drawTrack,
  drawnPartOf,
} from "./fielddraw";
import { FxLayer } from "./fx";
import { drawHeading, drawReadout } from "./hud";
import { drawFaultBanner, drawSolvedPanel } from "./panels";
import { partClass } from "./parts";
import { drawHowto, drawSelect, drawTitle } from "./screens";
import { orreryState, type OrreryState } from "./state";
import { drawTapePanel } from "./tapedraw";
import { COLORS, LAYERS } from "./theme";
import { drawTray } from "./traydraw";
import type { MoteState, PartState, SimFilament } from "./types";

/** Run `body` clipped to the field's region (specs/editor.md "Layout"). */
function inField(ctx: CanvasRenderingContext2D, body: () => void): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(
    TRAY_REGION_W,
    HEADING_H,
    READOUT_X0 - TRAY_REGION_W,
    TAPE_Y0 - HEADING_H,
  );
  ctx.clip();
  body();
  ctx.restore();
}

/** The state of the open world, for a component that draws it. */
function stateOf(component: { world: World }): OrreryState {
  return orreryState(component.world);
}

// --- The field ------------------------------------------------------------

/** The sky, and the field's ninety-one cells beneath everything else. */
class GroundLayer extends DrawComponent {
  constructor() {
    super();
    this.layer = LAYERS.ground;
  }

  draw(api: DrawApi): void {
    fillRect(api.ctx, 0, 0, STAGE_W, STAGE_H, COLORS.sky);
    if (stateOf(this).screen !== "editor") return;
    inField(api.ctx, () => drawCells(api.ctx));
  }
}

/** The editor's own marks: the selection, the ghost, the target, the faults. */
class HandsLayer extends DrawComponent {
  constructor() {
    super();
    this.layer = LAYERS.hands;
  }

  draw(api: DrawApi): void {
    const state = stateOf(this);
    if (state.screen !== "editor") return;
    inField(api.ctx, () => drawHands(api.ctx, state));
  }
}

/** The field itself: its ground, and the hands over the machine on it. */
export class FieldActor extends Actor {
  constructor() {
    super();
    this.addTag(TAGS.field);
    this.attach(new GroundLayer());
    this.attach(new HandsLayer());
  }
}

// --- One placed part ------------------------------------------------------

/** One placed part's picture, whichever of the three kinds it is. */
class PartLayer extends DrawComponent {
  constructor(
    private readonly owner: PartActor,
    layer: number,
  ) {
    super();
    this.layer = layer;
  }

  draw(api: DrawApi): void {
    const state = stateOf(this);
    if (state.screen !== "editor") return;
    const part = state.editor.parts.find(
      (entry) => entry.id === this.owner.partId,
    );
    if (part === undefined) return;
    const sprites = orrerySprites();
    inField(api.ctx, () => {
      switch (partClass(part.kind)) {
        case "track":
          drawTrack(api.ctx, part);
          return;
        case "arm":
        case "wheel": {
          const drawn = drawnPartOf(state, part.id);
          if (drawn !== null) drawMechanism(api.ctx, state, sprites, drawn);
          return;
        }
        default:
          drawEngraving(api.ctx, state, sprites, part);
      }
    });
  }
}

/** One placed part, following its record in `editor.parts`. */
export class PartActor extends Actor {
  partId = 0;

  /** Attach the picture once the part it shows is known. */
  place(part: PartState): void {
    this.partId = part.id;
    const cls = partClass(part.kind);
    const layer =
      cls === "track"
        ? LAYERS.track
        : cls === "arm" || cls === "wheel"
          ? LAYERS.mechanism
          : LAYERS.engraving;
    this.attach(new PartLayer(this, layer));
  }
}

// --- One mote -------------------------------------------------------------

/** One mote's produced sprite, at the position its cycle has carried it to. */
class MoteLayer extends DrawComponent {
  constructor(private readonly owner: MoteActor) {
    super();
    this.layer = LAYERS.mote;
  }

  draw(api: DrawApi): void {
    const state = stateOf(this);
    const mote = state.sim?.motes.find(
      (entry) => entry.id === this.owner.moteId,
    );
    if (mote === undefined) return;
    inField(api.ctx, () => drawMote(api.ctx, orrerySprites(), mote, state));
  }
}

/** One live mote, following its record in `sim.motes`. */
export class MoteActor extends Actor {
  moteId = 0;

  constructor() {
    super();
    this.attach(new MoteLayer(this));
  }
}

// --- One filament ---------------------------------------------------------

/** One filament's produced strip, between the motes it joins. */
class FilamentLayer extends DrawComponent {
  constructor(private readonly owner: FilamentActor) {
    super();
    this.layer = LAYERS.filament;
  }

  draw(api: DrawApi): void {
    const state = stateOf(this);
    const filament = state.sim?.filaments.find(
      (entry) => entry === this.owner.filament,
    );
    if (filament === undefined) return;
    inField(api.ctx, () =>
      drawFilament(api.ctx, state, orrerySprites(), filament),
    );
  }
}

/** One filament, following its record in `sim.filaments`. */
export class FilamentActor extends Actor {
  filament!: SimFilament;

  constructor() {
    super();
    this.attach(new FilamentLayer(this));
  }
}

// --- The effects ----------------------------------------------------------

/** The live particle effects, composited in their place in the layer order. */
export class FxActor extends Actor {
  readonly fx: FxLayer;

  constructor() {
    super();
    this.addTag(TAGS.effect);
    this.fx = this.attach(new FxLayer());
  }
}

/** The open world's effects layer. */
export function fxOf(world: World): FxLayer {
  const actor = world.find(FxActor);
  if (actor === null) {
    throw new Error("Orrery: the effects actor is missing from the world");
  }
  return actor.fx;
}

// --- The chrome -----------------------------------------------------------

/** The title, how-to, and select screens. */
class ScreenLayer extends DrawComponent {
  constructor() {
    super();
    this.layer = LAYERS.screen;
  }

  draw(api: DrawApi): void {
    const state = stateOf(this);
    switch (state.screen) {
      case "title":
        drawTitle(api.ctx, state, orrerySprites());
        return;
      case "howto":
        drawHowto(api.ctx, state);
        return;
      case "select":
        drawSelect(api.ctx, state);
        return;
      case "editor":
        return;
    }
  }
}

/** The editor's four display regions: the tray, the tape, the readout, the heading. */
class ChromeLayer extends DrawComponent {
  constructor() {
    super();
    this.layer = LAYERS.chrome;
  }

  draw(api: DrawApi): void {
    const state = stateOf(this);
    if (state.screen !== "editor") return;
    drawTray(api.ctx, state);
    drawTapePanel(api.ctx, state, orrerySprites());
    drawReadout(api.ctx, state);
    drawHeading(api.ctx, state);
  }
}

/** The solved panel and the fault display, over everything (specs/ui.md). */
class PanelLayer extends DrawComponent {
  constructor() {
    super();
    this.layer = LAYERS.panels;
  }

  draw(api: DrawApi): void {
    const state = stateOf(this);
    if (state.screen !== "editor") return;
    const status = state.sim?.status ?? null;
    if (status === "faulted") drawFaultBanner(api.ctx, state);
    if (status === "complete") drawSolvedPanel(api.ctx, state);
  }
}

/**
 * The chrome: the screens that are not the field, the editor's display regions,
 * and the two panels a run puts up. It shows no thing on the field, so it
 * carries none of the field's tags.
 */
export class ChromeActor extends Actor {
  constructor() {
    super();
    this.attach(new ScreenLayer());
    this.attach(new ChromeLayer());
    this.attach(new PanelLayer());
  }
}

// --- Keeping the population honest ----------------------------------------

/**
 * Make the actor population mirror the state: one tagged actor per placed part,
 * live mote, and filament, spawned for a record that appeared and destroyed for
 * one that is gone. Run from the game mode's tick, so the frame's picture and
 * every tag query describe the state the frame settled on.
 */
export function reconcileActors(world: World, state: OrreryState): void {
  const partIds = new Set(state.editor.parts.map((part) => part.id));
  for (const actor of world.ofType(PartActor)) {
    if (partIds.has(actor.partId)) partIds.delete(actor.partId);
    else actor.destroy();
  }
  for (const part of state.editor.parts) {
    if (!partIds.has(part.id)) continue;
    world.spawn(PartActor, {
      tags: [TAGS.part],
      configure: (actor) => actor.place(part),
    });
  }

  const moteIds = new Set((state.sim?.motes ?? []).map((mote) => mote.id));
  for (const actor of world.ofType(MoteActor)) {
    if (moteIds.has(actor.moteId)) moteIds.delete(actor.moteId);
    else actor.destroy();
  }
  for (const id of moteIds) {
    world.spawn(MoteActor, {
      tags: [TAGS.mote],
      configure: (actor) => {
        actor.moteId = id;
      },
    });
  }

  const filaments = new Set<SimFilament>(state.sim?.filaments ?? []);
  for (const actor of world.ofType(FilamentActor)) {
    if (filaments.has(actor.filament)) filaments.delete(actor.filament);
    else actor.destroy();
  }
  for (const filament of filaments) {
    world.spawn(FilamentActor, {
      tags: [TAGS.filament],
      configure: (actor) => {
        actor.filament = filament;
      },
    });
  }
}

/** One mote's record, for a caller that wants the actor's subject. */
export function moteOf(state: OrreryState, id: number): MoteState | null {
  return state.sim?.motes.find((mote) => mote.id === id) ?? null;
}
