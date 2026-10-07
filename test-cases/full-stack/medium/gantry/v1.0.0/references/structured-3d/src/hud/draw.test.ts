import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { DrawComponent } from "@clockwyrks/structured-3d";
import type { Actor, DrawApi, World } from "@clockwyrks/structured-3d";
import { STAGE_H, STAGE_W } from "../constants";
import { GantryState } from "../game";
import { addMoveStep, setScreen } from "../state";
import { HowToActor } from "./howto";
import { ProgramActor } from "./program";
import { RunActor } from "./run";
import { SelectActor } from "./select";

/** A context the drawn screens can actually paint through. */
function api(): DrawApi & { pixels: () => Uint8ClampedArray } {
  const canvas = createCanvas(STAGE_W, STAGE_H);
  const ctx = canvas.getContext("2d");
  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    mode: "shaded",
    frame: () => ({ count: 1, timeMs: 0, lastDeltaMs: 1000 / 60 }),
    viewport: () => ({
      width: STAGE_W,
      height: STAGE_H,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    }),
    camera: () => ({
      projection: "perspective",
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      fov: 45,
      near: 0.1,
      far: 1000,
      zoom: 1,
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
    }),
    pixels: () => ctx.getImageData(0, 0, STAGE_W, STAGE_H).data,
  };
}

/** Stand an actor up outside a world, which is all a `draw` needs. */
function standing<A extends Actor>(type: new () => A, state: GantryState): A {
  const actor = new type();
  (actor as { world: World }).world = { state } as unknown as World;
  return actor;
}

/** Draw every `DrawComponent` an actor carries, and read back what landed. */
function paint(actor: Actor): { lit: number; ink: string } {
  const surface = api();
  for (const component of actor.components) {
    if (component instanceof DrawComponent) component.draw(surface);
  }
  const pixels = surface.pixels();
  let lit = 0;
  let ink = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) continue;
    lit += 1;
    ink = (ink * 31 + pixels[i] + pixels[i + 1] * 3 + pixels[i + 2] * 7) >>> 0;
  }
  return { lit, ink: String(ink) };
}

/** How many pixels one actor's drawn components put on the screen layer. */
const drawn = (actor: Actor): number => paint(actor).lit;

describe("the drawn screens", () => {
  it("draws the how-to page on its own screen and nowhere else", () => {
    const state = new GantryState();
    const actor = standing(HowToActor, state);
    expect(drawn(actor)).toBe(0);
    setScreen(state, "howto");
    expect(drawn(actor)).toBeGreaterThan(1000);
  });

  it("draws all three site marks on the select screen", () => {
    const state = new GantryState();
    const actor = standing(SelectActor, state);
    expect(drawn(actor)).toBe(0);
    setScreen(state, "select");
    // A cleared site, an open one, and four locked: a tick, an arrow, and a
    // cross, so every mark the list can carry is drawn.
    const locked = paint(actor);
    state.cleared[0] = true;
    const cleared = paint(actor);
    expect(cleared.lit).toBeGreaterThan(100);
    expect(cleared.ink).not.toBe(locked.ink);
  });

  it("draws the tape panel over the yard on the program screen", () => {
    const state = new GantryState();
    const actor = standing(ProgramActor, state);
    expect(drawn(actor)).toBe(0);
    setScreen(state, "program");
    const empty = paint(actor);
    expect(empty.lit).toBeGreaterThan(1000);
    addMoveStep(state, "slew", 90, 30);
    addMoveStep(state, "hoist", 6, 4);
    // The panel covers the same rectangle either way; what changes is what is
    // printed on it, so the picture is compared rather than its area.
    expect(paint(actor).ink).not.toBe(empty.ink);
  });

  it("draws the utilization legend on the run screen", () => {
    const state = new GantryState();
    const actor = standing(RunActor, state);
    expect(drawn(actor)).toBe(0);
    setScreen(state, "run");
    expect(drawn(actor)).toBeGreaterThan(1000);
  });
});
