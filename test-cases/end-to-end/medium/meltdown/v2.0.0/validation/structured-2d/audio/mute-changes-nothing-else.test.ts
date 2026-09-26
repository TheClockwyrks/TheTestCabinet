// Meltdown — audio/mute-changes-nothing-else: with the mute bit set, the same
// drive resolves the same events it resolves unmuted.
//
// THE RULE. specs/audio.md: "The game stays fully playable muted: nothing about
// the floor, the run, or the screens changes with the mute bit, so every event
// that carries a cue still resolves." That clause is the BUILD's under every
// engine — the engine owns only what the bus does with a cue, never whether the
// game goes on playing — so this point is asked of all three.
//
// HOW IT IS READ UNDER THIS ENGINE. specs/audio.md puts the silencing on the
// engine here — "the engine plays each of them at an amplitude of zero" — and the
// engine announces every play whether or not it could be heard. So the set of
// cues the drive raised is exactly the set of events it resolved, and the reading
// is that the muted pass raised the SAME cues, in the same order, as the unmuted
// one. A build that stopped resolving events while muted — a wave that never
// clears, a tower that never trips — raises fewer and fails here.
//
// THE UNMUTED PASS IS THE PRECONDITION. A check that only compared the two sets
// would pass a build that raises nothing on either side, so every cue the unmuted
// pass raised is required to have played at a gain above zero: a cue that is
// already silent cannot tell this point anything.
//
// WHAT IS NOT ASSERTED, AND WHY. The gain the MUTED pass played at. specs/audio.md
// gives the mute bit and the silencing to the engine under this engine, so every
// build on it plays a muted cue at exactly the amplitude the engine chose, and a
// check on that figure would grade the engine. The silence is
// `audio.mute-silences`, which only `none` carries, where the build owns the bit
// and plays no muted cue at all.
//
// THE BIT IS SET THE WAY A PLAYER SETS IT. The engine owns muting and the surface
// therefore carries no operation for it: `mute` is reached the way a player
// reaches it, through its binding in specs/controls.md or the panel's mute
// control, and the snapshot reports the result (specs/instrumentation.md). So the
// bit is toggled with the `mute` binding and read back off the snapshot before the
// drive begins, and the run's own `reset` leaves it alone.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
} from "../assert";
import {
  captureStill,
  createHarness,
  poseTarget,
  posePinnedTower,
  startRun,
  tapAction,
  watchCues,
  type Harness,
  type TimedCue,
} from "../harness";
import { namesIn } from "./cues";
import { driveEveryCue } from "./spread";

/**
 * Frames run after the mute key before the bit is read back.
 *
 * The snapshot's `muted` is "the game's copy of the runtime's mute bit, refreshed
 * in every update ... It is not read at the call" (`specs/instrumentation.md`),
 * so a frame has to run between the press and the reading whichever order the
 * build refreshes its copy in.
 */
const MIRROR_TICKS = 2;

/** Frames of muted play kept for the still, so the picture is a floor running silent. */
const STILL_TICKS = 30;

/** The tile the still's Arc stands on, and the tile its target stands on. */
const STILL_TOWER = { col: 10, row: 10 } as const;
const STILL_TARGET = { col: 13, row: 10 } as const;

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

it("raises the same cues muted as it raises unmuted", async () => {
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

  // The real path: the `mute` action, bound to `KeyM` (specs/controls.md), which
  // "toggles sound, from any screen" (specs/controls.md, The actions).
  await tapAction(muted, "mute");
  await muted.advance(MIRROR_TICKS);
  assertEqual(
    muted.snapshot().muted,
    true,
    "the mute bit the snapshot reports after the mute key — the game's copy of " +
      "the runtime's bit (specs/instrumentation.md, specs/controls.md)",
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
  // The evidence: a floor running, and firing, with the bus muted.
  startRun(muted);
  posePinnedTower(muted, "arc", STILL_TOWER.col, STILL_TOWER.row, 0);
  poseTarget(muted, "mote", STILL_TARGET.col, STILL_TARGET.row, DEEP_HP);
  await muted.advance(STILL_TICKS);
  captureStill(muted, "playable");
});
