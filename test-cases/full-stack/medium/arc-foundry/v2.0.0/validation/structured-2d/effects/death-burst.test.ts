// Arc Foundry — effects/death-burst: a dying unit pops where it died.
//
// THE REQUIREMENT, from `specs/assets.md`: the death burst is spawned when "a unit
// dies", it carries "an electrical pop, scaled up for a Dynamo", and it is spawned
// "where a unit dies".
//
// THE PRODUCED SYSTEMS ARE SERVED TO THE LOADER HERE, by `./produced.ts`, so what
// plays is the file the build committed.
//
// WHY THIS POINT NEEDS A CONTROL, AND WHAT THE CONTROL IS. A unit dies where the
// shot that killed it landed, and `specs/assets.md` puts a SECOND system at that
// same place — the impact burst, spawned "where a shot lands". So a reading of the
// ground a unit died on carries both, and a build that plays only the impact burst
// leaves that ground moving exactly as a build that plays both does for as long as
// the impact burst runs. Reading the ground alone therefore decides nothing. What
// this point reads instead is the DIFFERENCE between two shots that land on the
// same ground from the same head: one that kills, and one that does not. Everything
// but the death is held identical, so what separates them is the burst the death
// raised.
//
// THE WORLD. One Scrap Capacitor and, at a time, one Mote held eighty units away
// inside its stated range, on clear ground well off the map's waypoint platforms
// and its chain. A second Mote is held at the entry, out of every range, so the
// live wave cannot clear in the middle of a reading. Nothing else is on the yard.
//
// THE CONTROL SHOT. The first Mote is held at the wave the yard was opened at, so
// its health is far more than one Scrap Capacitor shot takes, and it survives. On
// the frame its health first drops — the frame the shot landed — it is moved far
// away and out of range, so from that frame the ground it stood on is bare and
// carries the impact burst alone, exactly as the ground a dead unit leaves behind.
//
// THE KILL. A second Mote is then held on the same ground with one point of
// health, so the next shot from the same head removes it, and the same span is
// read from the frame it leaves the yard.
//
// WHAT IS DECIDED. Both spans are of bare ground; both carry the impact burst of a
// shot that landed a frame earlier. The killed ground must keep moving across at
// least half a window of frames MORE than the control did. Half a window is a
// twentieth of a second of extra movement, which is the least a burst that is
// "played live and simulated as it plays" can leave behind it, and it is far below
// the separation a system playing for even a tenth of a second produces.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
} from "../assert";
import {
  captureReplay,
  createHarness,
  type Harness,
  holdWaveClear,
  openYard,
  parkUnit,
  standComponent,
  ticks,
  unitById,
} from "../harness";
import { serveProducedAssets } from "./produced";
import { lattice, motion } from "./region";
import { structureCenter } from "../constants";

/** Clear ground, well away from the map's waypoint platforms and its chain. */
const ANCHOR = { col: 21, row: 18 };
const HEAD = structureCenter(ANCHOR.col, ANCHOR.row);

/** Eighty units away, inside the Scrap Capacitor's stated range of `100`. */
const AT = { x: HEAD.x + 80, y: HEAD.y };

/** Where the control unit is put once it has taken its shot: far out of range. */
const AWAY = { x: HEAD.x + 520, y: HEAD.y + 300 };

/** The ground the unit stands on, clear of the structure's own footprint. */
const POINTS = lattice(AT, 18, 3);

/** One window of frames. */
const WINDOW = ticks(0.1);

/** Windows read after the ground goes bare, so half a second in all. */
const WINDOWS = 5;

/**
 * The wave the yard is opened at, so the control Mote survives a Scrap Capacitor
 * shot with health to spare.
 */
const WAVE = 30;

/** How many more frames the killed ground must move on than the control did. */
const MARGIN = WINDOW / 2;

let h: Harness;

beforeEach(async () => {
  serveProducedAssets();
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Frames the region changed on, across half a second from the frame drawn. */
async function movingFrames(): Promise<number> {
  let total = 0;
  for (let i = 0; i < WINDOWS; i += 1) total += await motion(h, POINTS, WINDOW);
  return total;
}

it("sets the ground moving where a unit died, over and above the shot that killed it", async () => {
  openYard(h, { wave: WAVE });
  holdWaveClear(h);
  await h.advance(1);
  const bare = await movingFrames();
  assertEqual(
    bare,
    0,
    "the empty ground to stand still before anything is played on it, so what " +
      "the two spans below read is what was played there (specs/assets.md)",
  );

  standComponent(h, "capacitor", 1, ANCHOR.col, ANCHOR.row);

  // The control: the same head, the same ground, a shot that kills nothing.
  const tough = parkUnit(h, "mote", AT);
  const full = unitById(h.snapshot(), tough).hp;
  const struck = await h.until((s) => unitById(s, tough).hp < full, {
    maxFrames: ticks(3),
  });
  assertEqual(
    struck.hit,
    true,
    `a Scrap Capacitor to hit a Mote eighty units away within three seconds ` +
      "(specs/components.md)",
  );
  h.debug.setUnitPosition(tough, AWAY.x, AWAY.y);
  const control = await movingFrames();
  assertGreaterThan(
    unitById(h.snapshot(), tough).hp,
    0,
    `a wave ${WAVE} Mote to survive the control shot, so the control span ` +
      "carries no death (specs/enemies.md)",
  );

  // The kill: the same head, the same ground, a shot that removes the unit.
  const victim = parkUnit(h, "mote", AT, { hp: 1 });

  const played = await captureReplay(h, "death", async () => {
    const died = await h.until((s) => !s.units.some((u) => u.id === victim), {
      maxFrames: ticks(3),
    });
    return { died: died.hit, moving: await movingFrames() };
  });

  assertEqual(
    played.died,
    true,
    "a Scrap Capacitor to kill a one-health Mote eighty units away within " +
      "three seconds (specs/components.md)",
  );
  assertGreaterThanOrEqual(
    played.moving,
    control + MARGIN,
    "the ground a unit DIED on to keep changing across at least " +
      `${MARGIN} frames more than the same ground did after an identical shot ` +
      "landed there and killed nothing, so a burst is played where a unit dies " +
      `and not merely where a shot lands (specs/assets.md); the control span ` +
      `changed on ${control} of ${WINDOW * WINDOWS} frames`,
  );
});
