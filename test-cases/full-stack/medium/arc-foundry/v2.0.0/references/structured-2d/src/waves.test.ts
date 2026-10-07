// A wave's composition against the rules `specs/enemies.md` fixes for it.

import { describe, expect, it } from "vitest";

import { DIFFICULTIES } from "./constants";
import { LOAD_BY_TYPE, milestoneWaves, scaledHealth } from "./tables";
import { buildWave } from "./waves";
import type { Wave } from "./types";

describe("wave composition", () => {
  for (const diff of DIFFICULTIES) {
    describe(diff.id, () => {
      const waves = Array.from({ length: diff.waves }, (_, i) =>
        buildWave(i + 1, diff),
      );
      const milestones = milestoneWaves(diff);

      it("carries Filaments on every fourth wave and on no other", () => {
        waves.forEach((w, i) => {
          expect(w.events.some((e) => e.type === "filament")).toBe(
            (i + 1) % 4 === 0,
          );
        });
      });

      it("carries exactly one Dynamo on each milestone wave and none elsewhere", () => {
        waves.forEach((w, i) => {
          const bosses = w.events.filter((e) => e.type === "dynamo").length;
          expect(bosses).toBe(milestones.includes(i + 1) ? 1 : 0);
        });
      });

      it("opens on Motes and Sparks alone", () => {
        for (const w of waves.slice(0, 3)) {
          for (const e of w.events) expect(["mote", "spark"]).toContain(e.type);
        }
      });

      it("holds Clusters and Slugs back until wave five", () => {
        for (const w of waves.slice(0, 4)) {
          for (const e of w.events)
            expect(["cluster", "slug"]).not.toContain(e.type);
        }
      });

      it("never shrinks a wave's health pool", () => {
        const pool = (w: Wave, n: number): number =>
          w.events.reduce(
            (total, e) =>
              total + scaledHealth(LOAD_BY_TYPE[e.type].baseHealth, n, diff),
            0,
          );
        let last = 0;
        waves.forEach((w, i) => {
          const now = pool(w, i + 1);
          expect(now).toBeGreaterThanOrEqual(last);
          last = now;
        });
      });

      it("releases every unit over the wave's own span, in order", () => {
        for (const w of waves) {
          expect(w.events.length).toBeGreaterThan(0);
          for (let i = 1; i < w.events.length; i++) {
            expect(w.events[i]!.atMs).toBeGreaterThanOrEqual(
              w.events[i - 1]!.atMs,
            );
          }
          expect(w.events[0]!.atMs).toBeGreaterThanOrEqual(0);
        }
      });
    });
  }
});
