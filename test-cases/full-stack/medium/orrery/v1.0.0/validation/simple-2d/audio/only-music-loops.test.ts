// audio/only-music-loops — `music` is the only cue that loops; the other six
// sound once per event.
//
// THE RULE. "`LOOPING_CUES` holds the one cue that loops until stopped rather
// than playing once" and "The first six are one-shot cues", each "a distinct short
// sound, played on the frame its event happens, from `update`, and at most once on
// that frame, however many of the event fired within it" (`specs/ui.md`, Audio).
// So `place`, `erase`, `start`, `halt`, `constellation` and `complete` are started
// as one-shots and `music` alone is started looping.
//
// THE DRIVE RAISES ALL SIX, because a check that raised five would leave the sixth
// free to loop. In one editor, on one challenge, in this order: a pointer drag
// that moves a placed part (`place`), `part-delete` on the selection (`erase`),
// `play` on a machine with every rise and every set placed (`start`), a fresh run
// on a piston at `ARM_MAX_LEN` told to `extend` (`halt`, the `overextended` fault
// of `specs/simulation.md`), and last a run whose set consumes a `sol` at a
// boundary that reaches the challenge's target of `1` (`constellation` and
// `complete` together).
//
// EACH EVENT IS FENCED, and the fence is what each of the two readings is taken
// over. The sounds emitted across it must move, so a build that is silent on one
// of the six is caught rather than passing this point for want of a cue to loop;
// and the count of LOOPS STARTED across it must not, which is what a build that
// started one of the six looping breaks.
//
// WHY THE LOOP COUNT IS READ PER FENCE RATHER THAN OVER THE WHOLE DRIVE. The BED
// is a looping cue and may legitimately be started more than once over a long
// drive — a build that stopped and restarted it would be breaking
// `bed-loops-across-a-screen-change`, not this point, and reading one figure
// across everything would report that build's fault here. A fence holds one
// event, so what it measures is whether THAT event's cue looped. The completion
// is driven last for the same reason: nothing follows it that could restart a bed
// it stopped.
//
// AND UNDER EITHER ENGINE, WHERE THE CUE BUS ANNOUNCES A CUE BY NAME, the reading
// is exact: no cue but `music` is ever announced as looped. Under no engine there
// is no bus and no name, and the per-fence counts above are the whole of it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { ARM_MAX_LEN, CUES } from "../constants";
import { at, hexCenter } from "../field";
import { armPart, setPart, solution } from "../formats";
import { IDLE_MACHINE, ONE_DELIVERY, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  drag,
  loadMachine,
  openChallengeDocument,
  openTitle,
  partIds,
  playAction,
  pressAction,
  spawnMote,
  stopRun,
  watchCues,
  type Harness,
} from "../harness";
import { openSilence } from "./silence";

/** Frames run after an event, so the cue of that event is inside its fence. */
const AFTER = 3;

/** Where the placed arm is dragged to, which is the edit `place` is the cue of. */
const MOVED_TO = at(1, -1);

/** The machine the halt is raised on: one piston at its maximum, told to extend. */
const OVEREXTENDING = solution([
  armPart("piston", ORIGIN.q, ORIGIN.r, 0, ARM_MAX_LEN, ["extend"]),
]);

/** The machine the delivery is made on: one set for the challenge's only product. */
const ONE_SET = solution([setPart(0, ORIGIN.q, ORIGIN.r)]);

/** What one fenced event reported. */
interface Fence {
  /** Sounds the build emitted across it. */
  sounds: number;
  /** Loops it started. */
  loops: number;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("starts no cue but music looping, over a drive that raises all six one-shots", async () => {
  // The watch opens before the first frame, so the bed's own loop is inside it.
  const played = watchCues(h);
  await openTitle(h);
  await openSilence(h);

  await openChallengeDocument(h, ONE_DELIVERY);
  await loadMachine(h, IDLE_MACHINE);
  const parts = await partIds(h);
  const arm = parts[2] ?? -1;
  await h.advance(1);

  const drive = await captureReplay(h, "one-shots", async () => {
    const fences: Record<string, Fence> = {};
    const fence = async (
      name: string,
      event: () => Promise<void>,
    ): Promise<void> => {
      const sounds = await h.sounds();
      const loops = await h.loopStarts();
      await event();
      await h.advance(AFTER);
      fences[name] = {
        sounds: (await h.sounds()) - sounds,
        loops: (await h.loopStarts()) - loops,
      };
    };

    await fence("place", async () => {
      await drag(h, hexCenter(ORIGIN), hexCenter(MOVED_TO));
    });
    await fence("erase", async () => {
      await h.debug.setSelected(arm);
      await h.debug.setFocus("field");
      await pressAction(h, "part-delete");
    });
    await fence("start", async () => {
      await playAction(h);
    });
    const started = (await h.snapshot()).sim?.status;
    await fence("halt", async () => {
      await stopRun(h);
      await loadMachine(h, OVEREXTENDING);
      await h.debug.startRun();
      await advanceCycles(h, 1);
    });
    const halted = (await h.snapshot()).sim?.fault?.kind;
    await fence("delivery", async () => {
      await stopRun(h);
      await loadMachine(h, ONE_SET);
      await h.debug.startRun();
      await h.debug.setTally(0, 0);
      await h.debug.clearMotes();
      await spawnMote(h, ORIGIN, "sol");
      await advanceCycles(h, 1);
    });
    const delivered = (await h.snapshot()).sim?.status;
    return { fences, started, halted, delivered };
  });

  // The drive really did raise the six events.
  assertEqual(
    drive.started,
    "running",
    "play started the run, which is the event CUES.start is the cue of",
  );
  assertEqual(
    drive.halted,
    "overextended",
    "the second run faulted, which is the event CUES.halt is the cue of",
  );
  assertEqual(
    drive.delivered,
    "complete",
    "the last boundary consumed the sol and reached the challenge's target of 1, so both the constellation and the complete events fired",
  );
  assertDeepEqual(
    Object.entries(drive.fences)
      .filter(([, fence]) => fence.sounds === 0)
      .map(([name]) => name),
    [],
    "each of the six events sounded something, so the drive is a drive over six cues rather than over silence",
  );

  // And not one of them was started looping.
  assertDeepEqual(
    Object.entries(drive.fences)
      .filter(([, fence]) => fence.loops !== 0)
      .map(([name]) => name),
    [],
    "no cue was started looping on the frames the six one-shot events sounded on: LOOPING_CUES holds music alone",
  );
  assertDeepEqual(
    [
      ...new Set(
        played
          .filter((entry) => entry.looping && entry.cue !== CUES.music)
          .map((entry) => entry.cue),
      ),
    ],
    [],
    "and no cue but music was ever announced as looped",
  );
});
