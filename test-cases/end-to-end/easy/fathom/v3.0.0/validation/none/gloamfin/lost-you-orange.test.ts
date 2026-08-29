// gloamfin/lost-you-orange — a lost chase casts one orange ping.
//
// THE CLAIM. `specs/predators/gloamfin.md`: "a chasing Gloamfin that arrives on its
// fixed tile and finds the forager gone starts to search. It reports `state` as
// `"search"`", and "`GLOAMFIN_SEARCH_DELAY` (`1.2 s`) into the search the Gloamfin
// casts one guaranteed ping, whatever its ping timer says. That ping is drawn
// orange and reports `tint` `"orange"`, plainly apart from the violet of an
// ordinary one... A search casts one such ping at most." `specs/state.md` carries
// the same three tints. So: reach the empty tile, count the oranges, and time the
// first of them from the moment the search opened.
//
// HOW THE FIX IS MADE STALE. `setPredatorState(index, "chase")` fixes on "the
// forager's current tile" (`specs/instrumentation.md`), and the same file's
// `setForagerTile` then moves the forager elsewhere. A fix taken by a ping or a
// pulse "names the tile the forager was on... and stays on that tile afterward", so
// the Gloamfin drives to a tile nobody is on, which is exactly the arrangement the
// search rule describes.
//
// WHERE THE FORAGER GOES. A SEALED pocket, not merely a distant tile. Close hearing
// reaches `GLOAMFIN_HEAR` (`64`) "in the dark, through rock", and the search casts
// about within `GLOAMFIN_SEARCH_ROAM` (`2`) tiles of the fix, so a forager that
// could be reached — or merely heard — would hand the Gloamfin a fresh fix, end the
// search early and take the orange ping with it. Seven tiles of solid rock puts it
// three and a half times the hearing range away and leaves no corridor between them.
//
// THE FLOOR IS OUT OF THE WAY. The guaranteed ping "obeys the same
// `GLOAMFIN_PING_MIN_GAP` floor... waiting until both allow it", so a search opened
// just after an ordinary ping would delay it legitimately. Here the chase is four
// tiles, the search opens inside a second and the orange is due inside three — well
// before the first ordinary ping of a Gloamfin's cadence could have gone. What
// happens when the floor DOES bite is `gloamfin/ping-floor`'s point.
//
// WHAT THIS DOES NOT DECIDE. The ordinary cadence (`gloamfin/ping-cadence`), what a
// ping reveals (`gloamfin/ping-reveals-nothing`), or how long the search runs
// before it gives up.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual, assertNotEqual } from "../assert";
import { GLOAMFIN_SEARCH_DELAY, TICK_HZ } from "../constants";
import { placeForager, placePredator, poseMaze } from "../fixtures";
import { captureReplay, createHarness, type Harness } from "../harness";
import {
  denAllExcept,
  quietBoard,
  requirePredatorMotion,
  requireSceneHeld,
  sceneGuard,
  startPlaying,
} from "../scene";
import { gloamfinOf, pingLog, requireGloamfin, sweep } from "./pings";

/**
 * The fixture: the forager rests on `F`, the Gloamfin chases from `P` four tiles
 * along, and `R` is the sealed pocket the forager is moved to once the fix is set.
 */
const STALE_FIX = ["F...P    R.."];

/**
 * The watch, in ticks, split into what a clip is made of and what runs after it.
 *
 * Seven and a half seconds. On a conforming build the chase covers its four tiles
 * inside a second, the search opens there, the orange ping goes a further
 * `GLOAMFIN_SEARCH_DELAY` (`1.2 s`) in, and `GLOAMFIN_GIVEUP` (`5 s`) later the
 * search ends — so the whole of the window the point is about, and the end of it,
 * fall inside. Only the first four seconds are recorded: they hold the arrival,
 * the search and the ping, and the rest is a hunter casting about a tile.
 */
const RECORDED_TICKS = 4 * TICK_HZ;
const AFTER_TICKS = Math.round(3.5 * TICK_HZ);

/**
 * How far the guaranteed ping may sit from `GLOAMFIN_SEARCH_DELAY`, in seconds.
 *
 * A tenth of a second, the tolerance this case states for its other timed pings.
 * The watch samples every two ticks and both the search's opening and the ping are
 * read off those samples, so the grain contributes at most a thirtieth of this.
 */
const DELAY_TOLERANCE = 0.1;

let h: Harness;

beforeEach(async (ctx) => {
  h = await createHarness(ctx);
});

afterEach(async () => {
  await h.dispose();
});

it("A lost chase casts one orange ping", async () => {
  await startPlaying(h);
  const board = await poseMaze(h, STALE_FIX);
  const index = requireGloamfin(h, board.snap);
  const quiet = await denAllExcept(h, [index]);
  // The forager stands on the tile the fix is about to be taken on...
  await placeForager(h, board.mark("F"), "right");
  await placePredator(h, index, board.mark("P"), {
    dir: "left",
    state: "chase",
  });
  // ...and is then moved out of reach, which is what leaves the fix stale.
  await quietBoard(h, board.mark("R"));
  const guard = await sceneGuard(h, quiet);

  const opening = await h.snapshot();
  const log = pingLog(index);
  let searchOpened: number | null = null;
  let searchClosed: number | null = null;
  const watch = (snap: Parameters<typeof log.observe>[0]): void => {
    log.observe(snap);
    const state = gloamfinOf(snap, index).state;
    if (state === "search" && searchOpened === null) {
      searchOpened = snap.simTime;
    }
    if (state !== "search" && searchOpened !== null && searchClosed === null) {
      searchClosed = snap.simTime;
    }
  };

  await captureReplay(h, "orange", () => sweep(h, RECORDED_TICKS, watch));
  await sweep(h, AFTER_TICKS, watch);
  const ending = await h.snapshot();

  requireSceneHeld(h, ending, guard);

  if (searchOpened === null) {
    requirePredatorMotion(
      h,
      opening,
      ending,
      index,
      "chase the four tiles to the tile its fix named and find it empty",
    );
    h.unmet(
      'the Gloamfin never reported state "search" after reaching the tile its ' +
        "fix named, so there was no search for the guaranteed ping to fall " +
        'inside — specs/predators/gloamfin.md takes "chase" to "search" when ' +
        "it reaches its fixed tile and the forager is not there, and " +
        "gloamfin/chase-cap is where a chase that never arrives is reported",
    );
  }

  const opened: number = searchOpened;
  const closed = searchClosed ?? ending.simTime;
  const oranges = log.sightings.filter(
    (sighting) =>
      sighting.tint === "orange" &&
      sighting.t >= opened &&
      sighting.t <= closed,
  );

  assertEqual(
    oranges.length,
    1,
    `orange pings cast between the search opening and its end, over the ` +
      `${(closed - opened).toFixed(2)} s it ran; the whole watch saw tints ` +
      `[${log.sightings.map((sighting) => sighting.tint).join(", ")}] — ` +
      `specs/predators/gloamfin.md casts one guaranteed ping into a search and ` +
      `"a search casts one such ping at most"`,
  );
  assertNotEqual(
    oranges[0].tint,
    "violet",
    "the guaranteed ping's tint, against the violet of an ordinary one — " +
      'specs/predators/gloamfin.md draws it orange, "plainly apart from the ' +
      'violet of an ordinary one"',
  );
  assertLessThanOrEqual(
    Math.abs(oranges[0].t - opened - GLOAMFIN_SEARCH_DELAY),
    DELAY_TOLERANCE,
    `how far into the search the orange ping went, against ` +
      `GLOAMFIN_SEARCH_DELAY (${GLOAMFIN_SEARCH_DELAY} s); it went ` +
      `${(oranges[0].t - opened).toFixed(3)} s in`,
  );
});
