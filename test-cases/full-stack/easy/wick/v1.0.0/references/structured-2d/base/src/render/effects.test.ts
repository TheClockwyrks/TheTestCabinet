import { describe, expect, it } from "vitest";
import { WickAssets, effectPath } from "../assets";
import {
  FLARE_FLASH,
  OIL_PULSE,
  PUFF_TIME,
  SPARK_FLASH,
  WALK_FRAME_TIME,
} from "../constants";
import { freshRun, type ZoneState } from "../state";
import {
  effectImage,
  flareFrame,
  puffFrame,
  pulseGlow,
  sconceFrame,
  sparkFrame,
  walkFrame,
} from "./effects";

function image(): ImageBitmap {
  return {} as ImageBitmap;
}

describe("effect frames", () => {
  it("plays the strike's four frames once over SPARK_FLASH", () => {
    const quarter = SPARK_FLASH / 4;
    expect(sparkFrame(0)).toBe(0);
    expect(sparkFrame(quarter - 1e-9)).toBe(0);
    expect(sparkFrame(quarter)).toBe(1);
    expect(sparkFrame(3 * quarter)).toBe(3);
    expect(sparkFrame(SPARK_FLASH + 1)).toBe(3);
  });

  it("plays the burst's six frames once over FLARE_FLASH", () => {
    const sixth = FLARE_FLASH / 6;
    expect(flareFrame(0)).toBe(0);
    expect(flareFrame(sixth * 2.5)).toBe(2);
    expect(flareFrame(sixth * 5)).toBe(5);
    expect(flareFrame(10)).toBe(5);
  });

  it("spins a sconce one frame per WALK_FRAME_TIME and wraps", () => {
    expect(sconceFrame(0)).toBe(0);
    expect(sconceFrame(WALK_FRAME_TIME * 3)).toBe(3);
    expect(sconceFrame(WALK_FRAME_TIME * 4)).toBe(0);
    expect(sconceFrame(WALK_FRAME_TIME * 9)).toBe(1);
  });

  it("spreads the puff's four frames over PUFF_TIME", () => {
    expect(puffFrame(0)).toBe(0);
    expect(puffFrame(PUFF_TIME / 2)).toBe(2);
    expect(puffFrame(PUFF_TIME - 1e-9)).toBe(3);
  });

  it("advances a walk cycle one frame per WALK_FRAME_TIME of walking", () => {
    expect(walkFrame(0, 6)).toBe(0);
    expect(walkFrame(WALK_FRAME_TIME * 5, 6)).toBe(5);
    expect(walkFrame(WALK_FRAME_TIME * 6, 6)).toBe(0);
    expect(walkFrame(WALK_FRAME_TIME * 4, 4)).toBe(0);
  });

  it("picks a sheet frame for spark, sconce, and flare and one sprite otherwise", () => {
    const assets = new WickAssets();
    const spark1 = image();
    const ember = image();
    assets.set(effectPath("spark", 1), spark1);
    assets.set(effectPath("ember", 0), ember);
    expect(effectPath("spark", 1)).toBe("sprites/effects/spark/1.png");
    expect(effectPath("ember", 0)).toBe("sprites/effects/ember.png");
    expect(effectImage(assets, "spark", SPARK_FLASH / 4)).toBe(spark1);
    expect(effectImage(assets, "spark", 0)).toBeNull();
    expect(effectImage(assets, "ember", 3)).toBe(ember);
    expect(effectImage(assets, "flare", 0)).toBeNull();
  });
});

describe("pulse glow", () => {
  const zone = (partial: Partial<ZoneState>): ZoneState => ({
    id: 1,
    weapon: "halo",
    kind: "aura",
    x: 0,
    y: 0,
    radius: 80,
    damage: 3,
    ttl: null,
    hits: [],
    bornTick: 0,
    ...partial,
  });

  it("is full on the tick an aura pulses and fades with its cooldown", () => {
    const run = freshRun();
    run.weapons.push({ id: "halo", level: 1, cooldown: 1, cooldownSet: 1 });
    const aura = zone({});
    expect(pulseGlow(run, aura)).toBe(1);
    run.weapons[1].cooldown = 0.25;
    expect(pulseGlow(run, aura)).toBeCloseTo(0.25);
    run.weapons[1].cooldown = 0;
    expect(pulseGlow(run, aura)).toBe(0);
  });

  it("is zero for an aura whose weapon is not held", () => {
    expect(pulseGlow(freshRun(), zone({}))).toBe(0);
  });

  it("follows a puddle's own pulse timer", () => {
    const run = freshRun();
    const puddle = zone({
      weapon: "oil-splash",
      kind: "puddle",
      pulse: OIL_PULSE,
    });
    expect(pulseGlow(run, puddle)).toBe(1);
    puddle.pulse = OIL_PULSE / 3;
    expect(pulseGlow(run, puddle)).toBeCloseTo(1 / 3);
  });

  it("is zero for a shape that never pulses", () => {
    expect(
      pulseGlow(freshRun(), zone({ weapon: "taper", kind: "slash" })),
    ).toBe(0);
  });
});
