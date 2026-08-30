// Arc Foundry — audio/playable-muted: muting changes the sound and nothing else.
//
// THE REQUIREMENT, from `specs/ui.md`: "the game binds the mute action to that
// layer's mute bit, toggles it from any screen, and stays fully playable with sound
// muted."
//
// WHAT "FULLY PLAYABLE" IS READ AS. That the same run, driven the same way from the
// same seed, reaches the same state muted as unmuted. `specs/instrumentation.md`
// makes that comparable: the simulation is deterministic — "Given the same seed and
// the same sequence of calls and elapsed simulation time, the game reaches the same
// state every time" — and the snapshot reports every field an operation can set. So
// two runs that differ only in the mute bit must produce two snapshots that differ
// only in the mute bit, and a build whose audio layer is load-bearing — a cue whose
// completion advances something, a sound that throws when the bus is off — produces
// two that differ elsewhere.
//
// TWO PAGES, NOT ONE. The mute bit is a player preference the runtime holds, and
// `specs/instrumentation.md` deliberately leaves it untouched by `reset`, so a
// muted run and an unmuted one cannot share a page. Each harness opens the build
// fresh, which is also where the preference rests off.
//
// THE DRIVE IS ORDINARY PLAY, on purpose: a structure firing, two units taking
// damage, statuses running down and the economy paying out over two seconds of
// simulation, so the comparison covers the systems a cue is played from rather than
// an idle yard.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertDeepEqual } from "../assert";
import { structureCenter } from "../constants";
import {
  captureReplay,
  createHarness,
  openYard,
  parkUnit,
  pressAction,
  standComponent,
  type Harness,
  type FoundrySnapshot,
} from "../harness";

/** Clear ground, well away from the map's waypoint platforms and its chain. */
const ANCHOR = { col: 21, row: 17 };
const HEAD = structureCenter(ANCHOR.col, ANCHOR.row);

/** One seed for both runs, so every random draw the game makes matches. */
const SEED = 7;

let unmuted: Harness;
let muted: Harness;

beforeEach(async () => {
  unmuted = await createHarness();
  muted = await createHarness();
});

afterEach(async () => {
  await unmuted.dispose();
  await muted.dispose();
});

/** Everything the snapshot reports except the mute bit itself. */
function apartFromMuting(snapshot: FoundrySnapshot): unknown {
  const { muted: _muted, ...rest } = snapshot;
  return rest;
}

/** The same two seconds of play, on one harness. */
async function play(h: Harness): Promise<FoundrySnapshot> {
  await standComponent(h, "choke", 2, ANCHOR.col, ANCHOR.row);
  await parkUnit(h, "slug", { x: HEAD.x + 80, y: HEAD.y });
  await parkUnit(h, "mote", { x: HEAD.x + 60, y: HEAD.y + 40 });
  await h.advanceSeconds(2);
  return h.snapshot();
}

it("reaches the same state muted as unmuted", async () => {
  await openYard(unmuted, { seed: SEED, wave: 3, charge: 500 });
  await openYard(muted, { seed: SEED, wave: 3, charge: 500 });

  await pressAction(muted, "mute");
  assertEqual(
    (await muted.snapshot()).muted,
    true,
    "the mute action to engage the mute bit the snapshot reports " +
      "(specs/ui.md, specs/instrumentation.md)",
  );
  assertEqual(
    (await unmuted.snapshot()).muted,
    false,
    "a freshly opened build to be unmuted (specs/instrumentation.md)",
  );

  const loud = await play(unmuted);
  const quiet = await captureReplay(muted, "muted", () => play(muted));

  assertDeepEqual(
    apartFromMuting(quiet),
    apartFromMuting(loud),
    "the same drive from the same seed to reach the same state with sound " +
      "muted as without it, so nothing about the game depends on the audio " +
      "being audible (specs/ui.md)",
  );
});
