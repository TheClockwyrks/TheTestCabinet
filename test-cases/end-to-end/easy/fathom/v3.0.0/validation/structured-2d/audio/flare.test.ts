// audio/flare — the flare cue.
//
// `specs/progression.md` fixes `CUES.flare` (`"flare"`) as the cue played when "a
// Flarefish's bloom begins", and governs all seven with one sentence: "Each is
// played on the tick its event happens, and at most once on that tick." This
// point's own claim adds the near miss: the cue belongs to the BLOOM, not to the
// charge-up that precedes it.
//
// `specs/predators/flarefish.md` puts a `FLARE_CHARGE` (`0.5 s`) charge-up glow
// in front of every `FLARE_BLOOM` (`1 s`) bloom, on a `FLARE_INTERVAL` (`7 s`)
// cadence, and `specs/state.md` reports the two separately as `flareCharging` and
// `flaring`. So the watch marks the tick the charge began and reads the cue
// against the tick the bloom did — and because the whole run of ticks before the
// bloom has to be silent, the charge-up's own tick is inside the window this
// check requires nothing to have sounded on.
//
// THE FLARE IS EARNED, NOT POSED. `specs/instrumentation.md` gives the surface no
// operation that starts a bloom, so the hunter is set wandering and the check
// waits out its cadence. `poseApart` lays down two sealed rooms — the forager's,
// and a ring across solid rock for the hunter to patrol — because a Flarefish
// that finds the forager chases instead, and `flarefish/chase-like-lanternjaw`
// has it neither charge nor bloom while it does.
//
// THE CUE IS READ BY NAME. The game asks the runtime's cue bus for a cue by name
// and the bus announces the play (`specs/progression.md`), so what is asserted
// here is the exact name that file fixes, sounding exactly ONCE on the event's own
// tick — which is the "at most once on that tick" half of the requirement — and
// not at all on the ticks before it.
//
// WHAT THIS DOES NOT DECIDE. The cadence and the charge-then-bloom shape, which
// is `flarefish/flare-cadence`'s; what the bloom reveals, which is
// `flarefish/flare-reveals`'s.

import { afterEach, beforeEach, it } from "vitest";
import { CUES, FLARE_CHARGE, FLARE_INTERVAL } from "../../src/constants";
import { assertEqual, assertNull } from "../assert";
import { poseApart } from "../fixtures";
import {
  captureReplay,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import {
  clearUnderfoot,
  denAll,
  parkForager,
  requireKind,
  sceneGuard,
  sceneHeld,
} from "../scene";
import { cuesBeforeEvent, cuesOnEvent, watchForEvent } from "./cues";

/**
 * How far the hunter's sealed ring sits from the forager's room, in tiles.
 *
 * Eight tiles is `256` logical units, past the `FLARE_RADIUS` (`192`) the bloom
 * lights and past `LANTERN_RANGE_BASE + LANTERN_RANGE_GAIN` (`320`)'s dark end,
 * so the hunter wanders and blooms harmlessly instead of taking a fix.
 */
const APART_TILES = 8;

/**
 * The ceiling on the watch, in frames.
 *
 * `FLARE_INTERVAL` is `7 s` and `FLARE_CHARGE` a further `0.5 s` in front of the
 * bloom, so a wandering Flarefish blooms inside `7.5 s`. Two and a half seconds
 * over that is a hard window: a build whose hunter never blooms fails on the
 * bound rather than leaving the point inconclusive.
 */
const FLARE_TICKS = ticksFor(FLARE_INTERVAL + FLARE_CHARGE + 2.5);

/** Frames run past the reading, purely so the clip shows the bloom burning. */
const TAIL_TICKS = ticksFor(1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.flare on the tick a Flarefish's bloom begins, and not on its charge-up", async () => {
  startPlaying(h);
  const rooms = await poseApart(h, APART_TILES);
  const flarefish = requireKind(h.snapshot(), "flarefish");

  h.debug.setPredatorTile(flarefish, rooms.far.tx, rooms.far.ty);
  h.debug.setPredatorState(flarefish, "wander");
  const quiet = await denAll(h, [flarefish]);
  await parkForager(h, rooms.near);
  await clearUnderfoot(h);
  const watch = await sceneGuard(h, quiet);

  const seen = await captureReplay(h, "flare", async () => {
    const found = await watchForEvent(
      h,
      (s) => s.predators[flarefish]?.flaring === true,
      FLARE_TICKS,
      { mark: (s) => s.predators[flarefish]?.flareCharging === true },
    );
    // Past the reading, so the clip shows the bloom burning. Nothing after this
    // line can reach an assertion.
    await h.advance(TAIL_TICKS);
    return found;
  });

  assertNull(sceneHeld(h.snapshot(), watch), "the scenario held to the end");

  assertEqual(
    seen.hit,
    true,
    `the wandering Flarefish's bloom began inside ${String(FLARE_TICKS)} ticks, ` +
      `which is its FLARE_INTERVAL (${String(FLARE_INTERVAL)} s) cadence and ` +
      `its FLARE_CHARGE (${String(FLARE_CHARGE)} s) charge-up with room to spare`,
  );
  assertEqual(
    cuesBeforeEvent(seen, CUES.flare),
    0,
    `times CUES.flare played over the ${String(seen.at - 1)} ticks before the ` +
      `bloom — which include tick ${String(seen.marked)}, where the charge-up ` +
      "began (specs/progression.md)",
  );
  assertEqual(
    cuesOnEvent(seen, CUES.flare),
    1,
    "times CUES.flare played on the tick the Flarefish's bloom began, which is " +
      "its own tick and at most once on it (specs/progression.md)",
  );
});
