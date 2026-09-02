// flarefish/flare-reveals — the bloom lights a disc of `FLARE_RADIUS` around the
// Flarefish, rock and floor alike and straight through rock, and nothing outside
// it.
//
// `specs/predators/flarefish.md`: "`flaring` is true and `flareRadius` is
// `FLARE_RADIUS` (`192`, 6 tiles) for this window" and "While the bloom burns it
// lights a disc of radius `FLARE_RADIUS` centered on the Flarefish ... every tile
// whose center lies inside the disc is revealed and drawn at full light, floor and
// wall alike, straight through any rock between." `specs/sensing.md` gives the
// state that is: "Lit ... `l` ... Revealed this instant by the forager's light, a
// live sonar mark or a flare."
//
// THREE CLAIMS, AND A BUILD CAN HOLD ANY TWO. The radius it reports, the disc it
// actually lights, and the edge of that disc. So this reads `flareRadius`, then
// every tile of the grid whose center falls inside the disc, then the ring of
// tiles just outside it.
//
// THE READING IS TAKEN A BEAT INTO THE BLOOM, not on the tick `flaring` turns
// true. Nothing fixes those to the same tick: one build lights the disc as it
// raises the flag and another raises the flag and lights the disc on its next
// step, and both are a flare that reveals its area. Read on the flag's own tick,
// the second kind reports an empty disc beside a `flareRadius` of `192`.
//
// THE CONTROL IS THE DARK BEFORE IT. Every tile of the disc is confirmed
// unrevealed in a snapshot taken before the flare, so "every tile inside is lit"
// cannot be satisfied by a board that was never dark. `setMaze` puts the fog back
// to fully unrevealed (`specs/instrumentation.md`) and the hallway sits eleven
// tiles from the forager's light, so that control holds by construction and the
// check confirms it rather than assuming it.
//
// WHAT THIS DOES NOT DECIDE. How long the bloom burns, which is
// `flarefish/flare-cadence`'s; and what the disc drops back to when the bloom ends,
// which `specs/sensing.md` gives to the fog points.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { FLARE_RADIUS, PREDATOR_SPEED, TICK_HZ, TILE } from "../constants";
import {
  captureReplay,
  createHarness,
  ticks,
  type FathomSnapshot,
  type Harness,
  startPlaying,
} from "../harness";
import { requireSceneHeld, sceneGuard } from "../scene";
import { FIRST_FLARE_MAX, FLARE_POLL, poseFlareRoom } from "./room";
import { tileCenter, type Tile } from "../maze";

/**
 * How far `flareRadius` may sit from `FLARE_RADIUS`, in logical units.
 *
 * The item's bound: one unit of the `192` the page fixes, which is room for a
 * build that stores the radius as a float and nothing else.
 */
const RADIUS_TOLERANCE = 1;

/**
 * How far inside the rim a tile's center must sit to be judged, in logical units.
 *
 * The disc moves with the Flarefish and the Flarefish is traveling at
 * `PREDATOR_SPEED` (`116`), so the position a build evaluated its disc from and
 * the position the same snapshot reports may differ by the unit a tick of that
 * travel covers. Eight units is that difference many times over, and it is a
 * quarter of a tile: the annulus it sets aside is the one place a build may
 * honestly round either way, and it is not where this item's question lives.
 */
const RIM_INSET = 8;

/**
 * How wide the ring of tiles that must have stayed dark is, in logical units.
 *
 * One tile past where the disc can have reached. Where that is depends on the
 * bloom itself: "the disc is stuck to the Flarefish and moves with it"
 * (`specs/sensing.md`), so by the time the reading is taken the bloom has swept a
 * disc's worth of board along the Flarefish's own travel, and a tile it lit a
 * moment ago is remembered rather than dark. The floor is therefore computed from
 * the ground the Flarefish covered since the bloom opened rather than fixed here.
 */
const OUTSIDE_WIDTH = TILE;

/**
 * How far into the bloom the disc is read, in ticks.
 *
 * A fifth of a second, of the `FLARE_BLOOM` (`1 s`) the bloom burns for: past any
 * tick a build takes to light what its flag announced, and with four fifths of the
 * burn left for the clip.
 */
const INTO_BLOOM = ticks(0.2);

/** Ticks of the remaining burn held after the reading, for the clip. */
const TAIL_TICKS = 72;

/**
 * Ticks run before the control reading, so the board has been simulated once.
 *
 * `setMaze` leaves the fog "fully unrevealed" (`specs/instrumentation.md`), so a
 * snapshot taken before any tick reports every tile as `u` — including the ones
 * the forager's own light claims on its first step. The control has to be the
 * board as it stands with that light on, or the ring below would be holding the
 * bloom to account for tiles the forager lit.
 */
const SETTLE_TICKS = 2;

/** How far above the Flarefish the through-rock probe stands, in tiles. */
const THROUGH_ROCK_TILES = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lights every tile inside FLARE_RADIUS through rock while it blooms, and nothing outside it", async () => {
  await startPlaying(h);
  const room = await poseFlareRoom(h);
  const guard = await sceneGuard(h);

  // The control: what the board looked like before any flare, one tick in so the
  // forager's own light has claimed what it claims. Taken before the sweep rather
  // than from it, so "the disc was dark first" is a reading of the scenario
  // rather than of the event being measured.
  await h.advance(SETTLE_TICKS);
  const dark = await h.snapshot();

  const bloom = await h.until(
    (snap) => snap.predators[room.index].flaring === true,
    { maxTicks: ticks(FIRST_FLARE_MAX), poll: FLARE_POLL },
  );
  assertEqual(
    bloom.hit,
    true,
    `the Flarefish bloomed within ${FIRST_FLARE_MAX} s of standing in its own ` +
      "hallway, which is the disc this point reads",
  );

  const lit = await captureReplay(h, "reveal", async () => {
    await h.advance(INTO_BLOOM);
    const snap = await h.snapshot();
    // The rest of the burn, purely so the clip shows the disc standing. The
    // reading is already taken.
    await h.advance(TAIL_TICKS);
    return snap;
  });

  requireSceneHeld(await h.snapshot(), guard);

  const fish = lit.predators[room.index];
  assertEqual(
    fish.flaring,
    true,
    `the Flarefish is still blooming ${INTO_BLOOM} ticks in, when the disc is read`,
  );
  assertLessThanOrEqual(
    Math.abs((fish.flareRadius ?? 0) - FLARE_RADIUS),
    RADIUS_TOLERANCE,
    `how far the reported flareRadius sat from the FLARE_RADIUS ` +
      `(${FLARE_RADIUS}) specs/predators/flarefish.md gives a burning bloom`,
  );

  // How far the bloom's own center travelled between opening and being read: the
  // ground the Flarefish covered, plus the ground it could have covered in the
  // `FLARE_POLL` ticks before the sweep first saw the bloom at all.
  const opened = bloom.snapshot.predators[room.index];
  const swept =
    Math.hypot(fish.x - opened.x, fish.y - opened.y) +
    (PREDATOR_SPEED * FLARE_POLL) / TICK_HZ;
  const outsideMin = FLARE_RADIUS + swept + RIM_INSET;
  const outsideMax = outsideMin + OUTSIDE_WIDTH;

  // Every tile the disc covers, and the ring past everywhere it can have been.
  const inside: Tile[] = [];
  const outside: Tile[] = [];
  for (let ty = 0; ty < lit.grid.rows; ty += 1) {
    for (let tx = 0; tx < lit.grid.cols; tx += 1) {
      const center = tileCenter(lit.grid, { tx, ty });
      const away = Math.hypot(center.x - fish.x, center.y - fish.y);
      if (away <= FLARE_RADIUS - RIM_INSET) inside.push({ tx, ty });
      else if (away >= outsideMin && away <= outsideMax) {
        outside.push({ tx, ty });
      }
    }
  }
  assertGreaterThan(
    inside.length,
    0,
    "tiles of the board whose centers lie inside the bloom's disc",
  );

  const stateOf = (snap: FathomSnapshot, tile: Tile): string =>
    snap.visibility[tile.ty]?.[tile.tx] ?? "?";

  // The ring is judged only where it was dark to begin with. The forager's own
  // light stands eleven tiles off and reaches `VISION_MIN` into the rock around
  // its room (`specs/sensing.md`: "The light reveals the rock it lands on"), so a
  // tile or two of the ring is already revealed by something that is not the
  // bloom, and holding the bloom to account for those would be reading another
  // point's subject.
  const untouched = outside.filter((tile) => stateOf(dark, tile) === "u");

  // The control, stated as a verdict of its own: the disc was dark first.
  const preLit = inside.filter((tile) => stateOf(dark, tile) !== "u");
  assertEqual(
    preLit.length,
    0,
    `tiles inside the disc that were already revealed before the bloom, of ` +
      `${inside.length} — the hallway sits eleven tiles from the forager's ` +
      `light and setMaze leaves the fog fully unrevealed`,
  );

  // And the claim: every one of them lit, rock and floor alike, through rock.
  const unlit = inside.filter((tile) => stateOf(lit, tile) !== "l");
  assertEqual(
    unlit.length,
    0,
    `tiles inside the bloom's ${FLARE_RADIUS}-unit disc that the bloom did not ` +
      `report as lit, of ${inside.length} — specs/predators/flarefish.md lights ` +
      `every tile whose center lies inside it, floor and wall alike, straight ` +
      `through any rock between` +
      (unlit.length > 0
        ? `; the first is (${unlit[0].tx}, ${unlit[0].ty}), reported ` +
          `"${stateOf(lit, unlit[0])}"`
        : ""),
  );

  // Named separately, because "through rock" is the half a build that only lights
  // what it can see would still fail: four tiles straight up from the Flarefish is
  // rock, with three more rock tiles on the line between.
  const throughRock: Tile = {
    tx: fish.tx,
    ty: fish.ty - THROUGH_ROCK_TILES,
  };
  assertEqual(
    lit.tiles[throughRock.ty]?.[throughRock.tx],
    "#",
    `the tile ${THROUGH_ROCK_TILES} tiles above the Flarefish is the rock the ` +
      `fixture seals its hallway with`,
  );
  assertEqual(
    stateOf(lit, throughRock),
    "l",
    `the rock tile ${THROUGH_ROCK_TILES} tiles above the Flarefish ` +
      `(${THROUGH_ROCK_TILES * TILE} units, inside the disc), which the bloom ` +
      `reaches only by lighting straight through the rock between`,
  );

  // The edge: the ring just outside the disc is left as it was.
  assertGreaterThan(
    untouched.length,
    0,
    "tiles just outside the bloom's reach that nothing had revealed before it",
  );
  const leaked = untouched.filter((tile) => stateOf(lit, tile) !== "u");
  assertEqual(
    leaked.length,
    0,
    `tiles between ${outsideMin.toFixed(1)} and ${outsideMax.toFixed(1)} units ` +
      `from the Flarefish that the bloom revealed, of the ` +
      `${untouched.length} that nothing had touched before it — the ` +
      `disc reaches ${FLARE_RADIUS} and its center swept ` +
      `${swept.toFixed(1)} units while it burned` +
      (leaked.length > 0
        ? `; the first is (${leaked[0].tx}, ${leaked[0].ty}), reported ` +
          `"${stateOf(lit, leaked[0])}"`
        : ""),
  );
});
