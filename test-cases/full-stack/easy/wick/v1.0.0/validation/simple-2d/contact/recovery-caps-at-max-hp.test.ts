// contact/recovery-caps-at-max-hp — recovery raises hp to exactly maxHp and no
// higher: with Tinder 5 held and hp a hundredth below maxHp, one tick reads
// maxHp exactly and later ticks hold it there.
//
// THE RULE, FROM THE SPEC. specs/world.md, Health and recovery: "On every tick,
// before contact damage is applied: hp = min(maxHp, hp + recovery × TICK_DT)".
// specs/passives.md: "recovery = BASE_RECOVERY + TINDER_RECOVERY_PER_LEVEL ×
// tinder", so Tinder 5 gives 2.5 health per second, 2.5 / 60 ≈ 0.0417 a tick,
// more than the 0.01 the pose leaves below maxHp; the min therefore chooses
// maxHp itself on the first tick, and every tick after reads
// min(maxHp, maxHp + 0.0417) = maxHp again. maxHp is BASE_MAX_HP (100) with no
// Tallow held.
//
// THE POSE. An isolated night: Tinder at level 5 in the first passive slot,
// hp posed to maxHp − 0.01 through setHp, nothing else on the field and every
// switch off, so recovery is the only thing that can move hp. One tick is read,
// then a further 60 to see the cap hold.
//
// THE TOLERANCE. None: min(maxHp, ...) yields the maxHp value itself, so the
// reading is exactly 100 on a conformant build, and a build that let recovery
// overshoot reads 100.0317 after the first tick and 102.5 after the second.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BASE_MAX_HP, derived, PASSIVES, TICK_DT } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  isolate,
  type Harness,
} from "../harness";

/** Tinder at its max level, 5: recovery 2.5 a second. */
const TINDER_LEVEL = PASSIVES.tinder.maxLevel;

/** How far below maxHp hp is posed: less than one tick of recovery. */
const SHORTFALL = 0.01;

/** How many further ticks the cap is watched holding. */
const HOLD_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads exactly maxHp after one tick from maxHp − 0.01 and holds there", async () => {
  isolate(h);
  holdPassive(h, "tinder", TINDER_LEVEL);
  const posed = h.snapshot();
  assertEqual(posed.run.maxHp, BASE_MAX_HP, "maxHp with no Tallow held");
  // One tick of recovery covers the shortfall, so the cap is what decides.
  assertEqual(
    derived.recovery({ tinder: TINDER_LEVEL }) * TICK_DT > SHORTFALL,
    true,
    "one tick of Tinder 5 recovery exceeds the shortfall",
  );
  h.debug.setHp(BASE_MAX_HP - SHORTFALL);

  const first = await h.tick(1);
  captureStill(h, "capped");
  assertEqual(
    first.run.player.hp,
    BASE_MAX_HP,
    "hp after one tick of recovery",
  );

  const held = await h.tick(HOLD_TICKS);
  assertEqual(
    held.run.player.hp,
    BASE_MAX_HP,
    `hp after ${HOLD_TICKS} further ticks at the cap`,
  );
});
