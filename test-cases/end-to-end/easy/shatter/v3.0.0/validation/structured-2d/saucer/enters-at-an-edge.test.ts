// saucer/enters-at-an-edge — a saucer comes in from the side of the field, never
// out of the middle of it.
//
// THE RULE. `specs/saucer.md`, Entry and travel: "A saucer enters at the left edge
// or the right, chosen at random". The choice is the build's; that it is one of
// the two sides is the requirement.
//
// WHAT IS READ, AND WHY A BAND. The FIRST reported centre of each arrival, held
// against a `40`-unit band at either side. The band is what the arrival costs to
// observe rather than room on the rule: a saucer collides as a circle of
// `SAUCER_R` (`18`), so a build that puts its centre a radius inside the edge is
// entering AT it, and the reading is taken on the first sample after the arrival,
// which under this point's marched frame is up to eight ticks of `SAUCER_SPEED`
// (`140`) — `9.3` units — into the crossing. `18 + 9.3` is `27.3`, so `40` clears
// a conformant build with room while leaving a build that enters anywhere near the
// middle of the field — the nearest of which would be `600` units out — nowhere to
// hide.
//
// EIGHT ARRIVALS UNDER FOUR SEEDS, because the side is drawn at random: one seed
// reads one draw. Every arrival is asserted, not the average of them, so a build
// that enters at an edge most of the time and somewhere else occasionally fails on
// the one that did.
//
// THE ARRIVALS ARE THE GAME'S OWN. `addSaucer` places a craft wherever it is told,
// so a posed one says nothing about where the game puts them. The game is really
// opened and held quiet, and the arrivals it makes are the reading. See `visits.ts`.
//
// WHAT THIS DOES NOT DECIDE. The row it enters on
// (`saucer/entry-row-inside-the-range`, `saucer/enters-at-a-random-row`), the
// speed it crosses at
// (`saucer/crosses-at-cruise`), or when it comes
// (`saucer/first-arrives-at-18s`, `saucer/subsequent-gap`).

import { afterEach, it } from "vitest";
import { FIELD_W, SAUCER_R, SAUCER_SPEED } from "../constants";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import { captureStill, type Harness } from "../harness";
import {
  createMarchHarness,
  MARCH_STEP,
  marchFrames,
  openQuietGame,
  watchVisits,
} from "./visits";

/** The four seeds the entry side is drawn under. */
const SEEDS = [1, 2, 3, 4] as const;

/** How many arrivals each seed's game is watched for. */
const ARRIVALS_PER_SEED = 2;

/**
 * How long each seed's game is watched, in seconds of game time: the `18` s first
 * delay, a `12` s visit and the `35` s upper gap, with five seconds of margin.
 */
const WATCH_SECONDS = 70;

/** The arrivals the whole sweep must produce before it can decide anything. */
const ARRIVALS = SEEDS.length * ARRIVALS_PER_SEED;

/**
 * How far in from a side a first reading may sit, in units.
 *
 * The band the item fixes. It has to hold `SAUCER_R` (`18`) — a build entering
 * with its circle just inside the field — plus what one marched frame of
 * `SAUCER_SPEED` carries the craft before the first sample, which is
 * `140 / 15 = 9.3` units: `27.3` in all, against a `40` band. Half the field
 * away from either side is `600` units, so nothing that is not an entry at a side
 * comes close to passing.
 */
const EDGE_BAND = 40;

let harnesses: Harness[] = [];

afterEach(() => {
  for (const h of harnesses) h.dispose();
  harnesses = [];
});

it("brings every arrival in within 40 units of the left or the right edge", async () => {
  const entries: { seed: number; id: number; x: number }[] = [];
  let filmed = false;

  for (const seed of SEEDS) {
    const h = await createMarchHarness();
    harnesses.push(h);
    const opened = await openQuietGame(h, seed);

    const watch = await watchVisits(h, marchFrames(WATCH_SECONDS) - opened, {
      done: (visits) => visits.length >= ARRIVALS_PER_SEED,
      onArrival: async () => {
        if (filmed) return;
        filmed = true;
        // A saucer entering at the field's edge. The watch runs undrawn, so one
        // frame is drawn for this picture — the frame after the one the entry
        // column was read on.
        await h.paint();
        captureStill(h, "entry");
      },
    });
    for (const visit of watch.visits) {
      entries.push({ seed, id: visit.id, x: visit.x });
    }
  }

  assertGreaterThanOrEqual(
    entries.length,
    ARRIVALS,
    `arrivals produced by ${SEEDS.length} games of ${WATCH_SECONDS} s with the ` +
      "game's own saucer arrival running (specs/saucer.md, The cadence)",
  );

  for (const entry of entries) {
    assertLessThanOrEqual(
      Math.min(entry.x, FIELD_W - entry.x),
      EDGE_BAND,
      `how far in from the nearer side saucer ${entry.id} (seed ${entry.seed}) ` +
        `was first reported, at x = ${entry.x.toFixed(1)} — a saucer enters at ` +
        `the left edge or the right (specs/saucer.md), and the band holds ` +
        `SAUCER_R (${SAUCER_R}) plus one frame of SAUCER_SPEED ` +
        `(${(SAUCER_SPEED * MARCH_STEP).toFixed(1)})`,
    );
  }
});
