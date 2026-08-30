// audio/death-cue — the shot that takes a unit to `0` hp sounds MORE than the
// shot before it, which took the same target down and left it standing.
//
// `specs/audio.md`'s cue table: `death` answers "A surge unit's hp reaches `0`",
// and every cue is "raised by the frame that resolves the event it answers".
// `specs/combat.md` fixes that frame: "A unit's hp never falls below `0`, and a
// unit at `0` hp is removed on that frame."
//
// WHY PRESENCE ALONE CANNOT DECIDE THIS POINT. The blow that kills is a shot, so
// the killing frame lawfully carries TWO cues — `fire` for the shot and `death`
// for the kill. A cue's NAME is unobservable from outside an engineless build
// (`audio/cues`), so "the killing frame sounded" is equally true of a build that
// plays its fire cue and no death cue at all.
//
// WHAT DECIDES IT: COUNTING. `specs/audio.md` gives the build ten cues, "[e]ach
// cue ... short and distinct from the other nine", one per event, so a cue is one
// defined sound that emits the same way every time it plays. A frame that plays
// `fire` AND `death` therefore emits strictly more sound than a frame that plays
// `fire` alone. This point drives both frames — the shot that wounds, then the
// shot that kills — and holds the killing frame's emission strictly above the
// wounding one's. That is an ORDERING, not a threshold: no number of sources per
// cue is assumed, and a build whose every cue is a chord passes it exactly as one
// whose cues are single tones does.
//
// THE TWO FRAMES DIFFER IN ONE THING ONLY, AND IT IS THE TARGET'S REMAINING HP.
// Same emitter, same heat, same target, same rate, one drive: the target is posed
// with hp the FIRST shot cannot remove and the SECOND can. `specs/towers.md` gives
// the Arc `6` base damage, `specs/heat.md` gives `heatMultiplier(0, 80)` the value
// `MIN_HEAT_MULT` (`0.35`), and `specs/combat.md` has one shot remove
// `baseDamage * heatMultiplier` — so each shot removes `2.1` hp, and `POSED_HP`
// below sits between one shot's worth and two. Every wrong model reads as a
// different number here: a build that removes nothing never kills, one that
// removes the whole bar kills on the first shot and never produces a plain
// frame, and one that kills at some other multiplier kills on a different shot.
//
// THE EMITTER'S HEAT IS PINNED so the damage cannot drift between the two shots
// and the emitter cannot trip and bring a third cue with it
// (`specs/instrumentation.md`). THE TARGET'S MOTION IS OFF, so it cannot walk out
// of range between them and cannot reach an exhaust.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  posePinnedTower,
  poseTarget,
  requireTower,
  startRun,
  watchCues,
  type Harness,
} from "../harness";
import { MIN_HEAT_MULT, TOWER_DEFS, isEmitter } from "../constants";
import { FREE_SITE } from "../fixtures";
import { SHOT_CEILING, framesOutside, frameWhere, soundsOn } from "./cues";

/** The heat the emitter is pinned at, where `specs/heat.md` fixes its multiplier. */
const PINNED_HEAT = 0;

/** What one Arc shot removes at that heat: `6 * 0.35` (`specs/combat.md`). */
const PER_SHOT_DAMAGE = (() => {
  const def = TOWER_DEFS.arc;
  return isEmitter(def) ? def.baseDamage * MIN_HEAT_MULT : 0;
})();

/**
 * The hp the target is posed with: past one shot's worth and inside two.
 *
 * The distinguishing value. It is the midpoint of the band `specs/combat.md`
 * leaves, so a build whose per-shot damage is out by a fifth either way still
 * kills on the second shot and this point still reads the cue rather than the
 * arithmetic — and a build that kills on the first shot or never kills fails
 * because its drive never produced the pair.
 */
const POSED_HP = PER_SHOT_DAMAGE * 1.5;

/**
 * Where the target stands: three and a half tiles from the emitter's footprint
 * centre, well inside the Arc's `6.0`-tile range, and clear of both corridors.
 */
const TARGET_TILE = { col: 8, row: 5 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("sounds more on the killing shot than on the shot that only wounded", async () => {
  await startRun(h);
  const emitter = await posePinnedTower(
    h,
    "arc",
    FREE_SITE.col,
    FREE_SITE.row,
    PINNED_HEAT,
  );
  const target = await poseTarget(
    h,
    "mote",
    TARGET_TILE.col,
    TARGET_TILE.row,
    POSED_HP,
  );
  await h.armAudio();

  // Watched after the floor is posed, so what is read is the two shots alone.
  const played = watchCues(h);

  // The wounding shot: hp comes off and the unit stands.
  const wound = await frameWhere(
    h,
    (snapshot) =>
      requireTower(snapshot, emitter, "the first shot").damageDealt > 0,
    SHOT_CEILING,
    "the wounding shot",
  );
  const woundFrame = wound.frame;
  const woundSounds = soundsOn(played, woundFrame);

  // The killing shot: the same emitter, the same target, one interval later.
  const kill = await frameWhere(
    h,
    (snapshot) => snapshot.surge.length === 0,
    SHOT_CEILING,
    "the killing shot",
  );
  const killFrame = kill.frame;
  const killSounds = soundsOn(played, killFrame);

  await captureStill(h, "death");

  assertEqual(wound.hit, true, "the emitter to land a shot on the target");
  assertEqual(
    wound.snapshot.surge.length,
    1,
    `the units still standing after one shot removed ${PER_SHOT_DAMAGE} of the target's ${POSED_HP} hp`,
  );
  assertGreaterThan(
    requireTower(wound.snapshot, emitter, "the wounding shot").damageDealt,
    0,
    "the hp the wounding shot removed",
  );
  assertEqual(kill.hit, true, "the next shot to take the target to 0 hp");
  assertEqual(
    requireTower(kill.snapshot, emitter, "the kill").kills,
    1,
    "the kills the emitter is credited with once the target is gone",
  );
  assertEqual(
    kill.snapshot.surge.some((unit) => unit.id === target),
    false,
    "the target to be off the floor on the frame its hp reached 0",
  );

  assertGreaterThan(
    woundSounds,
    0,
    `sounds emitted on frame ${woundFrame}, the shot that only wounded`,
  );
  assertGreaterThan(
    killSounds,
    woundSounds,
    `the sound on frame ${killFrame}, which carries the death cue on top of ` +
      `its shot (the wounding shot emitted ${woundSounds})`,
  );
  assertDeepEqual(
    framesOutside(played, [woundFrame, killFrame]),
    [],
    "the frames of every sound emitted away from the two shots",
  );
});
