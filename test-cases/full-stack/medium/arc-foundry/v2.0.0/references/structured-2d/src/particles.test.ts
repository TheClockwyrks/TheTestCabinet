// The produced particle systems, simulated and composited.
//
// The bursts are the case's headline effect, so what is checked here is the real
// produced `system.json` played through the runtime's simulator and drawn by this build,
// rather than the empty stand-in a run with no page behind the asset loader falls back
// to. The files are read straight off `assets/`, which is where `specs/assets.md` fixes
// them and where the built site serves them from.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import type { ParticleSystem } from "@clockwyrks/particle-runtime";

import { noAssets, type Assets } from "./assets";
import { EFFECTS, STAGE_H, STAGE_W, type EffectName } from "./constants";
import { drawBursts, spawnBurst, stepBursts } from "./particles";

/** A produced system, read from the path `specs/assets.md` fixes for it. */
function produced(effect: EffectName): ParticleSystem {
  const url = new URL(`../assets/fx/${effect}.json`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as ParticleSystem;
}

/** An asset set that carries the produced systems and nothing else. */
function withEffects(): Assets {
  const systems = new Map<string, ParticleSystem>(
    EFFECTS.map((effect) => [effect, produced(effect)]),
  );
  return { ...noAssets(), effect: (kind) => systems.get(kind) ?? null };
}

describe("the produced systems", () => {
  it("carries all twelve, each with a field and at least one emitter", () => {
    for (const effect of EFFECTS) {
      const system = produced(effect);
      expect(system.field.width).toBeGreaterThan(0);
      expect(system.field.height).toBeGreaterThan(0);
      expect(system.emitters.length).toBeGreaterThan(0);
      expect(system.durationMs).toBeGreaterThan(0);
    }
  });
});

describe("a burst", () => {
  const assets = withEffects();

  it("plays every effect, and raises particles as it runs", () => {
    for (const effect of EFFECTS) {
      const burst = spawnBurst(assets, { kind: effect, x: 300, y: 300 })!;
      expect(burst).not.toBeNull();
      expect(burst.duration).toBeGreaterThan(0);
      let live = burst.play.liveCount();
      for (let i = 0; i < 10 && live === 0; i++) {
        burst.play.step(1 / 60);
        live = burst.play.liveCount();
      }
      expect(live).toBeGreaterThan(0);
    }
  });

  it("centers a segment effect on the midpoint of its two ends", () => {
    const burst = spawnBurst(assets, {
      kind: "chain",
      x: 100,
      y: 100,
      x2: 300,
      y2: 200,
    })!;
    expect(burst.x).toBe(200);
    expect(burst.y).toBe(150);
  });

  it("scales a firing burst with the quality that threw it", () => {
    const scrap = spawnBurst(assets, { kind: "bolt", x: 0, y: 0, quality: 1 })!;
    const prime = spawnBurst(assets, { kind: "bolt", x: 0, y: 0, quality: 5 })!;
    expect(prime.size).toBeGreaterThan(scrap.size);
    const big = spawnBurst(assets, { kind: "death", x: 0, y: 0, big: true })!;
    const plain = spawnBurst(assets, { kind: "death", x: 0, y: 0 })!;
    expect(big.size).toBeGreaterThan(plain.size);
  });

  it("raises nothing for an effect whose system did not arrive", () => {
    expect(spawnBurst(noAssets(), { kind: "impact", x: 0, y: 0 })).toBeNull();
  });

  it("is dropped once its span is past and its last particle is gone", () => {
    const burst = spawnBurst(assets, { kind: "impact", x: 300, y: 300 })!;
    let live = [burst];
    for (let i = 0; i < 600 && live.length > 0; i++)
      live = stepBursts(live, 1 / 60);
    expect(live).toHaveLength(0);
  });

  it("composites onto the stage where it was raised", () => {
    const canvas = createCanvas(STAGE_W, STAGE_H);
    const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
    let bursts = [
      spawnBurst(assets, { kind: "death", x: 400, y: 300, big: true })!,
    ];
    // A few frames in, the burst has spread from its emitter.
    for (let i = 0; i < 12; i++) bursts = stepBursts(bursts, 1 / 60);
    ctx.clearRect(0, 0, STAGE_W, STAGE_H);
    drawBursts(ctx, bursts);
    const { data } = ctx.getImageData(300, 200, 200, 200);
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i + 3]! > 0) lit++;
    expect(lit).toBeGreaterThan(0);
  });

  it("leaves the context's compositing as it found it", () => {
    const canvas = createCanvas(STAGE_W, STAGE_H);
    const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
    ctx.globalCompositeOperation = "source-over";
    drawBursts(ctx, [spawnBurst(assets, { kind: "impact", x: 100, y: 100 })!]);
    expect(ctx.globalCompositeOperation).toBe("source-over");
  });
});
