// saucer/enters-at-an-edge — a saucer comes in from the side of the field, never
// out of the middle of it.
//
// THE RULE. `specs/saucer.md`, Entry and travel: "A saucer enters at the left edge
// or the right, each with probability `1/2` ... heading into the field from the
// edge it entered at." Which edge is the build's draw; that the arrival is AT the
// edge it drew is the requirement.
//
// THE EDGE IS POSED, NOT DRAWN. `specs/instrumentation.md` gives the surface
// `setNextSaucerEdge`, which sets the outcome the entry draw would decide, so each
// edge is asked for by name and the arrival is read against the edge it was asked
// for. Two arrivals per edge, four in all, each on a fresh game with a posed due
// so the arrival comes at once, and every one has to land in its band.
//
// WHAT IS READ, AND WHY A BAND. The FIRST reported centre of each arrival, held
// against a `40`-unit band inside the posed edge. The band is what the arrival
// costs to observe rather than room on the rule: a saucer collides as a circle of
// `SAUCER_R` (`18`), so a build that puts its centre a radius inside the edge is
// entering AT it, and the reading is taken on the first sample after the arrival,
// which under this point's marched frame is up to eight ticks of `SAUCER_SPEED`
// (`140`) — `9.3` units — into the crossing. `18 + 9.3` is `27.3`, so `40` clears
// a conformant build with room while leaving a build that enters anywhere near the
// middle of the field — the nearest of which would be `600` units out — nowhere to
// hide. A centre that began just outside the seam wraps to the far side of it, so
// the reading is taken across the seam.
//
// THE ARRIVALS ARE THE GAME'S OWN. `addSaucer` places a craft wherever it is told,
// so a posed one says nothing about where the game puts them. The game is really
// opened and held quiet, and the arrivals its cadence makes are the reading. See
// `visits.ts`.
//
// WHAT THIS DOES NOT DECIDE. The row it enters on
// (`saucer/entry-row-inside-the-range`, `saucer/enters-at-a-random-row`), the
// speed it crosses at
// (`saucer/crosses-at-cruise`), or when it comes
// (`saucer/first-arrives-at-18s`, `saucer/subsequent-gap`).

import { afterEach, it } from "vitest";
import { FIELD_W, SAUCER_R, SAUCER_SPEED } from "../constants";
import { assertLessThanOrEqual } from "../assert";
import { captureStill, type Harness } from "../harness";
import type { SaucerEdge } from "../surface";
import {
  closeUpArrival,
  createMarchHarness,
  MARCH_STEP,
  openQuietGame,
} from "./visits";

/** The four entries: each edge twice, so no edge is read on a single arrival. */
const ENTRIES: readonly SaucerEdge[] = ["left", "right", "right", "left"];

/**
 * How far in from the posed edge a first reading may sit, in units.
 *
 * The band the item fixes. It has to hold `SAUCER_R` (`18`) — a build entering
 * with its circle just inside the field — plus what one marched frame of
 * `SAUCER_SPEED` carries the craft before the first sample, which is
 * `140 / 15 = 9.3` units: `27.3` in all, against a `40` band. Half the field
 * away from either side is `600` units, so nothing that is not an entry at the
 * posed edge comes close to passing.
 */
const EDGE_BAND = 40;

/** How far inside `edge` a centre stands, across the seam. */
function insideEdge(x: number, edge: SaucerEdge): number {
  const fromEdge = edge === "left" ? x : FIELD_W - x;
  return Math.min(fromEdge, FIELD_W - fromEdge);
}

let harnesses: Harness[] = [];

afterEach(() => {
  for (const h of harnesses) h.dispose();
  harnesses = [];
});

it("brings every arrival in within 40 units of the edge it enters at", async () => {
  for (const [index, edge] of ENTRIES.entries()) {
    // A fresh game for each, so the cadence's first arrival is the one read.
    const h = await createMarchHarness();
    harnesses.push(h);
    await openQuietGame(h);
    h.debug.setNextSaucerEdge(edge);

    const arrival = await closeUpArrival(h);
    if (index === 0) {
      // A saucer entering at the field's edge. The watch runs undrawn, so one
      // frame is drawn for this picture — the frame after the one the entry
      // column was read on.
      await h.paint();
      captureStill(h, "entry");
    }

    assertLessThanOrEqual(
      insideEdge(arrival.x, edge),
      EDGE_BAND,
      `arrival ${index + 1}, posed to enter at the ${edge}: how far inside ` +
        `that edge saucer ${arrival.id} was first reported, at ` +
        `x = ${arrival.x.toFixed(1)} — a saucer enters at the left edge or the ` +
        `right (specs/saucer.md), and the band holds SAUCER_R (${SAUCER_R}) ` +
        `plus one frame of SAUCER_SPEED (${(SAUCER_SPEED * MARCH_STEP).toFixed(1)})`,
    );
  }
});
