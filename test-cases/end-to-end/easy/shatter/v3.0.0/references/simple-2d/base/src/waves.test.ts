// The wave loop: the count, the speed ladder, and the clearances a spawn keeps.

import { describe, expect, it } from "vitest";
import {
  ROCK_SPEED_MAX,
  ROCK_SPEED_MIN,
  STAR_X,
  STAR_Y,
  WAVE_MIN_SHIP_DIST,
  WAVE_MIN_STAR_DIST,
  WAVE_SPEED_CAP,
} from "./constants";
import { distance } from "./field";
import { openingState } from "./flow";
import { toSim } from "./sim";
import { spawnWave, waveRockCount, waveSpeedScale } from "./waves";

describe("a wave", () => {
  it("puts up three plus its own number of Large rocks", () => {
    expect(waveRockCount(1)).toBe(4);
    expect(waveRockCount(2)).toBe(5);
    expect(waveRockCount(9)).toBe(12);
  });

  it("scales the drift by four per cent a wave, capped at forty", () => {
    expect(waveSpeedScale(1)).toBeCloseTo(1, 9);
    expect(waveSpeedScale(6)).toBeCloseTo(1.2, 9);
    expect(waveSpeedScale(11)).toBeCloseTo(1 + WAVE_SPEED_CAP, 9);
    expect(waveSpeedScale(40)).toBeCloseTo(1 + WAVE_SPEED_CAP, 9);
  });

  it("spawns clear of the ship and the star, at the wave's own speed", () => {
    for (const wave of [1, 3, 12]) {
      const sim = toSim(openingState());
      spawnWave(sim, wave);

      expect(sim.rocks).toHaveLength(waveRockCount(wave));
      const scale = waveSpeedScale(wave);
      for (const rock of sim.rocks) {
        expect(rock.size).toBe("large");
        expect(
          distance(rock.x, rock.y, sim.ship.x, sim.ship.y),
        ).toBeGreaterThanOrEqual(WAVE_MIN_SHIP_DIST);
        expect(distance(rock.x, rock.y, STAR_X, STAR_Y)).toBeGreaterThanOrEqual(
          WAVE_MIN_STAR_DIST,
        );

        const speed = Math.hypot(rock.vx, rock.vy);
        expect(speed).toBeGreaterThanOrEqual(
          ROCK_SPEED_MIN.large * scale - 1e-9,
        );
        expect(speed).toBeLessThanOrEqual(ROCK_SPEED_MAX.large * scale + 1e-9);
      }
    }
  });
});
