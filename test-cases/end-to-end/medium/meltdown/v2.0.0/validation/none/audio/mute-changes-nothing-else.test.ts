// audio/mute-changes-nothing-else — with the mute bit set, every event that
// carries a cue still resolves, and the run it resolves into is the run it would
// have been unmuted.
//
// `specs/audio.md`, under Mute: "The game stays fully playable muted: nothing
// about the floor, the run, or the screens changes with the mute bit, so every
// event that would have carried a cue still resolves, and every figure it moves
// still moves." That clause is the BUILD's under every engine — the engine owns
// only what the bus does with a cue, never whether the game goes on playing — so
// this item is asked of all three.
//
// THE DRIVE IS `every-cue.ts`'s, the same one `audio.mute-silences` reads the
// silence over, and it reaches all ten cues' events on the real path each of them
// is reached on: real keys and a real mouse through Chromium's own pipeline, real
// shots, a real trip, a real send, real leaks.
//
// WHAT IS READ IS THE GAME, NOT THE BUS. Every stage is read back off the
// snapshot: the roster after the placement and the sale, the money the placement
// spent and the sale refunded, the selection the sale cleared, the kill tally, the
// trip flag, the screen a cleared final wave opens, and the lives and the screen
// the closing leak leaves. A muted build that also stopped placing, selling,
// killing, tripping, clearing or losing fails here, which is what "fully playable
// muted" asks.
//
// WHY THE UNMUTED SIDE IS NOT DRIVEN HERE. Each of these events has its own item
// in this group — `audio.place-cue`, `audio.trip-cue`, `audio.victory-cue`,
// `audio.game-over-cue` and the rest — and every one of them drives the event
// unmuted and reads the same figures back. So what the unmuted run does is already
// decided, item by item, and what is left for this one is that the bit changed
// none of it.
//
// WHAT IT DOES NOT DECIDE. That the muted drive made no sound is
// `audio.mute-silences`, which only `none` carries: under an engine the silencing
// is the engine's.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  requireTower,
  startRun,
  tapAction,
  type Harness,
} from "../harness";
import {
  BUILT,
  BUILT_COST,
  DIFFICULTY,
  FINAL_WAVE,
  MODE,
  driveEveryCue,
} from "./every-cue";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("resolves every one of the ten cues' events while muted", async () => {
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

  const drive = await driveEveryCue(h);

  await startRun(h, MODE, DIFFICULTY);
  await h.advance(1);
  await captureStill(h, "playable");

  assertEqual(
    drive.moved.hit,
    true,
    "the movement action to move the highlight",
  );
  assertNotNull(drive.armed.build, "the held preview after the shop press");
  assertEqual(
    drive.placed.towers.length,
    1,
    "the towers on the floor after the muted placement",
  );
  assertEqual(
    drive.placed.money,
    drive.moneyBefore - BUILT_COST,
    `the money left after a ${BUILT} at ${BUILT_COST} landed muted`,
  );
  assertEqual(
    drive.sold.hit,
    true,
    "the sell key to remove the selected tower",
  );
  assertEqual(
    drive.sold.snapshot.towers.length,
    0,
    "the towers left after the muted sale",
  );
  assertEqual(
    drive.sold.snapshot.money,
    drive.placed.money + BUILT_COST,
    "the money the muted sale refunded on a fresh tower",
  );
  assertNull(
    drive.sold.snapshot.selected,
    "the selection the muted sale cleared",
  );
  assertEqual(
    drive.kill.hit,
    true,
    "the pinned emitter to take its target to 0 hp",
  );
  assertEqual(
    requireTower(drive.kill.snapshot, drive.gun, "the muted kill").kills,
    1,
    "the kills the emitter is credited with after the muted kill",
  );
  assertEqual(
    drive.trip.hit,
    true,
    "the firing emitter to carry its own heat over 100 and trip",
  );
  assertEqual(
    requireTower(drive.trip.snapshot, drive.tripped, "the muted trip").tripped,
    true,
    "the trip flag after the muted crossing",
  );
  assertEqual(
    drive.won.hit,
    true,
    "the final wave's unit to reach its exhaust",
  );
  assertEqual(
    drive.won.snapshot.screen,
    "victory",
    `the screen a muted clear of wave ${FINAL_WAVE} opens`,
  );
  assertEqual(drive.lost.hit, true, "the last walker to reach its exhaust");
  assertEqual(
    drive.lost.snapshot.lives,
    0,
    "the lives left after the closing leak",
  );
  assertEqual(
    drive.lost.snapshot.screen,
    "gameover",
    "the screen the frame the last life went opens",
  );
});
