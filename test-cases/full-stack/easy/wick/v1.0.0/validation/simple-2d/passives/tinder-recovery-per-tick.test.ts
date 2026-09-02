// passives/tinder-recovery-per-tick — Tinder heals half a point of health a
// second per level, applied on every tick rather than in whole points.
//
// WHERE THE THRESHOLD COMES FROM. specs/passives.md ("The derived stats"):
// "recovery = BASE_RECOVERY + TINDER_RECOVERY_PER_LEVEL × tinder", with
// BASE_RECOVERY 0 and TINDER_RECOVERY_PER_LEVEL 0.5, so Tinder 2 gives 1 health
// per second; and ("Recovery") "On every tick of the `playing` screen:
// hp = min(maxHp, hp + recovery × TICK_DT) ... Recovery is continuous rather
// than periodic", with TICK_DT 1 / 60. From hp 50 the first tick therefore
// reads 50 + 1 / 60 and the sixtieth, one second of game time under the timer
// rule of specs/world.md, reads 51. specs/world.md ("One tick") puts recovery
// at phase 3, so it is applied on every tick the run is on `playing`.
//
// THE WORLD. An isolated playing run: nothing on the field, no weapon held,
// Tinder alone at level 2 in the first passive slot, every driver switch off,
// and hp posed to 50, far below the maxHp of 100 that no Tallow leaves, so the
// cap never binds. Nothing else can move hp: no enemy touches the lamplighter
// and no heal is placed.
//
// WHAT IS READ. hp after each of the sixty ticks, against 50 plus that many
// steps of recovery × TICK_DT. Every tick is read, not the endpoints alone,
// because a build that heals a whole point once a second reaches 51 at the
// sixtieth tick while reading 50 at the first.
//
// TOLERANCE. MOTION_TOLERANCE (1e-6), the case's tolerance for a figure
// integrated tick by tick: sixty additions of 1 / 60 accumulate under 1e-14.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertWithin } from "../assert";
import {
  MOTION_TOLERANCE,
  TICK_DT,
  derived,
  ticksFor,
  type HeldPassives,
} from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  type Harness,
} from "../harness";
import { holdPassives } from "./night";

/** The passives held: Tinder at level 2. */
const HELD: HeldPassives = { tinder: 2 };

/** 0 + 0.5 × 2 = 1 health per second. */
const RECOVERY = derived.recovery(HELD);

/** One tick's recovery: 1 × 1 / 60. */
const STEP = RECOVERY * TICK_DT;

/** The health recovery starts from, far below the maximum. */
const POSED_HP = 50;

/** One second of game time, in ticks, under the timer rule. */
const SPAN = ticksFor(1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("recovers 1 / 60 health a tick with Tinder 2 held, reaching 51 after 60 ticks", async () => {
  isolate(h);
  holdPassives(h, HELD);
  h.debug.setHp(POSED_HP);

  const seen = await captureReplay(h, "recovery", () => h.trace(SPAN));

  assertLength(seen, SPAN, "ticks traced under the recovery");
  seen.forEach((snapshot, index) => {
    const tick = index + 1;
    assertWithin(
      snapshot.run.player.hp,
      POSED_HP + STEP * tick,
      MOTION_TOLERANCE,
      `hp after recovery tick ${tick}`,
    );
  });
  assertWithin(
    seen[SPAN - 1].run.player.hp,
    POSED_HP + RECOVERY,
    MOTION_TOLERANCE,
    "hp after one second of recovery",
  );
});
