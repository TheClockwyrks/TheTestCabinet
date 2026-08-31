// instrumentation/snapshot-shape — `snapshot()` reports the whole object
// specs/instrumentation.md documents, with every field at its documented type,
// read off a strait that is actually carrying one of everything.
//
// specs/instrumentation.md fixes the shape exactly — "`snapshot` returns exactly
// this object. Every field an operation can set is present, so every operation is
// verifiable by setting it and reading it back" — and the rest of this suite
// reads its verdicts out of that object. A field that is absent, or that answers
// with something of the wrong kind, therefore costs the point that asks for it
// somewhere else, under a heading about a mechanic. This point names it here
// instead.
//
// THE STRAIT IS POSED SO NO ROSTER IS EMPTY. An empty array satisfies "is an
// array" while saying nothing about the entries the specification describes, so
// the strait carries a critter, two bears, a vehicle in every one of the eight
// ice lanes, a floe in every one of the eight water lanes, one filled bay and a
// posed bonus catch — and every per-entry field is read off a real entry.
//
// AND NOTHING ON IT MOVES BETWEEN THE PICTURE AND THE READING. Every lane is
// posed at a speed of `0` (`poseLane`), which specs/instrumentation.md says holds
// the lane where it stands, and both bears have all three faculties held off, so
// the frame driven for the picture leaves the strait exactly as the readings
// below find it.
//
// WHAT THIS DOES NOT DECIDE. Nothing about the VALUES. That each pose is read
// back is `instrumentation/poses-read-back`'s, what a lane's speed means is
// `ice/*`'s and `water/*`'s, and what a bear's `swimming` flag is derived from is
// `hunter/*`'s. This point reads only that every documented field is there and is
// of the documented kind.

import { afterEach, beforeEach, it } from "vitest";
import { BAY_COUNT, ICE_LANES, WATER_LANES } from "../../src/constants";
import {
  assertContains,
  assertEqual,
  assertGreaterThan,
  assertLength,
} from "../assert";
import {
  captureStill,
  createHarness,
  poseBear,
  poseLane,
  startCrossing,
  type Facing,
  type FloeKind,
  type FloeSnapshot,
  type Footing,
  type Harness,
  type Phase,
  type Screen,
  type VehicleKind,
} from "../harness";
import { FLOE_DEBUG_VERSION } from "../surface";

/** The six screens and the three phases, as specs/instrumentation.md lists them. */
const SCREENS: readonly Screen[] = [
  "title",
  "howto",
  "playing",
  "paused",
  "victory",
  "gameover",
];
const PHASES: readonly Phase[] = ["crossing", "dying", "clearing"];

/** The four facings and the three footings the shape names. */
const FACINGS: readonly Facing[] = ["up", "down", "left", "right"];
const FOOTINGS: readonly Footing[] = ["solid", "floe", "water"];

/** The two directions a lane may run. */
const DIRECTIONS: readonly number[] = [1, -1];

/** The tile the critter is posed on: inside the ice band, clear of both bears. */
const CRITTER_COL = 20;
const CRITTER_ROW = 14;

/** The two tiles the bears are settled on, one per band, clear of the critter. */
const BEAR_TILES: readonly (readonly [number, number])[] = [
  [4, 12],
  [34, 6],
];

/** The column each band's posed item is laid at, one item per lane. */
const ITEM_COL = 8;

/** The bay posed filled, and the bay the posed bonus catch sits in. */
const FILLED_BAY = 1;
const FISH_BAY = 3;

/** Every field of one reported tile is a number. */
function assertTile(tile: { col: unknown; row: unknown }, what: string): void {
  assertEqual(typeof tile.col, "number", `${what}.col`);
  assertEqual(typeof tile.row, "number", `${what}.row`);
}

/** Every field of one reported lane is of its documented kind. */
function assertLane(
  lane: FloeSnapshot["iceLanes"][number],
  what: string,
): void {
  assertEqual(typeof lane.row, "number", `${what}.row`);
  assertContains(DIRECTIONS, lane.dir, `${what}.dir`);
  assertEqual(typeof lane.speed, "number", `${what}.speed`);
}

/** Every field of one reported lane item is of its documented kind. */
function assertItem(
  item: FloeSnapshot["vehicles"][number],
  kinds: readonly string[],
  what: string,
): void {
  assertEqual(typeof item.id, "number", `${what}.id`);
  assertEqual(typeof item.row, "number", `${what}.row`);
  assertContains(kinds, item.kind, `${what}.kind`);
  assertEqual(typeof item.x, "number", `${what}.x, which is its LEFT EDGE`);
  assertEqual(typeof item.len, "number", `${what}.len, in tiles`);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports every documented field, from a strait carrying one of everything", async () => {
  startCrossing(h);

  h.debug.setCritterTile(CRITTER_COL, CRITTER_ROW);

  // Two bears, both held still: this point reads their fields, and a bear that
  // travelled between the picture and the reading would be reporting another
  // point's mechanic.
  for (const [col, row] of BEAR_TILES) {
    poseBear(h, col, row, { sense: false, routing: false, travel: false });
  }

  // One vehicle in every ice lane and one floe in every water lane, each lane
  // held at a speed of 0 by `poseLane` for the same reason.
  for (const lane of ICE_LANES) {
    poseLane(h, lane.row, lane.kind as VehicleKind, [ITEM_COL]);
  }
  for (const lane of WATER_LANES) {
    poseLane(h, lane.row, lane.kind as FloeKind, [ITEM_COL]);
  }

  h.debug.setBay(FILLED_BAY, true);
  h.debug.setFishBay(FISH_BAY);

  await h.advance(1);
  // Before the readings, so a build with a missing field still leaves the
  // picture of the strait every reported value was read from.
  captureStill(h, "posed");

  const s = h.snapshot();

  // ---- The run ------------------------------------------------------------

  assertEqual(s.version, FLOE_DEBUG_VERSION, "snapshot().version");
  assertContains(SCREENS, s.screen, "snapshot().screen");
  assertContains(PHASES, s.phase, "snapshot().phase");
  assertEqual(typeof s.phaseTimer, "number", "snapshot().phaseTimer");
  assertEqual(typeof s.menuIndex, "number", "snapshot().menuIndex");
  assertEqual(typeof s.level, "number", "snapshot().level");
  assertEqual(typeof s.reachedLevel, "number", "snapshot().reachedLevel");
  assertEqual(typeof s.lives, "number", "snapshot().lives");
  assertEqual(typeof s.score, "number", "snapshot().score");
  assertEqual(typeof s.timer, "number", "snapshot().timer");
  assertEqual(
    typeof s.timerMax,
    "number",
    "snapshot().timerMax, derived from the level (specs/progression.md)",
  );
  assertEqual(typeof s.muted, "boolean", "snapshot().muted");
  assertEqual(typeof s.simTime, "number", "snapshot().simTime");

  // ---- The four world gates -----------------------------------------------

  assertEqual(typeof s.bearEmergence, "boolean", "snapshot().bearEmergence");
  assertEqual(typeof s.catchTest, "boolean", "snapshot().catchTest");
  assertEqual(typeof s.fishCadence, "boolean", "snapshot().fishCadence");
  assertEqual(typeof s.timerRunning, "boolean", "snapshot().timerRunning");

  // ---- The bays and the bonus catch ---------------------------------------

  assertLength(
    s.bays,
    BAY_COUNT,
    `snapshot().bays, one entry per bay of the far shore (BAY_COUNT ` +
      `${BAY_COUNT}, specs/strait.md)`,
  );
  for (const [index, filled] of s.bays.entries()) {
    assertEqual(typeof filled, "boolean", `snapshot().bays[${index}]`);
  }
  assertEqual(
    typeof s.fishBay,
    "number",
    `snapshot().fishBay after setFishBay(${FISH_BAY}), which is the bay index ` +
      `holding the bonus catch or null when none is out`,
  );

  // ---- The critter --------------------------------------------------------

  assertEqual(
    typeof s.critter.present,
    "boolean",
    "snapshot().critter.present",
  );
  assertTile(s.critter, "snapshot().critter");
  assertEqual(
    typeof s.critter.x,
    "number",
    "snapshot().critter.x, which is its CENTER",
  );
  assertEqual(
    typeof s.critter.y,
    "number",
    "snapshot().critter.y, which is its CENTER",
  );
  assertContains(FACINGS, s.critter.facing, "snapshot().critter.facing");
  assertContains(
    FOOTINGS,
    s.critter.footing,
    "snapshot().critter.footing, derived from its row and the floes on it",
  );
  assertEqual(
    typeof s.critter.hopCooldown,
    "number",
    "snapshot().critter.hopCooldown, in seconds",
  );
  assertEqual(typeof s.critter.bestRow, "number", "snapshot().critter.bestRow");

  // ---- The bears ----------------------------------------------------------

  assertLength(
    s.bears,
    BEAR_TILES.length,
    "snapshot().bears, of which this scenario posed two",
  );
  for (const bear of s.bears) {
    assertEqual(typeof bear.id, "number", "snapshot().bears[].id");
    assertTile(bear, "snapshot().bears[], the tile it last settled on");
    assertEqual(
      typeof bear.stepCol,
      "number",
      "snapshot().bears[].stepCol, the tile it is travelling into",
    );
    assertEqual(typeof bear.stepRow, "number", "snapshot().bears[].stepRow");
    assertEqual(
      typeof bear.x,
      "number",
      "snapshot().bears[].x, which is its CENTER",
    );
    assertEqual(typeof bear.y, "number", "snapshot().bears[].y");
    assertContains(FACINGS, bear.facing, "snapshot().bears[].facing");
    assertEqual(typeof bear.swimming, "boolean", "snapshot().bears[].swimming");
    assertTile(bear.target, "snapshot().bears[].target");
    assertEqual(typeof bear.sense, "boolean", "snapshot().bears[].sense");
    assertEqual(typeof bear.routing, "boolean", "snapshot().bears[].routing");
    assertEqual(typeof bear.travel, "boolean", "snapshot().bears[].travel");
  }

  // ---- The sixteen lanes and the two rosters -------------------------------

  assertLength(
    s.iceLanes,
    ICE_LANES.length,
    "snapshot().iceLanes, the eight ice lanes (specs/ice.md)",
  );
  for (const lane of s.iceLanes) assertLane(lane, "snapshot().iceLanes[]");

  assertLength(
    s.waterLanes,
    WATER_LANES.length,
    "snapshot().waterLanes, the eight water lanes (specs/water.md)",
  );
  for (const lane of s.waterLanes) assertLane(lane, "snapshot().waterLanes[]");

  assertGreaterThan(
    s.vehicles.length,
    0,
    "snapshot().vehicles, of which this scenario posed one per ice lane",
  );
  for (const item of s.vehicles) {
    assertItem(item, ["plow", "dogsled", "car"], "snapshot().vehicles[]");
  }

  assertGreaterThan(
    s.floes.length,
    0,
    "snapshot().floes, of which this scenario posed one per water lane",
  );
  for (const item of s.floes) {
    assertItem(item, ["pan", "raft3", "raft4"], "snapshot().floes[]");
  }
});
