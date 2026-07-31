// Automated validation for pathing.three-maps: the three maps define different ordered
// waypoint chains at pinned coordinates (chosen, not randomly generated).
//
// Each map is started and its reported waypoint chain read; the three signatures must be
// distinct, and re-starting a map twice must reproduce the same chain (pinned, not random).
//
// WHAT THE STILLS SHOW. The old script read all three chains in `arrange` and then captured a
// single frame of whichever map happened to be open last — one board, offered as evidence that
// three boards differ. A reviewer could not check the claim from it at all. The item now captures
// one still PER MAP, so the three topologies sit side by side against their baselines and the
// comparison the item is about is the thing on screen.
//
// That moves the map walk into `act`: a capture only produces media there, so each map has to be
// opened, painted, and shot in the filmed phase. `api.reset` is legal in `act` — the runtime hands
// the build's clock straight back afterwards precisely so an item that needs to revisit a fresh
// state is not forced to contort itself (see `reset` in `packages/browser-driver/validation.mjs`).
// The chains are still read in `arrange`, so the verdict is decided before any capture and does
// not depend on the walk.

import { startBuild } from "../_helpers.mjs";

// The maps in catalog order, each with the output its still is captured into.
const MAPS = [
  { id: "substation", output: "map-substation" },
  { id: "switchyard", output: "map-switchyard" },
  { id: "transformer", output: "map-transformer" },
];
// A real pause so the build's own frame loop paints the freshly opened board before it is shot.
// Instant stepping paints nothing, and opening a board is drawn, not simulated.
const PAINT_MS = 300;

function sig(waypoints) {
  return JSON.stringify(waypoints.map((w) => [w.col, w.row]));
}

export default function item() {
  // A signature per map, and the re-read of the first map, both checked by `assert`.
  const sigs = [];
  let again;

  return {
    id: "pathing.three-maps",

    async arrange(api) {
      for (const m of MAPS) {
        const s = await startBuild(api, { map: m.id });
        sigs.push(sig(s.waypoints));
      }

      // Pinned, not random: re-starting a map reproduces the same chain.
      again = sig((await startBuild(api, { map: MAPS[0].id })).waypoints);
    },

    async act(api) {
      // Walk the three maps again, this time on camera: open each, let it paint, and shoot it.
      for (const m of MAPS) {
        await startBuild(api, { map: m.id });
        await api.settle(PAINT_MS);
        await api.screenshot(m.output);
      }
    },

    async assert(api, check) {
      check.expectEq("the three maps report three distinct waypoint chains", new Set(sigs).size, 3);
      check.expectEq("a map's waypoint chain is fixed (chosen, not random)", again, sigs[0]);
    },
  };
}
