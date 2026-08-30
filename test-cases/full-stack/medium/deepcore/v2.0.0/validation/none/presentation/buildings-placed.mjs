// Automated validation for presentation.buildings-placed.
//
// The six surface buildings sit ON the surface — above the ground, under the open sky — and never
// overlap (specs/world.md). We start an expedition, read every building's footprint through the
// debug buildings() API (specs/instrumentation.md), and confirm each rests at the surface ground
// line (not sunk underground) and that adjacent footprints leave clear ground between them.

import { newRun, TILE, MINER_H } from "../_helpers.mjs";

const EXPECTED = [
  "fuel-depot",
  "ore-market",
  "save-pad",
  "upgrade-shop",
  "supply-depot",
  "launch-pad",
];
// Half a tile of clear ground between adjacent buildings, and a base may sit at most half a tile
// below the ground line before it counts as sunk (specs/world.md).
const MIN_GAP = TILE / 2;
const SINK_TOL = TILE / 2;

export default function item() {
  let groundY;
  let boxes;

  return {
    id: "presentation.buildings-placed",

    // A fresh expedition puts the miner on the surface; its feet mark the surface ground line.
    async arrange(api) {
      const snap = await newRun(api);
      groundY = snap.miner.y + MINER_H; // the surface ground line (world y of the miner's feet)
      boxes = await api.call("buildings");
    },

    // Capture the camp for the reviewer — the point is the layout on the surface.
    async act(api) {
      await api.settle(150);
      await api.screenshot("camp");
    },

    async assert(api, check) {
      check.expectOk("buildings() returned an array", Array.isArray(boxes));
      const list = Array.isArray(boxes) ? boxes : [];
      const ids = new Set(list.map((b) => b && b.id));
      for (const id of EXPECTED) {
        check.expectOk(`the ${id} building is reported`, ids.has(id));
      }

      // Each building sits above ground: its base rests at the surface line (not sunk into the
      // mine), and its body rises above the ground into the open air.
      for (const b of list) {
        check.expectLe(
          `the ${b.id} is not sunk underground`,
          b.y + b.h,
          groundY + SINK_TOL,
        );
        check.expectLt(`the ${b.id} rises above the ground`, b.y, groundY);
      }

      // No two footprints overlap; adjacent buildings leave clear ground between them.
      const sorted = [...list].sort((a, b) => a.x - b.x);
      for (let i = 1; i < sorted.length; i += 1) {
        const prev = sorted[i - 1];
        const cur = sorted[i];
        const gap = cur.x - (prev.x + prev.w);
        check.expectGe(
          `clear ground between the ${prev.id} and the ${cur.id}`,
          gap,
          MIN_GAP,
        );
      }
    },
  };
}
