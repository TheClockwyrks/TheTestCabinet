// Automated validation for the overload variant's Mode sub-item `mode.shard-overload`.
//
// A Shard driven to overload launches a fast headlong dive toward the player's x,
// faster than a normal dive. A Shard is posed off to one side with the ship far
// away, brought to the brink (setDroneCharge), and tipped over by a real mismatched
// shot; its plunge is stepped forward and its speed and heading read back.

import {
  startClean,
  spawnDrone,
  findDrone,
  shootDrone,
  DIVE_SPEED,
} from "../_helpers.mjs";

const DIVE_MAX_TICKS = 60; // 60 ticks = the old 0.5 s cap on the dive launching

// The speed is measured across exactly 0.1 s of simulation — 12 ticks — so the
// divisor below stays 0.1 and the result stays px/s, directly comparable to the
// DIVE_SPEED constant.
const MEASURE_TICKS = 12;
const MEASURE_SECONDS = 0.1;

// The old bend sweep was 20 reads 0.02 s apart — a 0.4 s window. 0.02 s is 2.4
// ticks, which the tick contract refuses rather than rounds, so the poll rounds DOWN
// to 2: it is a SAMPLING poll tracking the drone's minimum x, and reading more often
// can only find a lower x, never miss one a coarser sweep would have caught. The
// window is held at the original 0.4 s by budgeting 48 ticks (24 reads at 2 ticks).
const BEND_POLL_TICKS = 2;
const BEND_WINDOW_TICKS = 48;

export default function item() {
  // The Shard, the dive launch, the two positions the speed is measured between,
  // and the furthest left the plunge reached. All in the factory closure, so the
  // two passes cannot see each other's state.
  let shardId;
  let dived;
  let a;
  let b;
  let minX;

  return {
    id: "mode.shard-overload",

    // The Shard is posed to the RIGHT and the ship far to the LEFT, so "bends toward
    // the player" is a fall in x and cannot be confused with the drone simply
    // dropping straight down. Posed one charge short so a real shot tips it.
    async arrange(api) {
      await startClean(api);
      await api.call("setShipX", 300); // far to the left of the drone
      shardId = await spawnDrone(api, {
        kind: "shard",
        band: "cyan",
        x: 900,
        y: 200,
        phase: "formation",
      });
      await api.call("setDroneCharge", shardId, 2);
    },

    async act(api) {
      await shootDrone(api, shardId, "magenta"); // tips it into overload
      dived = await api.until(
        (s) => {
          const d = findDrone(s, shardId);
          return d !== null && d.phase === "diving";
        },
        { max: DIVE_MAX_TICKS },
      );

      // Measure its plunge speed over a short window...
      a = findDrone(await api.snapshot(), shardId);
      await api.advance(MEASURE_TICKS);
      b = findDrone(await api.snapshot(), shardId);

      // ...and confirm, over a longer window, that it bends toward the player's x.
      minX = Math.min(a.x, b.x);
      for (let spent = 0; spent < BEND_WINDOW_TICKS; spent += BEND_POLL_TICKS) {
        await api.advance(BEND_POLL_TICKS);
        const d = findDrone(await api.snapshot(), shardId);
        if (!d || d.phase !== "diving") break;
        minX = Math.min(minX, d.x);
      }

      // Stay on the plunge so the clip shows the headlong dive continuing rather
      // than cutting mid-fall. Every operand above is already captured.
      await api.advance(144); // 144 ticks = the old 1200 ms
    },

    async assert(api, check) {
      check.expectOk("the overloaded Shard launches a dive", dived.hit);
      const speed = Math.hypot(b.x - a.x, b.y - a.y) / MEASURE_SECONDS;
      check.expectGt(
        "the headlong plunge is faster than a normal dive",
        speed,
        DIVE_SPEED * 1.2,
      );
      check.expectLt("the plunge heads toward the player's x", minX, 800);
    },
  };
}
