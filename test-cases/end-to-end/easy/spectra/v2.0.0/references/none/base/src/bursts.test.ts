import { beforeEach, describe, expect, it } from "vitest";

import { createCanvas } from "@napi-rs/canvas";

import {
  BURST_DURATION,
  BURST_FIELD,
  FLUX_SIZE,
  MAX_BURSTS,
  PRISM_CORE_SIZE,
  PRISM_SIZE,
  SHARD_SIZE,
} from "./constants";
import { drawBursts, startBurst, stepBursts } from "./bursts";
import { createDebugApi, type SpectraDebugApi } from "./debug";
import { createState } from "./game";
import { harnessWith, stubArt, type Harness } from "./harness.test-support";

let h: Harness;
let d: SpectraDebugApi;

beforeEach(() => {
  h = harnessWith(stubArt());
  d = createDebugApi(h.state, h.clock);
  d.reset();
  d.setScreen("inWave");
  d.setWaveEntry(false);
  d.setDiveLaunching(false);
});

/** One bystander, so destroying the subject does not clear the stage. */
function bystander(): void {
  const id = d.addDrone("shard", 120, 500);
  d.setDroneTravel(id, false);
}

/** Destroy a drone of `kind` with a matching shot, and settle the frame. */
function pop(kind: "shard" | "flux" | "prism"): void {
  const id = d.addDrone(kind, 640, 300);
  d.setDroneTravel(id, false);
  d.addPlayerBullet(640, 300, "cyan");
  h.advance(1 / 120, 1);
}

describe("the drone-burst", () => {
  it("starts one burst in the moment a drone is destroyed", () => {
    bystander();
    expect(d.snapshot().bursts.length).toBe(0);
    pop("shard");
    expect(d.snapshot().bursts.length).toBe(1);
    const burst = d.snapshot().bursts[0];
    expect(burst?.x).toBeCloseTo(640, 0);
    expect(burst?.y).toBeCloseTo(300, 0);
  });

  it("plays the seeded system, so a live particle count is there to read", () => {
    bystander();
    pop("shard");
    // Every zero-time burst of the seeded one-shot has already fired.
    expect(d.snapshot().bursts[0]?.particles).toBeGreaterThan(100);
    h.advance(0.1, 12);
    expect(d.snapshot().bursts[0]?.particles).toBeGreaterThan(0);
  });

  it("scales the system's field to the popped drone's own footprint", () => {
    for (const [kind, size] of [
      ["shard", SHARD_SIZE],
      ["flux", FLUX_SIZE],
      ["prism", PRISM_SIZE],
    ] as const) {
      d.reset();
      d.setScreen("inWave");
      d.setWaveEntry(false);
      d.setDiveLaunching(false);
      bystander();
      if (kind === "flux") {
        const id = d.addDrone("flux", 640, 300);
        d.setDroneTravel(id, false);
        d.setDroneOscillation(id, false);
        d.addPlayerBullet(640, 300, "cyan");
        h.advance(1 / 120, 1);
      } else {
        pop(kind);
      }
      expect(d.snapshot().bursts[0]?.size).toBe(size);
    }
  });

  it("pops a Prism twice: once for its shell, once for its core", () => {
    bystander();
    const id = d.addDrone("prism", 640, 300);
    d.setDroneTravel(id, false);
    d.addPlayerBullet(640, 300, "cyan");
    h.advance(1 / 120, 1);
    expect(d.snapshot().bursts.length).toBe(1);
    expect(d.snapshot().bursts[0]?.size).toBe(PRISM_SIZE);
    d.clearBursts();
    d.addPlayerBullet(640, 300, "magenta");
    h.advance(1 / 120, 1);
    expect(d.snapshot().bursts.length).toBe(1);
    expect(d.snapshot().bursts[0]?.size).toBe(PRISM_CORE_SIZE);
  });

  it("plays for BURST_DURATION and is then gone", () => {
    bystander();
    pop("shard");
    h.advance(BURST_DURATION * 0.8, 48);
    expect(d.snapshot().bursts.length).toBe(1);
    h.advance(BURST_DURATION * 0.3, 24);
    expect(d.snapshot().bursts.length).toBe(0);
  });

  it("scatters differently from one burst to the next", () => {
    const state = createState(stubArt());
    const first = startBurst(state, 100, 100, SHARD_SIZE);
    const second = startBurst(state, 100, 100, SHARD_SIZE);
    stepBursts(state, 0.05);
    const positions = (burst: typeof first): string =>
      JSON.stringify(
        burst.sim.capture().map((particle) => particle.position[0].toFixed(4)),
      );
    expect(positions(first)).not.toBe(positions(second));
  });

  it("plays at most MAX_BURSTS at once", () => {
    const state = createState(stubArt());
    for (let i = 0; i < MAX_BURSTS + 12; i += 1) {
      startBurst(state, i * 10, 200, SHARD_SIZE);
    }
    expect(state.bursts.length).toBe(MAX_BURSTS);
    // The newest survive, so a discharge's own pops are the ones that show.
    expect(state.bursts[state.bursts.length - 1]?.x).toBe(
      (MAX_BURSTS + 11) * 10,
    );
  });

  it("is composited over the field as light", () => {
    const state = createState(stubArt());
    startBurst(state, 300, 300, PRISM_SIZE);
    stepBursts(state, 1 / 120);
    const canvas = createCanvas(600, 600);
    const raw = canvas.getContext("2d");
    raw.fillStyle = "#000000";
    raw.fillRect(0, 0, 600, 600);
    drawBursts(raw as unknown as CanvasRenderingContext2D, state);
    const middle = raw.getImageData(300, 300, 1, 1).data;
    expect(middle[0] + middle[1] + middle[2]).toBeGreaterThan(60);
    // And it stays within a few footprints of where it was started.
    const far = raw.getImageData(20, 20, 1, 1).data;
    expect(far[0] + far[1] + far[2]).toBe(0);
  });

  it("draws nothing when nothing is playing, and leaves the mode alone", () => {
    const state = createState(stubArt());
    const canvas = createCanvas(100, 100);
    const raw = canvas.getContext("2d");
    raw.globalCompositeOperation = "source-over";
    drawBursts(raw as unknown as CanvasRenderingContext2D, state);
    expect(raw.globalCompositeOperation).toBe("source-over");
    startBurst(state, 50, 50, SHARD_SIZE);
    drawBursts(raw as unknown as CanvasRenderingContext2D, state);
    expect(raw.globalCompositeOperation).toBe("source-over");
  });

  it("plays the seeded system's own field size", () => {
    const state = createState(stubArt());
    expect(state.art.burst.field.width).toBe(BURST_FIELD);
    expect(state.art.burst.field.height).toBe(BURST_FIELD);
    expect(state.art.burst.durationMs / 1000).toBeCloseTo(BURST_DURATION, 6);
    expect(state.art.burst.loop).toBe(false);
  });
});
