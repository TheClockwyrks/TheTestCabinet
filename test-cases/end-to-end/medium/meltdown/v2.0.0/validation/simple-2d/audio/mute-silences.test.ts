// Meltdown — audio/mute-silences: with the mute bit set, none of the ten cues
// makes a sound.
//
// `specs/audio.md` states both halves of it: "While muted, none of the ten cues
// produces any sound," and "the game stays fully playable muted: nothing about the
// floor, the run, or the screens changes with the mute bit." So the measurement is
// one drive, run twice — once on each side of the bit — over a scenario that
// reaches every one of the ten events.
//
// AND IT STATES THE ROUTE, WHICH IS WHY THE TWO PASSES ARE COMPARED AT ALL. Under
// this engine the engine owns the mute bit, and `specs/audio.md` fixes what the
// game does with it: "The game does not gate its own cues on the bit — the same
// events ask the bus for the same cues muted as unmuted — and the engine plays
// each of them at an amplitude of zero." So the muted pass must raise the same
// cues as the unmuted one, and every one of them must play at no gain.
//
// THE BIT IS SET THE WAY A PLAYER SETS IT. The engine owns muting and the surface
// therefore carries no operation for it: `mute` is reached the way a player
// reaches it, through its binding in `specs/controls.md` or the panel's mute
// control, and the snapshot reports the result (`specs/instrumentation.md`). So
// the bit is toggled with the `mute` binding and read back off the snapshot before
// the drive begins, and the run's own `reset` leaves it alone.
//
// A SILENCED CUE IS A CUE THAT PLAYED AT NO GAIN. The engine announces every play
// whether or not it could be heard and carries the gain it played at, so a muted
// bus is told from an unresponsive build by the announcement still arriving. That
// is why the two passes are compared rather than the muted one read alone: a check
// that only asked "nothing sounded while muted" would pass a build that makes no
// sound at all, and a check that only asked "the gain was zero" would pass a build
// whose cues are silent to begin with. What is asserted is that the SAME events
// sound on both sides, at a gain above zero unmuted and at exactly zero muted.
//
// THE EQUAL NAME SETS ARE THE SECOND HALF OF THE SPEC. A build that stopped
// resolving events while muted — a wave that never clears, a tower that never
// trips — is a build the mute bit changed the run of, and it fails on the
// comparison rather than on the gains.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
} from "../assert";
import { BINDINGS } from "../constants";
import {
  captureStill,
  createHarness,
  posePinnedTower,
  poseTarget,
  startRun,
  watchCues,
  type Harness,
  type TimedCue,
} from "../harness";
import { namesIn } from "./cues";
import { driveEveryCue } from "./spread";

/** The key `specs/controls.md` binds the `mute` action to. */
const MUTE_KEY = BINDINGS.mute[0];

/**
 * Frames run after the mute key before the bit is read back.
 *
 * The snapshot's `muted` is the game's copy of the runtime's mute bit, refreshed
 * in every update rather than read at the call (`specs/instrumentation.md`), so a
 * frame has to run between the press and the reading whichever order the build
 * refreshes its copy in.
 */
const MIRROR_TICKS = 2;

/** Frames of muted play kept for the still, so the picture is a floor running silent. */
const STILL_TICKS = 30;

/** The tile the still's Arc stands on, and the tile its target stands on. */
const STILL_TOWER = { col: 10, row: 10 } as const;
const STILL_TARGET = { col: 13, row: 10 } as const;

/** The heat the still's Arc is pinned at: zero, so the picture cannot become a trip. */
const PINNED_HEAT = 0;

/** An hp pool the Arc cannot empty inside `STILL_TICKS`, so the still shows a fight. */
const DEEP_HP = 1_000_000;

let h: Harness;
let muted: Harness | undefined;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  muted?.dispose();
  muted = undefined;
  h?.dispose();
});

it("plays every cue at no gain while muted, and at gain while not", async () => {
  // The unmuted pass, on the harness this suite opens with: the same drive, on a
  // bus nobody touched.
  const loud: TimedCue[] = watchCues(h);
  await driveEveryCue(h);
  const loudNames = namesIn(loud);

  assertEqual(
    h.snapshot().muted,
    false,
    "posing: the unmuted pass ran on a bus nothing had muted " +
      "(specs/instrumentation.md)",
  );
  assertGreaterThanOrEqual(
    loudNames.length,
    1,
    "distinct cues the drive raised on an unmuted bus — with none, the muted " +
      "reading below would be a reading of nothing (specs/audio.md)",
  );

  // The muted pass, on a harness of its own so the drive opens on a game as
  // freshly loaded as the one above.
  muted = await createHarness();
  const quiet: TimedCue[] = watchCues(muted);

  // The real path: the `mute` binding, which toggles sound from any screen
  // (specs/controls.md, The actions).
  await muted.tap(MUTE_KEY);
  await muted.advance(MIRROR_TICKS);
  assertEqual(
    muted.snapshot().muted,
    true,
    "the mute bit the snapshot reports after the mute key — the game's copy " +
      "of the runtime's bit (specs/instrumentation.md, specs/controls.md)",
  );

  await driveEveryCue(muted);

  assertEqual(
    muted.snapshot().muted,
    true,
    "the mute bit still set at the end of the drive — `reset` leaves muting " +
      "exactly as it stands (specs/instrumentation.md)",
  );
  assertDeepEqual(
    namesIn(quiet),
    loudNames,
    "the cues the same drive raised muted, against the ones it raised unmuted " +
      "— the game stays fully playable muted (specs/audio.md)",
  );

  for (const cue of loud) {
    assertGreaterThan(
      cue.gain,
      0,
      `the gain ${JSON.stringify(cue.cue)} played at on an unmuted bus, on ` +
        `frame ${String(cue.frame)} — a cue that is already silent cannot be ` +
        "silenced (specs/audio.md)",
    );
  }
  for (const cue of quiet) {
    assertEqual(
      cue.gain,
      0,
      `the gain ${JSON.stringify(cue.cue)} played at while muted, on frame ` +
        `${String(cue.frame)} — while muted, none of the ten cues produces ` +
        "any sound (specs/audio.md)",
    );
  }

  // The evidence: a floor running, and firing, with the bus silenced.
  startRun(muted);
  posePinnedTower(muted, "arc", STILL_TOWER.col, STILL_TOWER.row, PINNED_HEAT);
  poseTarget(muted, "mote", STILL_TARGET.col, STILL_TARGET.row, DEEP_HP);
  await muted.advance(STILL_TICKS);
  captureStill(muted, "muted");
});
