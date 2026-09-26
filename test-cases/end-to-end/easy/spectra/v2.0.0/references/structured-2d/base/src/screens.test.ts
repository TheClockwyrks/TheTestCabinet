// What each screen draws, and that every one of the seven draws at all.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FIELD_TOP,
  HUD_BOTTOM_TOP,
  HUD_TOP_H,
  RESONANCE_MAX,
  STAGE_W,
} from "./constants";
import {
  createHarness,
  lastDroneId,
  startPosed,
  type Harness,
} from "./harness";
import type { Screen } from "./game";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** How much light the row of pixels across `y` carries. */
function rowLight(harness: Harness, y: number): number {
  let total = 0;
  for (let x = 20; x < STAGE_W - 20; x += 7) {
    const [r, g, b] = harness.pixel(x, y);
    total += r + g + b;
  }
  return total;
}

describe("the seven screens", () => {
  it("draws each of them without throwing, and each draws something", async () => {
    const screens: Screen[] = [
      "title",
      "howto",
      "stageIntro",
      "inWave",
      "paused",
      "stageCleared",
      "gameOver",
    ];
    for (const screen of screens) {
      startPosed(h.debug);
      h.debug.setScreen(screen);
      await h.advance(1);
      expect(rowLight(h, 300)).toBeGreaterThan(0);
    }
  });

  it("draws the two HUD strips on a live wave and no readouts on the title", async () => {
    startPosed(h.debug);
    h.debug.setScore(123456);
    await h.advance(1);
    const live = rowLight(h, HUD_TOP_H / 2);
    expect(live).toBeGreaterThan(0);

    h.debug.setScreen("title");
    await h.advance(1);
    expect(rowLight(h, HUD_TOP_H / 2)).toBeLessThan(live);
  });

  it("fills more of the meter as the resonance rises", async () => {
    startPosed(h.debug);
    h.debug.setResonance(0);
    await h.advance(1);
    const empty = rowLight(h, HUD_BOTTOM_TOP + 32);

    h.debug.setResonance(RESONANCE_MAX);
    await h.advance(1);
    expect(rowLight(h, HUD_BOTTOM_TOP + 32)).toBeGreaterThan(empty);
  });

  it("carries a field-wide mark while an inversion is active, and none otherwise", async () => {
    startPosed(h.debug);
    await h.advance(1);
    const quiet = rowLight(h, FIELD_TOP + 40);

    h.debug.setInversion(3);
    await h.advance(1);
    expect(rowLight(h, FIELD_TOP + 40)).toBeGreaterThan(quiet);
  });

  it("draws the ready banner over the field, and takes it away again", async () => {
    startPosed(h.debug);
    await h.advance(1);
    const live = rowLight(h, 420);

    h.debug.setPhase("ready");
    h.debug.setPhaseTimer(5);
    await h.advance(1);
    expect(rowLight(h, 420)).toBeGreaterThan(live);
  });

  it("marks the mute indicator only while sound is muted", async () => {
    startPosed(h.debug);
    await h.advance(1);
    const unmuted = rowLight(h, HUD_BOTTOM_TOP + 52);

    await h.tap("KeyM");
    await h.advance(1);
    expect(rowLight(h, HUD_BOTTOM_TOP + 52)).toBeGreaterThan(unmuted);
  });

  it("draws the discharge wave while one is live", async () => {
    startPosed(h.debug);
    await h.advance(1);
    const quiet = rowLight(h, 400);

    h.debug.setResonance(RESONANCE_MAX);
    await h.tap("KeyX");
    // Far enough into the wave's half-second that its ring has climbed the
    // field and crosses the row being read.
    await h.advance(6);
    expect(h.debug.snapshot().discharge.active).toBe(true);
    expect(rowLight(h, 400)).toBeGreaterThan(quiet);
  });

  it("draws each drone kind, each band, and a Flux's two halves", async () => {
    startPosed(h.debug);
    for (const kind of ["shard", "flux", "prism"] as const) {
      for (const band of ["cyan", "magenta"] as const) {
        h.debug.clearDrones();
        h.debug.addDrone(kind, 640, 300);
        const id = lastDroneId(h.debug);
        h.debug.setDroneTravel(id, false);
        h.debug.setDroneBand(id, band);
        await h.advance(1);
        expect(rowLight(h, 300)).toBeGreaterThan(0);
      }
    }

    h.debug.clearDrones();
    h.debug.addDrone("flux", 640, 300);
    const flux = lastDroneId(h.debug);
    h.debug.setDroneTravel(flux, false);
    h.debug.setDroneOscillation(flux, false);
    h.debug.setDroneBandClock(flux, 0);
    await h.advance(1);
    const holding = rowLight(h, 300);

    h.debug.setDroneBandClock(flux, h.debug.snapshot().fluxHold);
    await h.advance(1);
    expect(h.debug.snapshot().drones[0]?.shimmer).toBe(true);
    expect(rowLight(h, 300)).not.toBe(holding);
  });

  it("draws a Prism's two layers apart", async () => {
    startPosed(h.debug);
    h.debug.addDrone("prism", 640, 300);
    const id = lastDroneId(h.debug);
    h.debug.setDroneTravel(id, false);
    await h.advance(1);
    const shelled = rowLight(h, 300);

    h.debug.setDroneShell(id, false);
    await h.advance(1);
    expect(rowLight(h, 300)).not.toBe(shelled);
  });

  it("draws both bullet kinds", async () => {
    startPosed(h.debug);
    await h.advance(1);
    const quiet = rowLight(h, 300);

    h.debug.addPlayerBullet(500, 300, "cyan");
    h.debug.addEnemyBullet(700, 300, "magenta");
    h.debug.setBulletVelocity(h.debug.snapshot().bullets[0]?.id ?? 0, 0, 0);
    h.debug.setBulletVelocity(h.debug.snapshot().bullets[1]?.id ?? 0, 0, 0);
    await h.advance(1);
    expect(rowLight(h, 300)).toBeGreaterThan(quiet);
  });

  it("reports a challenge stage on its intro", async () => {
    startPosed(h.debug);
    h.debug.setStage(3);
    h.debug.setScreen("stageIntro");
    await h.advance(1);
    expect(rowLight(h, 410)).toBeGreaterThan(0);

    h.debug.setScreen("stageCleared");
    await h.advance(1);
    expect(rowLight(h, 396)).toBeGreaterThan(0);

    h.debug.setScore(0);
    h.debug.setStage(3);
    h.debug.setScreen("stageCleared");
    await h.advance(1);
    expect(rowLight(h, 320)).toBeGreaterThan(0);
  });
});
