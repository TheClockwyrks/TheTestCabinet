// audio/muted-holds-across-frames-and-screens — the mute bit is a bit, and
// nothing but the mute action moves it.
//
// THE RULE. `specs/ui.md`, Audio: the game "binds the `mute` action to the
// runtime's mute bit and toggles it from any screen, then mirrors that bit into
// `state.muted` every frame" — the engine wordings bind `api.audio.setMuted` and
// `world.audio.setMuted` and mirror `muted()` the same way, so all three say the
// bit belongs to the layer below and the game holds a MIRROR of it. The mirror is
// refreshed on every frame there is: `specs/instrumentation.md`, Snapshot shape,
// counts `muted` among the three fields that "need the game to keep them honest
// every frame", and "The shape is fixed, and every field is present whatever the
// screen and mode."
//
// SO ONLY THE ACTION MOVES IT. `specs/controls.md` binds one thing to it —
// "`mute` | `KeyM` | Toggles sound, from any screen" — and lists `mute` among the
// actions every one of `title`, `howto`, `select` and `editor` reads. The surface
// carries no operation for muting at all, and says so where it would have been:
// of `reset`, "`muted` is untouched; the runtime owns muting"
// (`specs/instrumentation.md`, Session). Nothing else in `specs/` writes the bit,
// so a screen change does not, and neither does a frame.
//
// THE CONFIGURATION. A reset session, the bit posed ON with one press of the
// bound key on `title`, and then a tour: `title`, `howto`, `select`, `editor`,
// three frames run one at a time on each. The bit is read at every stop and after
// every one of those frames, so a build that cleared it on a screen change and a
// build that let it decay a frame later are each caught where they went wrong.
//
// THE BIT STARTS OFF, SO ONE PRESS POSES IT. "Sound is on when the game starts:
// the mute bit is off on the first frame, so `state.muted` reports `false` until
// the `mute` action is first pressed, and that first press mutes"
// (`specs/ui.md`, Audio). The opening value is read before the press, so the ON
// the tour holds is the work of exactly one press rather than of whatever the
// session happened to open at.
//
// AND THE CLAIM IS BOUNDED. "Until the mute action is pressed again" is the other
// half of it: the tour ends with a second press, which must put the bit back.
// Without that reading a build that reported `true` for ever would pass a check
// that only ever looked for `true`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BARE } from "../fixtures";
import {
  captureReplay,
  createHarness,
  openChallengeDocument,
  openHowto,
  openSelect,
  openTitle,
  pressAction,
  type Harness,
} from "../harness";

/** How many frames each stop of the tour is held for, run one at a time. */
const FRAMES_PER_SCREEN = 3;

/** One reading of the mirrored bit, and where on the tour it was taken. */
interface Reading {
  readonly where: string;
  readonly muted: boolean;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The bit as the snapshot mirrors it. */
async function mirrored(): Promise<boolean> {
  return (await h.snapshot()).muted;
}

/**
 * Enter each screen in turn and read the mirrored bit on entry and after each of
 * `FRAMES_PER_SCREEN` further frames.
 *
 * The stops are entered through the surface, which touches muting nowhere, and
 * `title` is the screen the bit was posed on, so it is read where it stands
 * rather than re-entered.
 */
async function tour(): Promise<Reading[]> {
  const readings: Reading[] = [];

  /** Read the bit on the screen just entered, and after each further frame. */
  async function hold(where: string): Promise<void> {
    readings.push({ where: `on ${where}`, muted: await mirrored() });
    for (let frame = 1; frame <= FRAMES_PER_SCREEN; frame += 1) {
      await h.advance(1);
      readings.push({
        where: `${frame} frame(s) into ${where}`,
        muted: await mirrored(),
      });
    }
  }

  await hold("title");
  await openHowto(h);
  await hold("howto");
  await openSelect(h, "campaign");
  await hold("select");
  await openChallengeDocument(h, BARE);
  await hold("editor");

  return readings;
}

it("holds the mute bit across every screen and every frame until it is pressed again", async () => {
  await openTitle(h);
  assertEqual(
    await mirrored(),
    false,
    "sound is on when the game starts: the mute bit is off on the first frame",
  );

  await pressAction(h, "mute");
  assertEqual(
    await mirrored(),
    true,
    "and that first press mutes, which is the state this check holds",
  );

  const readings = await captureReplay(h, "held", () => tour());

  for (const reading of readings) {
    assertEqual(
      reading.muted,
      true,
      `the mute bit still reads true ${reading.where}: only the mute action moves it`,
    );
  }

  await pressAction(h, "mute");
  assertEqual(
    await mirrored(),
    false,
    "and the action pressed again is what ends it, so the tour held a bit rather than a constant",
  );
  await h.advance(1);
  assertEqual(
    await mirrored(),
    false,
    "the second value holds across a frame the same way the first one did",
  );
});
