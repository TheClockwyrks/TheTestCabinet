// Wick — evolutions/pyre-heals-per-hit: each enemy a Pyre slash hits heals the
// lamplighter `PYRE_HEAL`.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Pyre"): "Each enemy a
// Pyre slash hits heals the player `PYRE_HEAL` (`1`) health on the tick of the
// hit, capped at `maxHp`." `PYRE_STATS` gives width `200` and height `60`, and
// `areaMul` is `1` with no passive held, so the facing-side rectangle spans `x`
// from `0` to `200` and `y` from `-30` to `30` about a lamplighter at the origin
// facing right. Three moths at `(50, 0)`, `(100, 0)`, and `(150, 0)` all lie
// inside it and none lies inside the mirrored rectangle, which spans `-200` to
// `0`, so the firing tick lands exactly three hits. `maxHp` is `BASE_MAX_HP`
// (`100`) with no Tallow held and `recovery` is `BASE_RECOVERY` (`0`) with no
// Tinder (`specs/passives.md`), so nothing else moves `hp` on the tick. So from
// `hp` `50` the firing tick leaves `53`, under the cap.
//
// THE POSE. An isolated night, facing posed right, `hp` posed to 50, three
// moths inside the facing slash, and Pyre held at level 1 fired through the
// shared `fireWeapon`. The moths stand `50` and more from the lamplighter's
// center, past `pickupRadius` (`48`, `specs/world.md`) and past the
// `PICKUP_ITEM_RADIUS + PLAYER_RADIUS` (`28`) at which a bread would be
// collected, so nothing their deaths drop reaches the lamplighter on the tick
// and the only change to `hp` is the heal. `enemyMotion` and `enemyContact` are
// off, so they stand where they were posed and land nothing back.
//
// TOLERANCE. `FLOAT_TOL` on `hp`, a real the heal adds three whole units to.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { BASE_MAX_HP, FLOAT_TOL, PYRE_HEAL } from "../constants";
import {
  captureStill,
  createHarness,
  fireWeapon,
  isolate,
  placeEnemy,
  player,
  type Harness,
} from "../harness";
import { MOTH_HP, assertHit } from "./stage";

/** The health the run is posed at, well under the cap. */
const POSED_HP = 50;

/** The three probes, all inside the facing slash and outside the mirrored one. */
const PROBES = [
  { x: 50, y: 0 },
  { x: 100, y: 0 },
  { x: 150, y: 0 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises hp from 50 to 53 on the tick a Pyre slash hits three moths", async () => {
  const opened = await isolate(h);
  await h.debug.setFacing("right");
  await h.debug.setHp(POSED_HP);
  const at = opened.run.player;
  const moths = [];
  for (const probe of PROBES) {
    moths.push(await placeEnemy(h, "moth", at.x + probe.x, at.y + probe.y));
  }
  const posed = await h.snapshot();
  assertEqual(posed.run.maxHp, BASE_MAX_HP, "maxHp with no Tallow held");
  assertNear(player(posed).hp, POSED_HP, FLOAT_TOL, "hp as posed");
  for (const moth of moths) {
    assertEqual(moth.hp, MOTH_HP, `moth ${moth.id}'s hp as posed`);
  }

  const firing = await fireWeapon(h, "pyre", 1);
  await captureStill(h, "healed");

  for (const moth of moths) {
    assertHit(firing.after, moth, "a moth inside the Pyre slash");
  }
  assertNear(
    player(firing.after).hp,
    POSED_HP + PROBES.length * PYRE_HEAL,
    FLOAT_TOL,
    "hp after the firing tick that hit three moths",
  );
});
