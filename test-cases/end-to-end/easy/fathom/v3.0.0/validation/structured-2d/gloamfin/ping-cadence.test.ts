// gloamfin/ping-cadence — it pings on its own cadence.
//
// THE CLAIM. `specs/predators/gloamfin.md` gives the ping a timer of its own: it
// "runs down every step, whatever the Gloamfin is doing, and when it reaches `0`
// the Gloamfin casts a ping", and "casting a ping sets the timer back to
// `GLOAMFIN_PING_INTERVAL` (`4 s`)". A ping is "cast from the Gloamfin's tile",
// appears in `pulses` "with `source` `"gloamfin"`", and an ordinary one "is drawn
// in the Gloamfin's own violet and reports `tint` `"violet"`"
// (`specs/state.md` carries the same two fields). So a watch long enough for three
// pings decides four things at once: that they arrive at all, that each is the
// Gloamfin's own, that each leaves the Gloamfin's own tile, and that the gaps
// between them are the interval.
//
// WHY THE GLOAMFIN IS SEALED AWAY FROM THE FORAGER. The same file makes a Gloamfin
// "silent for as long as it holds" a close-range hearing lock, so a patrol that
// wanders into the forager stops pinging and the measurement ends. `specs/maze.md`
// has a laid-out maze in one connected region, which cannot keep them apart for
// thirteen seconds; a posed fixture is exempt from those rules
// (`specs/instrumentation.md`) and simply puts them in separate rooms. That the
// silence itself is correct is `gloamfin/silent-when-close`'s point, not this one's.
//
// WHAT THIS DOES NOT DECIDE. What the floor between two pings is
// (`gloamfin/ping-floor`), what a search's guaranteed ping does
// (`gloamfin/lost-you-orange`), or what a ping reveals
// (`gloamfin/ping-reveals-nothing`).

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
  assertTrue,
} from "../assert";
import { GLOAMFIN_PING_INTERVAL, TICK_HZ } from "../../src/constants";
import { poseApart, spawnPredator } from "../fixtures";
import {
  captureReplay,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { parkForager, requireSceneHeld, sceneGuard } from "../scene";
import { castFromOwnTile, gloamfinOf, pingGaps, pingLog, sweep } from "./pings";

/** How far the patrol's sealed ring stands from the forager's room, in tiles. */
const APART_TILES = 10;
const RING_TILES = 4;

/**
 * How many pings the watch has to see.
 *
 * Three, which the review item states, because two pings give one gap and one gap
 * cannot tell a cadence from a coincidence.
 */
const PINGS_WANTED = 3;

/**
 * The watch, in ticks, split into the stretch that runs off camera and the
 * stretch a clip is made of.
 *
 * A Gloamfin out of the den carries its timer from the moment it is loose, so on a
 * conforming build the three pings land around four, eight and twelve seconds.
 * Fourteen seconds of watching leaves room for a build that opens its timer
 * differently and still sees three. The last five of those seconds are recorded,
 * which puts two of the three pings in the clip without spending its budget on the
 * nine seconds before them.
 */
const WATCH_TICKS = 14 * TICK_HZ;
const RECORDED_TICKS = 5 * TICK_HZ;
const OFF_CAMERA_TICKS = WATCH_TICKS - RECORDED_TICKS;

/**
 * How far a gap may sit from `GLOAMFIN_PING_INTERVAL`, in seconds.
 *
 * A tenth of a second, which is the review item's own bound. The watch samples
 * every two ticks, so a gap it reports is at most a sixtieth of a second wrong in
 * either direction — a thirtieth of this — and what the bound therefore turns on
 * is the build's cadence rather than the watch's grain.
 */
const GAP_TOLERANCE = 0.1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("It pings on its own cadence", async () => {
  startPlaying(h);
  const rooms = await poseApart(h, APART_TILES, { ring: RING_TILES });
  const index = await spawnPredator(h, "gloamfin", rooms.far, {
    travel: false,
    state: "wander",
  });
  await parkForager(h);
  // The Gloamfin patrols across the board in the dark, so the canvas alone would
  // record a black screen. The debug overlay is a read-only panel carrying each
  // predator's kind, state, tile and speed, toggled by the backtick key
  // (`specs/instrumentation.md`), so this changes nothing and gives the clip
  // something to show.
  await h.tap("Backquote");
  const guard = await sceneGuard(h);

  const log = pingLog(index);
  const states = new Set<string>();
  const watch = (snap: Parameters<typeof log.observe>[0]): void => {
    log.observe(snap);
    states.add(gloamfinOf(snap, index).state);
  };

  await sweep(h, OFF_CAMERA_TICKS, watch);
  await captureReplay(h, "ping", () => sweep(h, RECORDED_TICKS, watch));

  requireSceneHeld(h.snapshot(), guard);
  assertEqual(
    [...states].join(","),
    "wander",
    "the Gloamfin's state across the watch: this point measures the cadence of " +
      "a WANDERING Gloamfin, and specs/predators/gloamfin.md silences one that " +
      "holds a close-range hearing lock",
  );

  const { sightings } = log;
  assertGreaterThanOrEqual(
    sightings.length,
    PINGS_WANTED,
    `pings cast over ${WATCH_TICKS / TICK_HZ} s — specs/predators/gloamfin.md ` +
      `has the timer reach 0 and the Gloamfin cast, then sets the timer back to ` +
      `GLOAMFIN_PING_INTERVAL (${GLOAMFIN_PING_INTERVAL} s)`,
  );

  for (const [order, sighting] of sightings.entries()) {
    assertEqual(
      sighting.source,
      "gloamfin",
      `the source of ping ${order + 1} — specs/state.md names the caster of a ` +
        `wavefront in \`source\``,
    );
    assertEqual(
      sighting.tint,
      "violet",
      `the tint of ping ${order + 1} — specs/predators/gloamfin.md draws an ` +
        `ordinary ping in the Gloamfin's own violet and reports tint "violet"`,
    );
    assertTrue(
      castFromOwnTile(sighting),
      `ping ${order + 1} was cast from the Gloamfin's own tile: it reported an ` +
        `origin of (${sighting.origin.tx}, ${sighting.origin.ty}) while the ` +
        `Gloamfin held ` +
        `${sighting.casterTiles.map((tile) => `(${tile.tx}, ${tile.ty})`).join(" then ")} ` +
        `— specs/predators/gloamfin.md casts a ping from the Gloamfin's tile`,
    );
  }

  for (const [order, gap] of pingGaps(sightings).entries()) {
    assertLessThanOrEqual(
      Math.abs(gap - GLOAMFIN_PING_INTERVAL),
      GAP_TOLERANCE,
      `how far the gap between ping ${order + 1} and ping ${order + 2} sat from ` +
        `GLOAMFIN_PING_INTERVAL (${GLOAMFIN_PING_INTERVAL} s), the value casting ` +
        `a ping sets the timer back to (specs/predators/gloamfin.md); the gap ` +
        `measured ${gap.toFixed(3)} s`,
    );
  }
});
