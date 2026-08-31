// strait/median-carries-nothing — the median shelf is one of the two strips the
// critter can stand on indefinitely, and nothing the lanes carry ever reaches it.
//
// specs/strait.md: row `10` is "the median shelf (`ROW_MEDIAN`) ... Solid ice,
// full width. It carries no lane", and "the near shore and the median shelf carry
// no vehicle and no floe, at any level. They are the two strips the critter can
// stand on indefinitely without the water or the traffic reaching it." Its
// footing table says the same of what standing there gives: footing is `solid`
// when the row is `10`.
//
// WHY THIS IS READ OVER LIVE LANES RATHER THAN ON A FRESH LAYOUT. A build that
// laid a lane onto the median would be caught by a single reading, but that is
// not the failure worth catching: it is a lane whose items WRAP through the
// median as they run — a wrap that carries a floe off row `9` and back on at row
// `10`, an ice lane whose row is computed from an index that runs one past the
// band. Those show up only after the traffic has been running, so the strait is
// laid out and then run for the ten seconds the item names, with the sixteen
// lanes left exactly as the game laid them.
//
// SO THE LANES ARE THE REQUIREMENT, NOT A BYSTANDER, and this is the one scenario
// in this group that does not empty the strait. `./harness.ts`'s `poseLiveLanes`
// lays a level out, leaves its traffic alone, and shuts only the four WORLD gates
// — the bear's emergence, the catch, the bonus catch's cadence and the crossing
// timer — which are the run's own faculties rather than any lane's. Without them
// a bear emerges behind the critter, the timer takes a life at the end of the ten
// seconds, and a fish arrives in a bay: none of which is the median.
//
// TWO READINGS, EVERY HALF SECOND, IN ONE DIRECTION EACH. What the median CARRIES
// — no vehicle and no floe reports row `10` — and what standing on it GIVES — the
// critter's footing is `solid`. The second is not implied by the first: a build
// whose footing table put the water band on rows `2`-`10` reads `water` on an
// empty median. The critter's row is read beside them as the situation rather
// than the requirement, so a reading taken after the critter had been carried off
// the shelf cannot pass for one taken on it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureReplay,
  createHarness,
  itemsInRow,
  ticksFor,
  type FloeSnapshot,
  type Harness,
} from "../harness";
import { ROW_MEDIAN, START_COL, poseLiveLanes } from "./harness";

/**
 * The level laid out.
 *
 * Level `1`, the level a run opens on (specs/progression.md). The rule holds "at
 * any level" and nothing about it varies with one: the per-level scaling
 * specs/ice.md and specs/water.md fix changes a lane's speed and its gaps, never
 * which row it is on.
 */
const LEVEL = 1;

/** The game time the lanes are run for, in seconds. The item's own figure. */
const SECTION_SECONDS = 10;

/**
 * How long a stretch of that section separates two readings, in seconds.
 *
 * Half a second, which is twenty readings over the section. A lane item's ROW is
 * the row of the lane it belongs to, and the wrap specs/water.md fixes moves an
 * item along its row rather than off it, so an item that ever reaches the median
 * is still reporting row `10` at every later reading and nothing can slip between
 * two of them. What the interval bounds is how soon after the wrap the reading
 * notices, and half a second is inside the first wrap of even the fastest lane:
 * `4.2` tiles a second (specs/water.md, row `4`) crosses the strait's forty
 * columns in nine and a half.
 */
const SAMPLE_SECONDS = 0.5;

/** What the median looked like at one moment. */
interface Reading {
  at: number;
  /** The kinds of every vehicle and floe reporting row `10`. */
  items: string[];
  footing: string;
  row: number;
}

/** The median, read at one moment. */
function readMedian(snapshot: FloeSnapshot, at: number): Reading {
  return {
    at,
    items: [
      ...itemsInRow(snapshot.vehicles, ROW_MEDIAN),
      ...itemsInRow(snapshot.floes, ROW_MEDIAN),
    ].map((item) => item.kind),
    footing: snapshot.critter.footing,
    row: snapshot.critter.row,
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps every vehicle and every floe off the median across ten seconds of live lanes", async () => {
  // A level laid out and left as it was laid, with the critter on the shelf.
  // Nothing has advanced since, so the first reading is the level exactly as it
  // was laid out.
  poseLiveLanes(h, START_COL, ROW_MEDIAN, LEVEL);

  const readings: Reading[] = [readMedian(h.snapshot(), 0)];
  await captureReplay(h, "median", async () => {
    for (let at = SAMPLE_SECONDS; at <= SECTION_SECONDS; at += SAMPLE_SECONDS) {
      await h.advance(ticksFor(SAMPLE_SECONDS));
      readings.push(readMedian(h.snapshot(), at));
    }
  });

  for (const reading of readings) {
    const when =
      reading.at === 0 ? "as the level was laid out" : `at ${reading.at} s`;
    // The situation: the reading really was taken with the critter on the shelf.
    assertEqual(
      reading.row,
      ROW_MEDIAN,
      `the critter's row ${when}: it was posed on the median shelf and nothing ` +
        `on that row may carry it (specs/strait.md)`,
    );
    assertLength(
      reading.items,
      0,
      `the vehicles and floes reporting row ${ROW_MEDIAN} ${when}: the median ` +
        `shelf carries no vehicle and no floe, at any level (specs/strait.md)` +
        (reading.items.length === 0
          ? ""
          : `; found ${reading.items.join(", ")}`),
    );
    assertEqual(
      reading.footing,
      "solid",
      `the critter's footing on the median shelf ${when} (specs/strait.md)`,
    );
  }
});
