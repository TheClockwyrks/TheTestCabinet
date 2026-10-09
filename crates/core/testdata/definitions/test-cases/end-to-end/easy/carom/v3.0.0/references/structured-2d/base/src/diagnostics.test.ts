// The diagnostic sources specs/instrumentation.md asks the game to register on
// the engine's overlay: each is a pure read of the LIVE world at the moment it
// runs, so a source registered before the title level even opened keeps
// answering correctly for a match that opens later. The overlay's own drawing
// and key belong to the engine; what is checked here is the values Carom
// names, read the way the overlay reads them.

import { createCanvas } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type DiagnosticValue,
  type Engine,
  type SurfaceMetrics,
} from "@clockwyrks/structured-2d";
import { afterEach, beforeEach, expect, it } from "vitest";
import { FIELD_CX, FIELD_CY, FIELD_H, FIELD_W, LAYOUT } from "./constants";
import type { CaromDebug } from "./debug";
import { diagnosticSources } from "./diagnostics";
import { BACKGROUND, CaromGame, game } from "./game";

let engine: Engine<CaromDebug>;
let sources: Record<string, () => DiagnosticValue>;

beforeEach(async () => {
  const canvas = createCanvas(FIELD_W, FIELD_H);
  const ctx = canvas.getContext("2d");
  const element = Object.assign(canvas, {
    style: {} as CSSStyleDeclaration,
    getContext: () => ctx,
  }) as unknown as HTMLCanvasElement;
  const surface: SurfaceMetrics = {
    cssWidth: () => FIELD_W,
    cssHeight: () => FIELD_H,
    dpr: () => 1,
    events: () => new EventTarget(),
  };
  engine = createEngine({
    canvas: element,
    width: FIELD_W,
    height: FIELD_H,
    game,
    background: BACKGROUND,
    layout: LAYOUT,
    clock: new ConstantClock(1000 / 60),
    surface,
  });
  const instance = await engine.initialize();
  // The same map `initialize` registered, read the way the overlay reads it.
  sources = diagnosticSources(instance as CaromGame);
});

afterEach(() => {
  engine.destroy();
});

it("reports the title screen from a fresh boot", () => {
  expect(sources["screen"]()).toBe("title");
  expect(sources["mode"]()).toBe("solo");
  expect(sources["score"]()).toBe("0 - 0");
  expect(sources["ball pos"]()).toBe(`${FIELD_CX}.0, ${FIELD_CY}.0`);
  expect(sources["ball spin"]()).toBe("0.0");
  expect(sources["paddle L"]()).toBe(`cy ${FIELD_CY}.0 vy 0.0`);
  expect(sources["paddle R"]()).toBe(`cy ${FIELD_CY}.0 vy 0.0`);
});

it("follows the live world as the game is posed into a match", async () => {
  engine.debug.setMode("versus");
  engine.debug.setScreen("countdown");
  engine.debug.setScore(3, 4);
  engine.debug.setBallPosition(500, 300);
  engine.debug.setBallVelocity(300, 400);
  await engine.advance(1);

  expect(sources["screen"]()).toBe("countdown");
  expect(sources["mode"]()).toBe("versus");
  expect(sources["score"]()).toBe("3 - 4");
  expect(sources["ball pos"]()).toBe("500.0, 300.0");
  expect(sources["ball vel"]()).toBe("300.0, 400.0 (500.0)");
});

it("answers with a dash for a ball that is not on the field", () => {
  engine.debug.clearWorld();
  expect(sources["ball pos"]()).toBe("\u2014");
  expect(sources["ball vel"]()).toBe("\u2014");
  expect(sources["ball spin"]()).toBe("\u2014");
  // The paddles are never removed, so their lines still read.
  expect(sources["paddle L"]()).toBe(`cy ${FIELD_CY}.0 vy 0.0`);
});

it("reads and formats without disturbing the simulation", async () => {
  engine.debug.setScreen("countdown");
  engine.debug.setBallHoldTimer(0);
  await engine.advance(10);

  const before = engine.debug.snapshot();
  for (const source of Object.values(sources)) {
    expect(() => source()).not.toThrow();
  }
  expect(engine.debug.snapshot()).toEqual(before);
});
