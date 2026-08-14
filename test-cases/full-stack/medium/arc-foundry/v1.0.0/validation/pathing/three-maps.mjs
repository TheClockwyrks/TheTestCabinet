// Automated validation for pathing.three-maps: the three maps define different ordered
// waypoint chains at pinned coordinates (chosen, not randomly generated).
//
// Each map is started and its reported checkpoints read: the chain must match the coordinates
// `specs/board.md` pins for that map, the three chains must be distinct, and re-starting a map
// must reproduce the same chain.
//
// WHY THE COORDINATES ARE READ AGAINST THE SPEC AND NOT ONLY AGAINST EACH OTHER. This used to
// assert only that the three signatures DIFFER and that one of them is stable across a restart.
// Both hold for a build that invented three chains of its own and hard-coded them: they are
// distinct, and they are certainly not random. The claim the item is named for is that the maps
// are the ones the spec lays out — three specific topologies, chosen to play differently
// (`specs/board.md` gives each map's table and says what the shape is for) — so the anchors are
// compared to those tables, and the Entry and Collector with them, since a chain pinned between
// the wrong endpoints is a different map.
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

import { MAPS as PINNED, startBuild } from "../_helpers.mjs";

// The maps in catalog order, each with the output its still is captured into.
const MAPS = [
  { id: "substation", name: "The Substation", output: "map-substation" },
  { id: "switchyard", name: "The Switchyard", output: "map-switchyard" },
  { id: "transformer", name: "The Transformer Yard", output: "map-transformer" },
];
// A real pause so the build's own frame loop paints the freshly opened board before it is shot.
// Instant stepping paints nothing, and opening a board is drawn, not simulated.
const PAINT_MS = 300;

function sig(waypoints) {
  return JSON.stringify(waypoints.map((w) => [w.col, w.row]));
}

// A checkpoint as `(col,row)`, for an assertion that names the tile it wanted.
function tile(p) {
  return p ? `(${p.col},${p.row})` : "missing";
}

export default function item() {
  // A signature per map, the checkpoints each reported, and the re-read of the first map.
  const sigs = [];
  const opened = [];
  let again;

  return {
    id: "pathing.three-maps",

    async arrange(api) {
      for (const m of MAPS) {
        const s = await startBuild(api, { map: m.id });
        sigs.push(sig(s.waypoints));
        opened.push(s);
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
      // Each map's checkpoints, against the tiles `specs/board.md` pins for it.
      MAPS.forEach((m, i) => {
        const s = opened[i];
        const want = PINNED[m.id];
        check.expectEq(`${m.name} runs the spec's six waypoints`, s.waypoints.length, want.waypoints.length);
        check.expectEq(`${m.name} enters at the spec's tile`, tile(s.entry), tile(want.entry));
        want.waypoints.forEach((w, k) => {
          check.expectEq(`${m.name} WP${k + 1} is at the spec's tile`, tile(s.waypoints[k]), tile(w));
        });
        check.expectEq(`${m.name} grounds out at the spec's Collector`, tile(s.collector), tile(want.collector));
        // The chain is numbered from 1 in the order it is reported (`specs/instrumentation.md`),
        // so the anchors above are being compared in the order a unit walks them.
        check.expectEq(
          `${m.name} numbers its chain 1..${want.waypoints.length} in walking order`,
          s.waypoints.map((w) => w.index).join(","),
          want.waypoints.map((_, k) => k + 1).join(","),
        );
      });

      check.expectEq("the three maps report three distinct waypoint chains", new Set(sigs).size, 3);
      check.expectEq("a map's waypoint chain is fixed (chosen, not random)", again, sigs[0]);
    },
  };
}
