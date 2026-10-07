// audio/victory-cue — the clear that WINS the run sounds more than a clear that
// merely advances it.
//
// `specs/audio.md`'s cue table: `victory` answers "The victory screen opens", and
// a cue always names the one real frame that resolved its event.
// `specs/waves.md` fixes that frame: "If the wave cleared was Wave `N`, the run
// ends in victory, and the victory screen opens", and "Victory is reached by
// clearing Wave `N` with at least one life left."
//
// WHY PRESENCE ALONE CANNOT DECIDE THIS POINT. The victory screen can only open on
// a frame that is already a wave clear, and a wave clear can only happen on a
// frame a unit died or leaked — so the winning frame lawfully carries THREE cues.
// A cue's NAME is unobservable from outside an engineless build (`audio/cues`), so
// "the winning frame sounded" is equally true of a build that plays only its leak
// cue.
//
// WHAT DECIDES IT: COUNTING, AGAINST A CLEAR THAT DID NOT WIN. One cue is one
// defined sound played the same way each time (`specs/audio.md`), so a frame
// carrying `leak`, `wave-clear` AND `victory` emits strictly more sound than the
// same frame carrying `leak` and `wave-clear` alone. This point drives both frames
// and holds the winning one strictly above the advancing one. That is an ORDERING,
// not a threshold, and it is also why the comparison board is a wave CLEAR rather
// than a plain leak: the pair then differs by the victory sting and by nothing
// else.
//
// THE TWO BOARDS DIFFER IN ONE VALUE, AND IT IS THE WAVE NUMBER. Both are
// Containment at the same difficulty, both are MILESTONE waves — which
// `specs/waves.md` makes Core waves of exactly one unit — both are begun by the
// run's own `send`, and on both the one Core walks out of the same exhaust with
// nothing left to release. The first is `round(n / 2)`, which `specs/waves.md`
// advances; the second is `n`, which it wins on. A build that opens the victory
// screen on every clear sounds the same on both frames; a build that never opens
// it sounds less on the second.
//
// THE WIN IS A WIN AND NOT A LOSS. `specs/waves.md`: "A leak that takes the lives
// to `0` on the final wave therefore ends the run in loss, not in victory." A
// Containment run opens on `START_LIVES` (`20`) and a Core's escape costs `5`
// (`specs/surge.md`), so the lives that leak leaves are well above `0` and this is
// the victory branch rather than the game-over one. The check reads the lives back
// to prove it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  startRun,
  watchCues,
  type Harness,
} from "../harness";
import { milestoneWaves, modeFigures } from "../constants";
import {
  framesOutside,
  reachFirstInput,
  releaseAndLeak,
  soundsOn,
} from "./cues";

/** The run both boards are posed on: the default row `startRun` uses. */
const MODE = "containment" as const;
const DIFFICULTY = "medium" as const;

/** How many waves that row fixes, and therefore which wave wins (`specs/modes.md`). */
const WAVE_COUNT = modeFigures(MODE, DIFFICULTY).waveCount;

/** The two Core waves of the run (`specs/waves.md`): the middle one, then the last. */
const [ADVANCING_WAVE, FINAL_WAVE] = milestoneWaves(WAVE_COUNT);

/** Nothing left to release, so each board's one unit is the wave's last. */
const PENDING_NONE = 0;

/** Quiet play driven between the two boards, so neither sound reads as the other's. */
const GAP_FRAMES = framesFor(0.4);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("sounds more on the clear that wins the run than on one that advances it", async () => {
  // The build is silent until a player has touched it (specs/audio.md), so
  // the first input is delivered before anything is posed.
  await reachFirstInput(h);
  await startRun(h, MODE, DIFFICULTY);
  await h.armAudio();
  const played = watchCues(h);

  // The advancing clear: the run's middle Core wave, cleared.
  await h.debug.setWave(ADVANCING_WAVE);
  const advancing = await releaseAndLeak(h, PENDING_NONE);
  const advanceFrame = advancing.leak.frame;
  const advanceSounds = soundsOn(played, advanceFrame);

  await h.advance(GAP_FRAMES);

  // The winning clear: the same wave shape, on the last wave of the run.
  await startRun(h, MODE, DIFFICULTY);
  await h.debug.setWave(FINAL_WAVE);
  const winning = await releaseAndLeak(h, PENDING_NONE);
  const winFrame = winning.leak.frame;
  const winSounds = soundsOn(played, winFrame);

  await captureStill(h, "victory");

  // Both boards really released their wave and really lost its unit.
  assertEqual(
    advancing.released.hit,
    true,
    `the send to begin wave ${ADVANCING_WAVE} and release its unit`,
  );
  assertEqual(
    advancing.leak.hit,
    true,
    "the released unit to reach its exhaust",
  );
  assertEqual(
    winning.released.hit,
    true,
    `the send to begin wave ${FINAL_WAVE} and release its unit`,
  );
  assertEqual(
    winning.leak.hit,
    true,
    "the released unit to reach its exhaust on the final wave",
  );

  // And each board ended where `specs/waves.md` sends it.
  assertEqual(
    advancing.leak.snapshot.screen,
    "playing",
    `the screen a clear of wave ${ADVANCING_WAVE} of ${WAVE_COUNT} leaves the run on`,
  );
  assertEqual(
    advancing.leak.snapshot.wave,
    ADVANCING_WAVE + 1,
    "the wave the run advances to",
  );
  assertEqual(
    winning.leak.snapshot.screen,
    "victory",
    `the screen a clear of wave ${FINAL_WAVE}, the last of ${WAVE_COUNT}, opens`,
  );
  assertGreaterThan(
    winning.leak.snapshot.lives,
    0,
    "the lives left when the final wave cleared, which is what makes it a win",
  );

  assertGreaterThan(
    advanceSounds,
    0,
    `sounds emitted on frame ${advanceFrame}, the clear that advanced the run`,
  );
  assertGreaterThan(
    winSounds,
    advanceSounds,
    `the sound on frame ${winFrame}, which carries the victory sting on top ` +
      `of its wave clear (the advancing clear emitted ${advanceSounds})`,
  );
  assertDeepEqual(
    framesOutside(played, [advanceFrame, winFrame]),
    [],
    "the frames of every sound emitted away from the two clears",
  );
});
