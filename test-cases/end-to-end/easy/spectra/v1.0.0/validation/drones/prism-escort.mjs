// Automated validation for the Drones sub-item `prism-escort`.
//
// A Prism flies in escorted by two Shards, one cyan and one magenta, entering
// ALONGSIDE it. A real stage is started (its wave kept) and the whole entrance is
// swept, so the escort is identified by what actually flies in with the Prism.
//
// WHAT THE OLD CHECK MEASURED, AND WHY IT WAS BOTH VACUOUS AND FRAGILE. It stepped
// 0.2 s into the wave, took one snapshot, and counted every drone in `entering`
// phase anywhere on the field: "a Prism is entering" plus "at least two Shards are
// entering". That is not the escort. On a build that lists its whole wave as
// `entering` from the first tick the count came back 15 and 11 — every Shard in the
// formation, none of them near the Prism — so the item passed without ever looking
// at what flew in with the Prism. On a build that releases its groups a few tenths
// of a second apart, the same 0.2 s peek caught exactly one Shard airborne and the
// item failed, though its escort may have been perfectly correct a moment later.
// One instant of one snapshot cannot tell those apart.
//
// WHAT THIS MEASURES INSTEAD. Two properties the spec's word "alongside" actually
// asserts, both read across the whole entrance rather than at a chosen instant:
//
//   * In flight, not merely listed. A drone counts only while it is `entering` AND
//     its position is changing. A build that parks its whole unreleased wave in the
//     drone list contributes nothing until a drone is genuinely flying, which is
//     what "enters with" means and what a player sees.
//   * Together in space. The escorts are the Shards in flight within
//     `ESCORT_RADIUS` of the Prism at the same instant — flying in beside it, not
//     merely airborne somewhere on a 1280 px field.
//
// The best instant of the sweep decides it, so a build is judged on its escort at
// the moment the escort exists rather than on whichever tick the script happened to
// look.

import { startStageClean } from "../_helpers.mjs";

// How near the Prism a Shard must fly to be its escort rather than another drone
// that happens to be airborne. The formation's slots are 64 px apart
// (`specs/playfield.md`), so a group of three entering together spans a couple of
// hundred px; 320 px is a quarter of the field's width — comfortably "alongside"
// for any entrance choreography, and nowhere near loose enough to sweep in a drone
// entering on the other side of the stage.
const ESCORT_RADIUS = 320;

// A drone counts as in flight if it moved at all since the previous sample. At the
// specified 260 px/s entrance speed a sample is ~13 px of travel, so this floor
// separates flying from parked without demanding any particular speed.
const MOVED_EPSILON = 0.5;

// Sample the entrance every 6 ticks for up to 9 s. Entrance groups launch about
// every 0.6 s (`specs/drones.md`) and a full formation is a handful of groups plus
// the last one's flight time, so this covers the whole assembly with room to spare;
// the sweep stops early once the entrance is over.
const POLL_TICKS = 6;
const WINDOW_TICKS = 1080;

/** Drones that are `entering` AND have moved since the previous sample. */
function inFlight(snap, previous) {
  return snap.drones.filter((d) => {
    if (d.phase !== "entering") return false;
    const was = previous.get(d.id);
    if (!was) return false; // first sighting: no displacement to read yet
    return Math.hypot(d.x - was.x, d.y - was.y) > MOVED_EPSILON;
  });
}

export default function item() {
  // The best escort seen across the entrance: the Prism, and the Shards flying in
  // beside it at that instant.
  let sawPrismInFlight = false;
  let bestEscort = [];

  return {
    id: "drones.prism-escort",

    // A real stage-1 wave with the wave the game itself builds — the escort grouping
    // is the thing under test, so nothing here may be posed by hand, and the swarm
    // is deliberately left live: this item is about the entrance flying.
    async arrange(api) {
      await startStageClean(api, 1, { clear: false });
    },

    // The entrance itself, which is both what the assertions read and exactly what a
    // reviewer needs to watch: the Prism sweeping in with two Shards beside it.
    async act(api) {
      let previous = new Map();
      let sawAnyEntering = false;

      for (let spent = 0; spent < WINDOW_TICKS; spent += POLL_TICKS) {
        await api.advance(POLL_TICKS);
        const snap = await api.snapshot();

        const flying = inFlight(snap, previous);
        const prism = flying.find((d) => d.kind === "prism");
        if (prism) {
          sawPrismInFlight = true;
          const escort = flying.filter(
            (d) =>
              d.kind === "shard" &&
              Math.hypot(d.x - prism.x, d.y - prism.y) <= ESCORT_RADIUS,
          );
          // Keep the fullest escort the entrance ever shows: a build whose two
          // Shards converge on the Prism part-way through its arc is still entering
          // with an escort, and the moment they are all together is the one the
          // claim is about.
          if (escort.length > bestEscort.length) {
            bestEscort = escort.map((d) => ({
              band: d.effectiveBand ?? d.band,
            }));
          }
        }

        if (snap.drones.some((d) => d.phase === "entering"))
          sawAnyEntering = true;
        else if (sawAnyEntering) break; // the entrance is over
        if (snap.screen !== "inWave") break;

        previous = new Map(snap.drones.map((d) => [d.id, { x: d.x, y: d.y }]));
      }

      // Hold on the assembled formation so the clip ends on the wave the entrance
      // built rather than cutting on the last arrival.
      await api.advance(60);
    },

    async assert(api, check) {
      check.expectOk("a Prism flies in", sawPrismInFlight);
      check.expectGe("two Shards fly in alongside it", bestEscort.length, 2);
      const bands = new Set(bestEscort.map((d) => d.band));
      check.expectOk("the escort includes a cyan Shard", bands.has("cyan"));
      check.expectOk(
        "the escort includes a magenta Shard",
        bands.has("magenta"),
      );
    },
  };
}
