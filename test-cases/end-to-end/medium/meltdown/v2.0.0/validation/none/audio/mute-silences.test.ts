// audio/mute-silences — with sound muted, the events that carry all ten cues carry
// none of them, and the game stays fully playable throughout.
//
// `specs/audio.md`, under Mute: "The build owns the mute bit. It is toggled by the
// `mute` action and by the panel's mute control, from any screen ... While muted,
// none of the ten cues produces any sound. The game stays fully playable muted:
// nothing about the floor, the run, or the screens changes with the mute bit."
// `specs/instrumentation.md` gives the surface NO operation that sets it — "There
// is no operation that sets muting: `mute` is reached the way a player reaches it,
// through its binding in `specs/controls.md` or the panel's mute control, and the
// snapshot reports the result" — and reports `muted` as "the game's copy of the
// runtime's mute bit, refreshed in every update". So mute is reached through
// `KeyM` and read back off the snapshot.
//
// THE PAGE STARTS UNMUTED, WHICH IS THE PRECONDITION THAT MAKES THE READING MEAN
// ANYTHING. A build that opened already muted would be silent here for a reason
// that has nothing to do with the toggle, so the bit is read before the key and
// after it, and the toggle is what turns one into the other. Audio is armed with a
// real gesture first, so the silence is a build that COULD have sounded choosing
// not to.
//
// ALL TEN CUES' EVENTS ARE DRIVEN, because the review item says all ten. Seven
// drives cover them: a menu highlight moving, a tower placed, a tower sold, a shot
// that kills (`fire` and `death` on one frame), an emitter carried over `100` by
// its own gun (`fire` and `trip`), a final wave's unit walking out (`leak`,
// `wave-clear` and `victory` on one frame), and a leak that takes the last life
// (`leak` and `game-over`). Every one of them is reached on the REAL path the
// matching point of this group reaches it on — real keys and a real mouse through
// Chromium's own pipeline, real shots, a real trip, a real send, real leaks —
// because `specs/instrumentation.md` says no operation of the debug surface plays a
// cue, so a posed event would be silent for the wrong reason.
//
// EVERY EVENT IS CONFIRMED TO HAVE HAPPENED, and every stage re-reads the mute bit.
// A muted build that also stopped placing, selling, killing, tripping, clearing or
// losing would be silent for the wrong reason, and `specs/audio.md` requires the
// game to stay "fully playable muted". So the roster, the money, the kill tally,
// the trip flag, the screens and the lives are all read back as the drive goes.
//
// SILENCE IS READ TWO WAYS, AND BOTH HAVE TO HOLD. `watchCues` hears every sound
// attributed to a driven frame; `sounds()` counts every sound the page has emitted
// since it loaded, frames or not, which also catches a build that makes its noise
// straight from a key's or a pointer's event handler rather than from its loop.
//
// WHAT "SILENT" IS TAKEN TO MEAN. A muted cue starts no source and plays no clip at
// all. That is the reading `specs/audio.md`'s "none of the ten cues produces any
// sound" is held to here and the one the review item states; a build that instead
// kept starting its sources at a gain of zero would be inaudible to a listener and
// would still fail this point. See the stage report — the specification should say
// which of the two it means.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  posePinnedTower,
  poseTarget,
  poseTower,
  poseWalker,
  requireTower,
  requireUnit,
  startRun,
  tapAction,
  watchCues,
  type Harness,
} from "../harness";
import {
  MIN_HEAT_MULT,
  SURGE_DEFS,
  TOWER_DEFS,
  footprintCentre,
  isEmitter,
  milestoneWaves,
  modeFigures,
} from "../constants";
import { FREE_SITE } from "../fixtures";
import {
  SHOT_CEILING,
  TRIP_CEILING,
  armFromShop,
  frameWhere,
  leakOut,
  mousePress,
  moveHighlight,
  poseAtExhaustDoor,
  releaseAndLeak,
  sellSelected,
} from "./cues";

/** The run every stage is posed on: the default row `startRun` uses. */
const MODE = "containment" as const;
const DIFFICULTY = "medium" as const;

/** The last wave of that run, which `specs/waves.md` wins on (`specs/modes.md`). */
const FINAL_WAVE = milestoneWaves(modeFigures(MODE, DIFFICULTY).waveCount)[1];

/** The type placed and sold, and what a fresh one refunds (`specs/towers.md`). */
const BUILT = "arc" as const;
const BUILT_SIZE = TOWER_DEFS[BUILT].size;
const BUILT_COST = TOWER_DEFS[BUILT].cost;

/** What one Arc shot removes at heat `0`: `6 * 0.35` (`specs/combat.md`). */
const PER_SHOT_DAMAGE = (() => {
  const def = TOWER_DEFS[BUILT];
  return isEmitter(def) ? def.baseDamage * MIN_HEAT_MULT : 0;
})();

/** The hp the killed target is posed with: inside one shot's worth. */
const KILL_HP = PER_SHOT_DAMAGE / 2;

/** Where a target stands: inside the Arc's and the Stutter's range, off both corridors. */
const TARGET_TILE = { col: 8, row: 5 } as const;

/** The unit walked out in the last stage, and what its escape costs. */
const LEAK_TYPE = "mote" as const;
const LEAK_VENT = "left" as const;
const LEAK_COST = SURGE_DEFS[LEAK_TYPE].leak;

/** Quiet play driven after each event, so a late blip is still caught. */
const SETTLE_FRAMES = framesFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("plays nothing at all through every one of the ten cues' events", async () => {
  // The harness has already reset the game, so this is the title. `reset` leaves
  // the mute bit exactly as it stands (`specs/instrumentation.md`), and a fresh
  // page has never touched it.
  await h.advance(1);
  assertEqual(
    (await h.snapshot()).muted,
    false,
    "the mute bit a fresh page reports before the key is pressed",
  );

  await h.armAudio();
  await tapAction(h, "mute");
  assertEqual(
    (await h.snapshot()).muted,
    true,
    "the mute bit after one press of the key specs/controls.md binds mute to",
  );

  // Watched from here, so nothing before the toggle can be counted against it.
  const played = watchCues(h);
  const totalBefore = await h.sounds();

  /* -- A menu highlight moving, on the title the game opened on -------------- */
  const moved = await moveHighlight(h);
  await h.advance(SETTLE_FRAMES);
  const afterMove = await h.snapshot();

  /* -- A tower placed, by a real press on the reported shop entry ------------ */
  await startRun(h, MODE, DIFFICULTY);
  const armed = await armFromShop(h, BUILT);
  const moneyBefore = armed.snapshot.money;
  const site = footprintCentre(FREE_SITE.col, FREE_SITE.row, BUILT_SIZE);
  const placed = await mousePress(h, site.x, site.y);
  await h.advance(SETTLE_FRAMES);
  const afterPlace = await h.snapshot();

  /* -- The same tower sold, by the key specs/controls.md binds sell to ------- */
  const built = afterPlace.towers[0];
  await h.debug.setSelected(built.id);
  const sold = await sellSelected(h);
  await h.advance(SETTLE_FRAMES);
  const afterSell = await h.snapshot();

  /* -- A shot that takes its target to 0 hp --------------------------------- */
  await startRun(h, MODE, DIFFICULTY);
  const pinned = await posePinnedTower(
    h,
    BUILT,
    FREE_SITE.col,
    FREE_SITE.row,
    0,
  );
  await poseTarget(h, "mote", TARGET_TILE.col, TARGET_TILE.row, KILL_HP);
  const kill = await frameWhere(
    h,
    (snapshot) => snapshot.surge.length === 0,
    SHOT_CEILING,
    "the kill",
  );
  await h.advance(SETTLE_FRAMES);
  const afterKill = await h.snapshot();

  /* -- An emitter carrying its own heat over 100 ---------------------------- */
  await startRun(h, MODE, DIFFICULTY);
  const stutter = await poseTower(h, "stutter", FREE_SITE.col, FREE_SITE.row);
  await poseTarget(h, "mote", TARGET_TILE.col, TARGET_TILE.row);
  const trip = await frameWhere(
    h,
    (snapshot) => requireTower(snapshot, stutter, "the trip").tripped,
    TRIP_CEILING,
    "the trip",
  );
  await h.advance(SETTLE_FRAMES);
  const afterTrip = await h.snapshot();

  /* -- The final wave's unit walking out: a leak, a clear and a win --------- */
  await startRun(h, MODE, DIFFICULTY);
  await h.debug.setWave(FINAL_WAVE);
  const won = await releaseAndLeak(h, 0);
  await h.advance(SETTLE_FRAMES);
  const afterWin = await h.snapshot();

  /* -- A leak that takes the last life ------------------------------------- */
  await startRun(h, MODE, DIFFICULTY);
  await h.debug.setLives(LEAK_COST);
  const walker = await poseWalker(h, LEAK_TYPE, LEAK_VENT);
  const entered = requireUnit(await h.snapshot(), walker, "the walker");
  await poseAtExhaustDoor(h, walker, entered.exhaust);
  const lost = await leakOut(h, "the closing leak");
  await h.advance(SETTLE_FRAMES);
  const afterLoss = await h.snapshot();

  const totalAfter = await h.sounds();
  await captureStill(h, "muted");

  /* -- Every event really happened: the game stayed fully playable muted ---- */
  assertEqual(moved.hit, true, "the movement action to move the highlight");
  assertNotNull(armed.snapshot.build, "the held preview after the shop press");
  assertEqual(
    afterPlace.towers.length,
    1,
    "the towers on the floor after the muted placement",
  );
  assertEqual(
    placed.snapshot.money,
    moneyBefore - BUILT_COST,
    `the money left after a ${BUILT} at ${BUILT_COST} landed muted`,
  );
  assertEqual(sold.hit, true, "the sell key to remove the selected tower");
  assertEqual(
    afterSell.towers.length,
    0,
    "the towers left after the muted sale",
  );
  assertEqual(
    afterSell.money,
    placed.snapshot.money + BUILT_COST,
    "the money the muted sale refunded on a fresh tower",
  );
  assertNull(afterSell.selected, "the selection the muted sale cleared");
  assertEqual(kill.hit, true, "the pinned emitter to take its target to 0 hp");
  assertEqual(
    requireTower(afterKill, pinned, "the muted kill").kills,
    1,
    "the kills the emitter is credited with after the muted kill",
  );
  assertEqual(
    trip.hit,
    true,
    "the firing emitter to carry its own heat over 100 and trip",
  );
  assertEqual(
    requireTower(afterTrip, stutter, "the muted trip").tripped,
    true,
    "the trip flag after the muted crossing",
  );
  assertEqual(won.leak.hit, true, "the final wave's unit to reach its exhaust");
  assertEqual(
    afterWin.screen,
    "victory",
    `the screen a muted clear of wave ${FINAL_WAVE} opens`,
  );
  assertEqual(lost.hit, true, "the last walker to reach its exhaust");
  assertEqual(afterLoss.lives, 0, "the lives left after the closing leak");
  assertEqual(
    afterLoss.screen,
    "gameover",
    "the screen the frame the last life went opens",
  );

  /* -- And the bit held throughout, stage by stage -------------------------- */
  assertEqual(afterMove.muted, true, "the mute bit after the menu move");
  assertEqual(afterPlace.muted, true, "the mute bit after the placement");
  assertEqual(afterSell.muted, true, "the mute bit after the sale");
  assertEqual(afterKill.muted, true, "the mute bit after the kill");
  assertEqual(afterTrip.muted, true, "the mute bit after the trip");
  assertEqual(afterWin.muted, true, "the mute bit after the win");
  assertEqual(afterLoss.muted, true, "the mute bit after the loss");

  /* -- Nothing sounded, on any frame or off one ----------------------------- */
  assertGreaterThan(
    h.frame(),
    0,
    "the frames the muted drive ran, so the silence covers real play",
  );
  assertLength(played, 0, "the sounds emitted on any frame of the muted drive");
  assertEqual(
    totalAfter - totalBefore,
    0,
    "the sounds the page emitted across the muted drive, frames or not",
  );
});
