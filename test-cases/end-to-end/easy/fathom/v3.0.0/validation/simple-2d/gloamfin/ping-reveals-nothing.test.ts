// gloamfin/ping-reveals-nothing — its ping reveals nothing.
//
// THE CLAIM, in `specs/predators/gloamfin.md`'s own words: "a ping reveals no tile,
// remembers no tile, and marks no predator and no drifter. It does not draw the
// Gloamfin that cast it, which stays hidden until the forager's light, a sonar
// mark, or its own detection alert shows it." `specs/sensing.md` says the same of
// it from the other side — "the Gloamfin's ping reveals nothing... it draws no
// tile, reveals and remembers no tile, and marks no predator and no drifter, the
// Gloamfin that cast it included" — and adds the one thing that IS drawn: "its
// wavefront is drawn sweeping outward through the corridors".
//
// SO THERE ARE THREE READINGS, and they are three because a build can pass any two
// of them while failing the third. The fog's own report (`visibility`, which
// `specs/state.md` gives `u` for a tile "never touched by the forager's light, a
// sonar pulse or a flare"); the `lit` flag of every predator and every drifter,
// which the same file makes true "while its body is being drawn this instant";
// and the PIXELS, which are the only reading that catches a build that draws a
// reveal it never records.
//
// THE ROOM IS SEALED AND DARK, AND THAT IS WHAT MAKES THE READINGS DECIDABLE. The
// forager stands in a corridor of its own with solid rock between, so its light
// cannot reach the room the ping sweeps and every tile there is unrevealed both
// before and after. Anything that changes out there was changed by the ping.
//
// A DRIFTER AND A SECOND HUNTER STAND IN THE ROOM, because "marks no predator and
// no drifter" is not a claim a check can make of an empty corridor. The second
// hunter is a LANTERNJAW rather than a Flarefish: a Flarefish's flare "lights the
// full disc of the flare radius... revealing and remembering every tile in it"
// (`specs/sensing.md`), which would reveal the room under the measurement and blame
// the ping for it.
//
// THE PIXELS ARE SAMPLED WHERE NOTHING IS DRAWN. The drifter and the Lanternjaw's
// bulb are amber lights "drawn at all times and at any distance" in this variant
// (`specs/sensing.md`), so a pair that moved under the reading would change pixels
// the ping never touched. Both are held exactly where they are put —
// `setPredatorMind` and `setDrifterMind` (`specs/instrumentation.md`) — and the
// sample tiles are chosen at least two tiles clear of each of them. Only the
// Gloamfin runs its own mind, because the ping is what this point reads.
//
// AND THEY ARE SAMPLED AFTER THE FRONT HAS GONE. The wavefront itself IS drawn
// while it travels, so a reading taken under it would measure the one thing the
// specification says to draw. The pixels are read once the ping has left `pulses`
// entirely, which is strictly after its front passed every tile it reached.
//
// WHAT THIS DOES NOT DECIDE. What a FORAGER's pulse reveals (`sonar/*`), what the
// unrevealed fog looks like (`fog/unrevealed-black`), or when a ping is cast
// (`gloamfin/ping-cadence`).

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertLessThanOrEqual,
  assertTrue,
} from "../assert";
import { GLOAMFIN_PING_RANGE, TICK_HZ, TILE } from "../../src/constants";
import { poseMaze, spawnPredator } from "../fixtures";
import {
  captureReplay,
  centerOf,
  createHarness,
  startPlaying,
  visibilityOf,
  type Harness,
} from "../harness";
import { Tile } from "../maze";
import { FathomSnapshot } from "../surface";
import { parkForager, requireSceneHeld, sceneGuard } from "../scene";

/**
 * The fixture: the forager's own corridor at `N`, and across three tiles of solid
 * rock an eleven-tile room holding the Lanternjaw on `A`, a drifter on `B`, the
 * eight tiles `C` the pixels are sampled from, and the Gloamfin on `G`.
 *
 * ELEVEN TILES, so that every tile of the room is inside the
 * `GLOAMFIN_PING_RANGE` (`9`) corridor steps a ping floods to from all but the two
 * furthest origins, and the check confirms the reach it actually got rather than
 * assuming it.
 */
const SEALED_ROOM = ["N..   AB" + "C".repeat(8) + "G"];

/**
 * How long the scenario will wait for the Gloamfin to cast, in ticks.
 *
 * Six seconds, comfortably over the `GLOAMFIN_PING_INTERVAL` (`4 s`) a Gloamfin
 * out of the den carries its timer through. A hard bound rather than an open wait,
 * so a build that never pings fails a stated budget instead of hanging.
 */
const PING_BUDGET = 6 * TICK_HZ;

/**
 * How long the ping's flight is watched for, in ticks.
 *
 * A ping runs `GLOAMFIN_PING_RANGE` (`9`) corridor steps at the
 * `SONAR_WAVE_SPEED` (`14`) steps a second `specs/sensing.md` fixes, so it is over
 * inside seven tenths of a second. Two seconds is nearly three times that.
 */
const FLIGHT_BUDGET = 2 * TICK_HZ;

/** Ticks after the wavefront has gone before the second reading, and the clip's tail. */
const AFTER_TICKS = 12;
const TAIL_TICKS = 40;

/**
 * How far a sampled tile must stand from anything the build draws, in logical
 * units, when it is chosen and when it is read again.
 *
 * Two tiles at the choosing and one and a half at the re-check: an amber light is a
 * single glowing point (`specs/gameplay.md`), and the reading takes under a second,
 * over which a drifter at `DRIFTER_SPEED` (`64`) covers half a tile.
 */
const CLEAR_UNITS = 2 * TILE;
const RECHECK_UNITS = 1.5 * TILE;

/** How many tiles the pixels are sampled at. */
const SAMPLE_TILES = 3;

/**
 * How far a pixel may move across the ping, on the `0`-to-`441` scale an RGB
 * distance runs on.
 *
 * Twenty-five, the review item's own bound, which is under six percent of the
 * range. The two things a build might wrongly draw here are far outside it: this
 * variant's remembered dim and its lit brightness are whole steps apart from the
 * flat unrevealed fog, which is why `fog/unrevealed-black` can tell them apart at
 * all.
 */
const PIXEL_TOLERANCE = 25;

/** One device pixel, as the harness reads it back: `[r, g, b, a]`. */
type Pixel = [number, number, number, number];

/** The Euclidean distance between two colors, on the same `0`-to-`441` scale. */
function pixelDistance(a: Pixel, b: Pixel): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Everything the build draws wherever it stands: the drifters and the Lanternjaw. */
function drawnCreatures(
  snap: FathomSnapshot,
  gloamfin: number,
): { x: number; y: number }[] {
  return [
    ...snap.drifters,
    ...snap.predators.filter((_predator, index) => index !== gloamfin),
  ];
}

/** How far a tile's center stands from the nearest thing the build draws. */
function clearance(snap: FathomSnapshot, tile: Tile, gloamfin: number): number {
  const center = centerOf(snap, tile);
  return Math.min(
    ...drawnCreatures(snap, gloamfin).map((each) =>
      Math.hypot(each.x - center.x, each.y - center.y),
    ),
    Number.POSITIVE_INFINITY,
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("Its ping reveals nothing", async () => {
  await startPlaying(h);
  const board = await poseMaze(h, SEALED_ROOM);
  // The room this point is about: one Gloamfin running its own mind, and one
  // Lanternjaw and one drifter held exactly where they are put so the pixels
  // below can only be the ping's doing.
  const gloamfin = await spawnPredator(h, "gloamfin", board.mark("G"), {
    state: "wander",
  });
  const lanternjaw = await spawnPredator(h, "lanternjaw", board.mark("A"), {
    state: "wander",
    mind: false,
  });
  await h.debug.spawnDrifter(board.mark("B").tx, board.mark("B").ty);
  await h.debug.setDrifterMind(0, false);
  await parkForager(h, board.mark("N"));
  const guard = await sceneGuard(h);

  const room: Tile[] = [
    board.mark("A"),
    board.mark("B"),
    ...board.all("C"),
    board.mark("G"),
  ];

  // The room is dark before the ping, which is what makes every reading below the
  // ping's doing: `poseMaze` puts the whole board back to unrevealed and the room
  // is sealed from the forager's light (specs/sensing.md).
  const opening = h.snapshot();
  const litEarly = room.filter((tile) => visibilityOf(opening, tile) !== "u");
  assertLength(
    litEarly,
    0,
    `tiles of the sealed room already revealed before any ping was cast, of ` +
      `the ${room.length} it holds — what the ping changes is read off them`,
  );

  // Wait for the cast off camera, so the clip is the flight rather than the wait.
  const cast = await h.until(
    (snap) => snap.pulses.some((pulse) => pulse.source === "gloamfin"),
    { maxFrames: PING_BUDGET, poll: 1 },
  );
  assertEqual(
    cast.hit,
    true,
    `the Gloamfin cast a ping within ${PING_BUDGET / TICK_HZ} s, which is the ` +
      "wavefront this point reads the maze either side of",
  );
  const before = cast.snapshot;
  const ping = before.pulses.find((pulse) => pulse.source === "gloamfin");
  const origin: Tile = { tx: ping?.ox ?? 0, ty: ping?.oy ?? 0 };

  // The room is one straight corridor, so a corridor step is a column, and the
  // reach a ping got is |tx - ox| from the tile it was cast on.
  const reach = (tile: Tile): number => Math.abs(tile.tx - origin.tx);
  const lanternjawTile = before.predators[lanternjaw];
  assertLessThanOrEqual(
    reach(lanternjawTile),
    GLOAMFIN_PING_RANGE,
    `the corridor steps between the tile the ping was cast on and the held ` +
      `Lanternjaw, against the GLOAMFIN_PING_RANGE (${GLOAMFIN_PING_RANGE}) ` +
      'steps a ping floods to — the wavefront has to reach it for "marks no ' +
      'predator" to be asked of anything',
  );

  // The tiles the pixels are read at: swept by this ping, and clear of everything
  // the build draws wherever it stands.
  const sampled = room
    .filter(
      (tile) =>
        reach(tile) >= 2 &&
        reach(tile) <= GLOAMFIN_PING_RANGE &&
        clearance(before, tile, gloamfin) >= CLEAR_UNITS,
    )
    .sort((a, b) => reach(b) - reach(a))
    .slice(0, SAMPLE_TILES);
  assertGreaterThan(
    sampled.length,
    0,
    "tiles of the posed room both inside the ping's reach and clear of the " +
      "drifter and the Lanternjaw, which are drawn wherever they stand — they " +
      "are where a pixel the ping alone could have changed is read",
  );
  const points = sampled.map((tile) => centerOf(before, tile));
  const beforePixels = points.map((point) => h.pixel(point.x, point.y));

  const flight = await captureReplay(h, "silent", async () => {
    const drawn: { tick: number; kinds: string[] }[] = [];
    let ticks = 0;
    for (; ticks < FLIGHT_BUDGET; ticks += 1) {
      await h.advance(1);
      const snap = h.snapshot();
      // Both amber creatures answer for themselves. A drifter's `lit` says
      // whether its body is drawn, which its amber mote is drawn under its own
      // rule and cannot be read for.
      const shown = [
        ...snap.predators
          .filter((predator) => predator.lit)
          .map((predator) => predator.kind),
        ...snap.drifters.filter((drifter) => drifter.lit).map(() => "drifter"),
      ];
      if (shown.length > 0) drawn.push({ tick: ticks, kinds: shown });
      if (!snap.pulses.some((pulse) => pulse.source === "gloamfin")) break;
    }
    await h.advance(AFTER_TICKS);
    const settled = h.snapshot();
    const afterPixels = points.map((point) => h.pixel(point.x, point.y));
    // Past the readings, so the clip carries a moment after the wavefront has
    // gone. Nothing below reads anything taken after this line.
    await h.advance(TAIL_TICKS);
    return { drawn, ticks, settled, afterPixels };
  });

  requireSceneHeld(h.snapshot(), guard);
  assertTrue(
    flight.ticks < FLIGHT_BUDGET,
    `the ping's wavefront left \`pulses\` within ${FLIGHT_BUDGET} ticks — ` +
      `specs/sensing.md ends a pulse once its front passes its range, and a ping ` +
      `runs GLOAMFIN_PING_RANGE (${GLOAMFIN_PING_RANGE}) steps at ` +
      `SONAR_WAVE_SPEED (14) steps a second`,
  );

  const litLate = room.filter(
    (tile) => visibilityOf(flight.settled, tile) !== "u",
  );
  assertEqual(
    litLate.length,
    0,
    `tiles of the sealed room reporting anything but "u" once the ping had ` +
      `passed over them, of ${room.length} — specs/predators/gloamfin.md: a ping ` +
      `reveals no tile and remembers no tile`,
  );

  assertEqual(
    flight.drawn.length,
    0,
    `samples of the ping's flight at which any creature reported lit true; the ` +
      `first was ` +
      `${flight.drawn.length > 0 ? flight.drawn[0].kinds.join(" and ") : "none"} ` +
      `— specs/predators/gloamfin.md: a ping "marks no predator and no ` +
      `drifter", "the Gloamfin that cast it included"`,
  );

  let read = 0;
  for (const [order, tile] of sampled.entries()) {
    const stillClear = clearance(flight.settled, tile, gloamfin);
    // A drifter or the Lanternjaw that drifted onto a sample tile under the
    // reading would move pixels the ping never touched, so that tile is dropped
    // rather than blamed on the ping. The count is asserted below, so dropping
    // every one of them cannot pass this point on nothing.
    if (stillClear < RECHECK_UNITS) continue;
    read += 1;
    assertLessThanOrEqual(
      pixelDistance(beforePixels[order], flight.afterPixels[order]),
      PIXEL_TOLERANCE,
      `how far the pixel at tile (${tile.tx}, ${tile.ty}) — ${reach(tile)} ` +
        `corridor steps from where the ping was cast — moved across the ping, on ` +
        `the 0-to-441 RGB scale; it read ` +
        `[${beforePixels[order].slice(0, 3).join(", ")}] before and ` +
        `[${flight.afterPixels[order].slice(0, 3).join(", ")}] after`,
    );
  }
  assertGreaterThan(
    read,
    0,
    `tiles whose pixels were still clear of every drawn creature when the ` +
      `second reading was taken, of the ${sampled.length} the first reading ` +
      `used`,
  );
});
