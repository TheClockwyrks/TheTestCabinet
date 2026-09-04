// The kit: one case, one call, and everything the package does bound to it.
//
// What is checked here is the BINDING, because a mis-binding is the failure mode
// nothing else can see. A kit whose tick arithmetic came from somewhere other
// than its config would still compile, still run, and quietly re-scale every
// tick-denominated tolerance in the suite that used it.

import { expect, it } from "vitest";
import {
  AUDIO_GLOBAL,
  DEFAULT_REPLAY_BACKGROUND,
  DEFAULT_SPEC_PATH,
  RECORDER_GLOBAL,
} from "../src/index";
import {
  STAGE,
  SURFACE_REQUIREMENT,
  TICK_HZ,
  failSurface,
  kit,
} from "./fixture";

it("fills in every default the case left out", () => {
  const { config } = kit;

  expect(config.slug).toBe("case-harness");
  expect(config.handle).toBe("__fixture");
  expect(config.stage).toEqual(STAGE);
  expect(config.step).toEqual({ kind: "count", op: "advance" });
  // The harness's own instrumentation is the package's, not the case's.
  expect(config.recorderGlobal).toBe(RECORDER_GLOBAL);
  expect(config.audioGlobal).toBe(AUDIO_GLOBAL);
  expect(config.replayBackground).toBe(DEFAULT_REPLAY_BACKGROUND);
  expect(config.specPath).toBe(DEFAULT_SPEC_PATH);
  expect(config.extraInitScripts).toEqual([]);
  expect(config.defaultSeed).toBeNull();
});

it("takes its tick arithmetic from the case's own rate", () => {
  // The mismatch the package refuses to make representable: it exports no bare
  // `TICK_HZ`, so a case cannot end up with a `seconds()` that counts at one rate
  // and an `advance()` that runs at another.
  expect(kit.TICK_HZ).toBe(TICK_HZ);
  expect(kit.TICK_MS).toBeCloseTo(1000 / TICK_HZ, 12);
  expect(kit.TICK_DT).toBeCloseTo(1 / TICK_HZ, 12);
  expect(kit.seconds(TICK_HZ)).toBe(1);
  expect(kit.ticksFor(0.5)).toBe(TICK_HZ / 2);
  expect(kit.ticks(0.5)).toBe(TICK_HZ / 2);
  // A speed drops its sign so one bound covers both directions; a gain keeps it,
  // because a reading whose subject is that something moved FORWARD must fail
  // when it moved backwards.
  expect(kit.speedOverTicks(-120, TICK_HZ)).toBe(120);
  expect(kit.gainOverTicks(-120, TICK_HZ)).toBe(-120);
});

it("pairs a surface fault with what the specification requires", () => {
  expect(SURFACE_REQUIREMENT).toContain("window.__fixture");
  expect(SURFACE_REQUIREMENT).toContain(DEFAULT_SPEC_PATH);

  // The fault is what was FOUND; the requirement is what the specification asks.
  // A check reaching a build with no surface lands on both.
  expect(() => failSurface("no such global")).toThrow(/no such global/);
  expect(() => failSurface("no such global")).toThrow(/window\.__fixture/);
});
