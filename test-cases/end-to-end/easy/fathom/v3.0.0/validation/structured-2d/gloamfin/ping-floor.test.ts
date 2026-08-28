// gloamfin/ping-floor — no two pings closer than the floor.
//
// THE CLAIM. `specs/predators/gloamfin.md` puts a floor under every ping a
// Gloamfin casts: the timer reaching `0` casts one "provided at least
// `GLOAMFIN_PING_MIN_GAP` (`3 s`) has passed since its last ping", and the
// guaranteed ping of a search "obeys the same `GLOAMFIN_PING_MIN_GAP` floor and the
// same silence under a hearing lock as any other ping, waiting until both allow
// it". The second half is the one worth arranging for: a build that honors the
// floor for its ordinary cadence and lets the guaranteed ping through on top of it
// breaks the rule exactly where the specification bothered to restate it.
//
// SO THE SCENARIO PUTS THE TWO ON A COLLISION COURSE. The chase runs fourteen
// tiles, which a conforming Gloamfin covers in three and a third seconds, and the
// search opens there — a little BEFORE the four-second mark its ordinary ping
// timer runs out on. `GLOAMFIN_SEARCH_DELAY` (`1.2 s`) after the search opens, the
// guaranteed ping is due; by then the ordinary one has already gone and started the
// floor. A conforming Gloamfin waits the floor out and casts three seconds later. A
// build that ignores the floor for its guaranteed ping casts about one and a half
// seconds after the ordinary one, and this measures the gap.
//
// THE FIX IS MADE STALE THE SAME WAY `gloamfin/lost-you-orange` does it, and the
// forager goes to a SEALED pocket for the same reason: close hearing reaching it
// would hand the Gloamfin a fresh fix and end the search before the guaranteed ping
// was ever due.
//
// WHAT THIS DOES NOT DECIDE. What the ordinary interval is
// (`gloamfin/ping-cadence`), or when in a search the guaranteed ping falls
// (`gloamfin/lost-you-orange`). Both are stood aside for by name below.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
  assertNull,
} from "../assert";
import { GLOAMFIN_PING_MIN_GAP, TICK_HZ } from "../../src/constants";
import { placeForager, poseMaze } from "../fixtures";
import {
  captureReplay,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import {
  denAll,
  quietBoard,
  requireKind,
  requirePredatorMotion,
  sceneGuard,
  sceneHeld,
  standDown,
} from "../scene";
import { pingGaps, pingLog, placePredator, sweep } from "./pings";

/**
 * The fixture: the forager rests on `F`, the Gloamfin chases from `P` fourteen
 * tiles along, and `R` is the sealed pocket the forager is moved to.
 */
const LONG_CHASE = ["R   F" + ".".repeat(13) + "P"];

/**
 * The watch, in ticks, split into what runs off camera and what a clip is made of.
 *
 * Nine and a half seconds, which covers the ordinary ping at around four seconds,
 * the guaranteed one the floor holds back to around seven, and the end of the
 * `GLOAMFIN_GIVEUP` (`5 s`) search after that. The last four seconds are recorded,
 * which is the stretch the second ping falls in.
 */
const WATCH_TICKS = Math.round(9.5 * TICK_HZ);
const RECORDED_TICKS = 4 * TICK_HZ;
const OFF_CAMERA_TICKS = WATCH_TICKS - RECORDED_TICKS;

/**
 * How far under `GLOAMFIN_PING_MIN_GAP` a measured gap may fall, in seconds.
 *
 * A twentieth of a second, which is three times the largest error the watch itself
 * can introduce: it samples every two ticks, so each sighting is at most a
 * sixtieth of a second late and a gap at most a thirtieth wrong in either
 * direction. It is a sixtieth of the floor it guards, so a build that cast its
 * guaranteed ping on the search's own schedule — a second and a half early — misses
 * this by thirty times over.
 */
const FLOOR_SLACK = 0.05;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("No two pings closer than the floor", async () => {
  startPlaying(h);
  const board = await poseMaze(h, LONG_CHASE);
  const index = requireKind(h.snapshot(), "gloamfin");
  const quiet = await denAll(h, [index]);
  await placeForager(h, board.mark("F"), "right");
  await placePredator(h, index, board.mark("P"), {
    dir: "left",
    state: "chase",
  });
  await quietBoard(h, board.mark("R"));
  const guard = await sceneGuard(h, quiet);

  const opening = h.snapshot();
  const log = pingLog(index);
  await sweep(h, OFF_CAMERA_TICKS, (snap) => log.observe(snap));
  await captureReplay(h, "floor", () =>
    sweep(h, RECORDED_TICKS, (snap) => log.observe(snap)),
  );
  const ending = h.snapshot();

  assertNull(sceneHeld(ending, guard), "the scenario held to the end");

  const { sightings } = log;
  const tints = sightings.map((sighting) => sighting.tint);
  if (!tints.includes("violet")) {
    standDown(
      `the Gloamfin cast no ordinary violet ping across the ` +
        `${(WATCH_TICKS / TICK_HZ).toFixed(1)} s watched, so the stretch this ` +
        `point measures never held the ordinary cadence it is about — whether a ` +
        `Gloamfin pings on its own cadence at all is gloamfin/ping-cadence's ` +
        `verdict, not this one's`,
    );
  }
  if (!tints.includes("orange")) {
    requirePredatorMotion(
      opening,
      ending,
      index,
      "chase the fourteen tiles to the tile its fix named and search there",
    );
    standDown(
      `the Gloamfin cast no orange ping across the ` +
        `${(WATCH_TICKS / TICK_HZ).toFixed(1)} s watched, so the guaranteed ping ` +
        `this point measures the floor against never arrived — whether a lost ` +
        `chase casts one is gloamfin/lost-you-orange's verdict, not this one's`,
    );
  }

  const gaps = pingGaps(sightings);
  assertGreaterThanOrEqual(
    gaps.length,
    1,
    `gaps between the pings cast over the watch; the tints seen were ` +
      `[${tints.join(", ")}]`,
  );
  assertLessThanOrEqual(
    GLOAMFIN_PING_MIN_GAP - Math.min(...gaps),
    FLOOR_SLACK,
    `how far the closest two pings fell under GLOAMFIN_PING_MIN_GAP ` +
      `(${GLOAMFIN_PING_MIN_GAP} s); the gaps measured ` +
      `[${gaps.map((gap) => gap.toFixed(3)).join(", ")}] s across tints ` +
      `[${tints.join(", ")}] — specs/predators/gloamfin.md holds every ping, the ` +
      `guaranteed one included, until the floor allows it`,
  );
});
