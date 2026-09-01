// audio/no-autoplay — a freshly loaded build emits nothing at all until the first
// input reaches it, and it plays correctly through that whole window.
//
// `specs/audio.md`, under Playing them: "Browsers block audio until the page has
// been interacted with, so the game plays nothing at all before the first input
// reaches it, and it starts and runs correctly whether or not audio can start."
//
// THIS IS THE ONE POINT IN THE GROUP THAT NEVER ARMS AUDIO. Every other point
// calls `h.armAudio()`, a press of a key `specs/controls.md` binds to nothing, so
// that a build which opens its audio context only from a genuine DOM gesture is
// heard at all. Here that gesture is exactly what must not happen: nothing in this
// drive presses a key or moves a mouse, and the page has seen no gesture since it
// loaded. `h.sounds()` counts every sound the page has emitted since load, so the
// window it reads is the whole life of the page and not merely the part this check
// drove.
//
// WHAT "EMITS NOTHING" IS TAKEN TO MEAN, AND THE SPECIFICATION SAYS IT.
// `audio-init.js` wraps the two doors a browser can make a sound through — a Web
// Audio source node being `start()`ed, whatever kind, and an `<audio>` element
// being played — and counts what goes through them. `specs/audio.md` fixes that
// reading for this engine: "until then it starts no audio source and plays no clip,
// whatever a source would have sounded like." So a build that created a suspended
// context up front and started sources into it has started a source before the
// first input, and fails here as the specification says it should; a build that
// waits for a gesture to create its context at all passes.
//
// EVENTS THAT WOULD SOUND ARE DRIVEN INSIDE THE SILENT WINDOW, which is what makes
// the silence mean something. A build that never reaches the events cannot be told
// from one that gates its audio properly, so this drive makes the game raise three
// of the ten cues' events — a shot resolving, a unit dying, a unit leaking — every
// one of them through the game's own systems, posed with debug operations alone
// because `specs/instrumentation.md` makes every one of those a call rather than an
// interaction: they pose and read state, they are not input, and no browser treats
// them as a gesture. Each event is read back off the snapshot, so a build that
// stayed silent by not playing at all fails here too.
//
// THE BUILD IS ALSO GIVEN ITS OWN CLOCK FOR A REAL WINDOW, before anything is
// posed. `specs/audio.md` requires the game to "start[] and run[] correctly whether
// or not audio can start", so the loop is handed back and left to run itself on the
// title for `OWN_CLOCK_MS` of real time. A build with an attract-mode jingle, or one
// that starts its sources on load and hopes, is caught there rather than on a
// posed frame. The other half of that sentence — that the game RUNS correctly with
// no audio — is read as the game staying on the screen it opened on across the
// real-time window and then reaching every one of the three events, all with no
// context to play through.
//
// WHAT THIS POINT DOES NOT DECIDE: whether the build makes any sound after the
// gesture. That is what the other eleven points of this group are for, and holding
// it here as well would fail this item for a defect belonging to one of them.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  posePinnedTower,
  poseTarget,
  poseWalker,
  requireTower,
  requireUnit,
  startRun,
  watchCues,
  type Harness,
} from "../harness";
import { MIN_HEAT_MULT, SURGE_DEFS, TOWER_DEFS, isEmitter } from "../constants";
import { FREE_SITE } from "../fixtures";
import { SHOT_CEILING, frameWhere, leakOut, poseAtExhaustDoor } from "./cues";

/**
 * Real time the build is left to drive its own frame loop on the title, in
 * milliseconds.
 *
 * Not a tolerance: nothing is measured over it. It is how long a build that makes
 * noise on its own has to do it in, at whatever rate its own loop runs.
 */
const OWN_CLOCK_MS = 700;

/** The heat the emitter is pinned at, where `specs/heat.md` fixes its multiplier. */
const PINNED_HEAT = 0;

/** What one Arc shot removes at that heat: `6 * 0.35` (`specs/combat.md`). */
const PER_SHOT_DAMAGE = (() => {
  const def = TOWER_DEFS.arc;
  return isEmitter(def) ? def.baseDamage * MIN_HEAT_MULT : 0;
})();

/** The hp the target is posed with: inside one shot's worth, so one shot kills. */
const POSED_HP = PER_SHOT_DAMAGE / 2;

/** Where the target stands: inside the Arc's `6.0`-tile range, off both corridors. */
const TARGET_TILE = { col: 8, row: 5 } as const;

/** The unit walked out, and what its escape costs (`specs/surge.md`). */
const LEAK_TYPE = "mote" as const;
const LEAK_VENT = "left" as const;
const LEAK_COST = SURGE_DEFS[LEAK_TYPE].leak;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("emits nothing at all while the page has seen no interaction", async () => {
  // Watched from the very first frame, and NOT armed: whatever the drive hears is
  // heard before any gesture reached the page.
  const played = watchCues(h);

  await h.advance(1);
  const title = await h.snapshot();

  // The build driving its own loop in real time, on the screen it opened on.
  await h.settle(OWN_CLOCK_MS);
  const afterOwnClock = await h.snapshot();
  const soundsOnTitle = await h.sounds();
  await captureStill(h, "silent");

  // A shot that resolves and a kill it deals, on an isolated floor.
  await startRun(h);
  const emitter = await posePinnedTower(
    h,
    "arc",
    FREE_SITE.col,
    FREE_SITE.row,
    PINNED_HEAT,
  );
  await poseTarget(h, "mote", TARGET_TILE.col, TARGET_TILE.row, POSED_HP);
  const kill = await frameWhere(
    h,
    (snapshot) => snapshot.surge.length === 0,
    SHOT_CEILING,
    "the kill",
  );

  // And a leak, walked out under the unit's own power.
  const livesBefore = kill.snapshot.lives;
  const walker = await poseWalker(h, LEAK_TYPE, LEAK_VENT);
  const entered = requireUnit(await h.snapshot(), walker, "the walker");
  await poseAtExhaustDoor(h, walker, entered.exhaust);
  const leak = await leakOut(h, "the leak");

  const soundsTotal = await h.sounds();

  // The build was alive and correct through the whole window.
  assertEqual(title.screen, "title", "the screen the game opens on");
  assertEqual(
    afterOwnClock.screen,
    "title",
    "the screen the build's own loop left it on",
  );
  // And each of the three events really happened.
  assertEqual(kill.hit, true, "the pinned emitter to take the target to 0 hp");
  assertEqual(
    requireTower(kill.snapshot, emitter, "the kill").kills,
    1,
    "the kills the emitter is credited with, so a shot and a death resolved",
  );
  assertGreaterThan(
    requireTower(kill.snapshot, emitter, "the kill").damageDealt,
    0,
    "the hp the emitter's shot removed",
  );
  assertEqual(leak.hit, true, "the walker to reach its exhaust and leave");
  assertEqual(
    leak.snapshot.lives,
    livesBefore - LEAK_COST,
    `the lives left once a ${LEAK_TYPE} escaped, from ${livesBefore}`,
  );

  // Nothing sounded, on the title or on any frame of the drive.
  assertEqual(
    soundsOnTitle,
    0,
    "the sounds the page emitted while the build ran itself on the title",
  );
  assertEqual(
    soundsTotal,
    0,
    "the sounds the page emitted since it loaded, across every event driven " +
      "before any input reached the build",
  );
  assertLength(
    played,
    0,
    "the sounds attributed to any frame of the un-armed drive",
  );
});
