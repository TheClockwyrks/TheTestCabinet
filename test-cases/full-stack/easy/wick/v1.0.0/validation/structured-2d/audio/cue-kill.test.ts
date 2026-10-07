// Wick — audio/cue-kill: the tick an enemy dies plays `kill`.
//
// WHERE THE THRESHOLD COMES FROM. `specs/ui.md`, Audio: the cue table binds
// `kill` to "An enemy dies. At most once per tick", and "Each is played on
// the tick its event happens ... and at most once on that tick".
// `specs/enemies.md`, The life of an enemy: "On any tick that leaves `hp` at
// or below `0` the enemy dies on that tick: it is removed, the kill count
// rises by one, its drop appears at its center, and the `kill` cue plays".
// One death on one tick is therefore exactly one `kill`.
//
// WHY THE WORLD IS POSED AS IT IS. One moth and one Ember bolt on the moth's
// own center, in an isolated run with every driver switch off, so no spawn,
// event, despawn, enemy move, contact hit, weapon firing, or effect motion
// arrives on top of the death. `specs/enemies.md`'s roster gives the moth `5`
// HP and `specs/weapons.md` gives an Ember bolt `10` damage, so the one hit
// the bolt lands takes it below `0` and the tick is a death.
//
// The moth stands `POST` (300) units out rather than on the lamplighter, so
// the gem and any bread its death drops land there: both are far outside
// `PICKUP_RADIUS` (`48`) and the pickup collection distance
// (`specs/world.md`), so neither is collected on this tick and neither raises
// a cue of its own. `specs/instrumentation.md` puts the bolt's first hit on
// the tick after it is posed, so exactly one tick is driven.
//
// THE TOLERANCE. None: the specification fixes the cue to the tick of the
// death and to at most one play on it, and the collector reads whole frames.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertUndefined } from "../assert";
import { CUES } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  enemyById,
  placeEnemyNear,
  placeProjectile,
  type Harness,
} from "../harness";
import { cuesOf, heard, isolatedRun } from "./cues";

/** How far out the moth stands, clear of every pickup and gem radius. */
const POST = { x: 300, y: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays kill once on the tick an enemy dies", async () => {
  await isolatedRun(h);
  const moth = placeEnemyNear(h, "moth", POST.x, POST.y);
  const before = h.snapshot();
  placeProjectile(h, "ember", POST.x, POST.y, 0, 0, 0);

  const { result: after, played } = await captureReplay(h, "kill", () =>
    cuesOf(h, () => advanceTicks(h, 1)),
  );

  // The premise: this tick really was the tick the moth died on.
  assertUndefined(
    enemyById(after, moth),
    "the moth after the bolt took its hp below zero",
  );
  assertEqual(
    after.run.kills - before.run.kills,
    1,
    "the kill count the death raised (specs/enemies.md, The life of an enemy)",
  );

  assertEqual(
    heard(played, CUES.kill),
    1,
    "kill cues on the tick an enemy died (specs/ui.md, Audio)",
  );
});
