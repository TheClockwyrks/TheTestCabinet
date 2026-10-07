// Arc Foundry — effects/death-burst: a dying unit pops where it died.
//
// THE REQUIREMENT, from `specs/assets.md`: the death burst is spawned when "a unit
// dies", it carries "an electrical pop, scaled up for a Dynamo", and it is spawned
// "where a unit dies".
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
// shot that landed a frame earlier. The killed ground has to keep moving on more
// frames than the control did, which is the second system playing where the first
// one alone played on the control. How long it plays for and how it fades are the
// build's: `specs/assets.md` fixes no span for any of the twelve.
//
// AND THE CONTROL HAS TO FALL SHORT OF THE SPAN, which is why the span is two
// seconds rather than a fraction of one. The control is a ceiling: the killed
// ground has to move on MORE frames than it, so a control that moved on every
// frame of its span is a control no conforming build can beat, and a span shorter
// than the impact burst it holds saturates for exactly that reason. The span is
// therefore long enough for a shot's own effect to finish inside it, and the
// point says so out loud — a saturated control is reported as a span too short
// rather than as a build that played nothing.
//
// THE CONTROL IS TAKEN TWICE, AND ONE FRAME MORE THAN IT IS NOT A BURST. The two
// spans do not hold the same impact burst: `specs/assets.md` says each system "is
// played live and simulated as it plays, so it varies from one firing to the
// next", so the shot that kills and the shot that does not raise two DIFFERENT
// instances of one system, and the frames they happen to change on differ a
// little for that reason alone. A build that plays no death burst at all can
// therefore edge a single-take control by a frame — measured, it does — so the
// control is taken twice on the same ground from the same head, and what the kill
// has to beat is the larger of the two takes BY MORE THAN THE TWO TAKES DIFFER
// FROM EACH OTHER. That margin is the system's own variation, measured in the run
// rather than assumed, and a second system playing over the first clears it by
// far more than it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
import { structureCenter } from "../constants";
import {
  captureReplay,
  createHarness,
  holdWaveOpen,
  openYard,
  parkUnit,
  standComponent,
  ticks,
  unitById,
  type Harness,
} from "../harness";
import { lattice, motion } from "./region";

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

/** Windows read after the ground goes bare, so two seconds in all. */
const WINDOWS = 20;

/**
 * How many times the control shot is taken.
 *
 * Two, so the spread between them measures the impact burst's own variation and
 * the kill has to beat the larger take by more than it. See the header.
 */
const CONTROL_TAKES = 2;

/**
 * The wave the yard is opened at, so the control Mote survives a Scrap Capacitor
 * shot with health to spare.
 */
const WAVE = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Frames the region changed on, across two seconds from the frame drawn. */
async function movingFrames(): Promise<number> {
  let total = 0;
  for (let i = 0; i < WINDOWS; i++) total += await motion(h, POINTS, WINDOW);
  return total;
}

it("sets the ground moving where a unit died, over and above the shot that killed it", async () => {
  await openYard(h, { wave: WAVE });
  await holdWaveOpen(h);
  await h.advance(1);
  const bare = await movingFrames();
  assertEqual(
    bare,
    0,
    "the empty ground to stand still before anything is played on it, so what " +
      "the two spans below read is what was played there (specs/assets.md)",
  );

  await standComponent(h, "capacitor", 1, ANCHOR.col, ANCHOR.row);

  // The control, taken twice: the same head, the same ground, a shot that kills
  // nothing. Twice, because the spread between the two takes is the margin the
  // kill has to clear — see the header.
  const controls: number[] = [];
  for (let take = 0; take < CONTROL_TAKES; take += 1) {
    const tough = await parkUnit(h, "mote", AT);
    const full = unitById(await h.snapshot(), tough).hp;
    const struck = await h.until((s) => unitById(s, tough).hp < full, {
      maxFrames: ticks(3),
    });
    assertEqual(
      struck.hit,
      true,
      `a Scrap Capacitor to hit a Mote eighty units away within three seconds ` +
        "(specs/components.md)",
    );
    await h.debug.setUnitPosition(tough, AWAY.x, AWAY.y);
    controls.push(await movingFrames());
    assertGreaterThan(
      unitById(await h.snapshot(), tough).hp,
      0,
      `a wave ${WAVE} Mote to survive the control shot, so the control span ` +
        "carries no death (specs/enemies.md)",
    );
  }
  const control = Math.max(...controls);
  const spread = control - Math.min(...controls);
  assertLessThan(
    control,
    WINDOW * WINDOWS,
    "the control span to end with the ground at rest, so it is a ceiling a " +
      "burst can be read against rather than one nothing could exceed " +
      "(specs/assets.md)",
  );

  // The kill: the same head, the same ground, a shot that removes the unit.
  const victim = await parkUnit(h, "mote", AT, { hp: 1 });

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
  assertGreaterThan(
    played.moving,
    control + spread,
    "the ground a unit DIED on to keep changing on more frames than the same " +
      "ground did after an identical shot landed there and killed nothing — by " +
      "more than the two control takes differed from each other, which is the " +
      "impact burst's own variation — so a burst is played where a unit dies " +
      "and not merely where a shot lands (specs/assets.md); the control takes " +
      `changed on ${controls.join(" and ")} of ${WINDOW * WINDOWS} frames`,
  );
});
