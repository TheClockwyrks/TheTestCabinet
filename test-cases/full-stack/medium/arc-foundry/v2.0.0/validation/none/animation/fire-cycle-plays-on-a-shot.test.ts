// Arc Foundry — animation/fire-cycle-plays-on-a-shot: the produced firing cycle is
// PLAYED, rather than sitting on disk unused.
//
// THE REQUIREMENT, from `specs/assets.md`: a component's firing cycle is "the
// head's charge-and-discharge, played once per shot", and "a firing cycle is
// played on the frame a structure fires and runs once". So what the build draws
// inside a firing structure's footprint while it is discharging differs from what
// it draws inside that same footprint while the structure is holding fire.
//
// THE SCENARIO, AND WHY IT IS BUILT THIS WAY. One Scrap Capacitor on an empty
// yard and one held Slug in range, and nothing else — the yard is cleared first,
// so the only thing that can change inside the footprint is the structure itself.
// The resting reading is taken between two shots rather than with the target
// removed, so the head is aimed at the same unit at the same heading in both
// readings: a head "rotates to face the unit it is firing at and holds its last
// heading while it holds fire" (`specs/components.md`), and comparing an aimed
// head against an unaimed one would pass a build that rotates and never animates.
//
// THE LATTICE AVOIDS THE SHOT'S OWN LANE. The projectile launches from the
// structure's centre and travels toward the target, so for the first few frames it
// is drawn inside the footprint and a build with no cycle at all would look like
// one that has it. The target is placed directly to the `+x` side, and the lattice
// samples only rows at least eight units off that line, which the `12 x 12`
// projectile sprite of `specs/assets.md` never reaches. What is left in the
// reading is the structure.
//
// THE WINDOW. The specification fixes the cycle's four frames and deliberately
// fixes no rate for them, so the reading runs over the quarter second after the
// shot and asks that the footprint differ from its resting picture on at least one
// of those frames. That covers a cycle played at any rate from four frames a
// second up, and it is well inside the Capacitor's own `1.6` shots per second
// cadence, so no second shot lands inside the window.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { structureCenter } from "../constants";
import {
  captureReplay,
  createHarness,
  openYard,
  parkUnit,
  standComponent,
  ticks,
  type Harness,
} from "../harness";
import { read } from "./region";

/** The Capacitor's anchor, on clear ground away from every waypoint platform. */
const ANCHOR = { col: 20, row: 10 };
const CENTRE = structureCenter(ANCHOR.col, ANCHOR.row);

/** The held target, ninety units to the `+x` side: inside the Scrap range of 100. */
const TARGET = { x: CENTRE.x + 90, y: CENTRE.y };

/** Frames of cooldown to settle on before the resting picture is read. */
const REST_FRAMES = ticks(0.4);

/** Frames of the discharge the reading covers, from the shot's own frame. */
const CYCLE_FRAMES = ticks(0.25);

/** The footprint, sampled off the shot's lane: `|dy| >= 8`, inside `+/-16`. */
function footprintPoints(): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  for (const dy of [-16, -12, -8, 8, 12, 16]) {
    for (let dx = -16; dx <= 16; dx += 4) {
      points.push({ x: CENTRE.x + dx, y: CENTRE.y + dy });
    }
  }
  return points;
}

const POINTS = footprintPoints();

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the footprint differently while it fires than while it holds fire", async () => {
  await openYard(h, { wave: 1 });
  await standComponent(h, "capacitor", 1, ANCHOR.col, ANCHOR.row);
  await parkUnit(h, "slug", TARGET);

  // The first shot, so the head is aimed; then the cooldown, where the cycle has
  // run out and the projectile is long gone. That picture is the resting one.
  const first = await h.until((s) => s.projectiles.length > 0, {
    maxFrames: ticks(2),
  });
  assertEqual(
    first.hit,
    true,
    "a Scrap Capacitor with a unit ninety units away to fire within two " +
      "seconds, at its stated 1.6 shots per second (specs/components.md)",
  );
  await h.advance(REST_FRAMES);
  const resting = await read(h, POINTS);

  const shot = await captureReplay(h, "shot", async () => {
    const next = await h.until((s) => s.projectiles.length > 0, {
      maxFrames: ticks(2),
    });
    const readings: string[] = [await read(h, POINTS)];
    for (let i = 0; i < CYCLE_FRAMES; i += 1) {
      await h.advance(1);
      readings.push(await read(h, POINTS));
    }
    return { fired: next.hit, readings };
  });

  assertEqual(shot.fired, true, "a second shot within two seconds");
  assertGreaterThan(
    shot.readings.filter((reading) => reading !== resting).length,
    0,
    "the footprint to be drawn differently on at least one frame of the " +
      "quarter second after a shot than while the structure is holding fire, " +
      "so the produced firing cycle is played on the shot (specs/assets.md)",
  );
});
