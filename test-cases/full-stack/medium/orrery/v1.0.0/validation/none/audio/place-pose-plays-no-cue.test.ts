// audio/place-pose-plays-no-cue — the five machine poses change the machine and
// sound nothing.
//
// THE RULE. "Audio belongs to the frames. A pose changes the state alone and
// SOUNDS NOTHING, the pointer operations included; the cues a scenario hears come
// from the frames advanced after it" (`specs/instrumentation.md`, A deterministic
// core). `placePart`, `placeRise`, `placeSet`, `placeTrack` and `loadSolution` are
// five rows of that surface's machine group, and every one of them is a pose: "A
// pose sets one thing, and the game's own editor rules, simulation, sigils, and
// completion test do the rest"; "No pose decides an outcome". What `CUES.place`
// is the cue OF is the player's own edit — "`place` | `CUES.place` | A part is
// placed or moved" (`specs/ui.md`) — and the specification hands the deferral to
// the pointer alone: "The cue of an edit one of THEM commits sounds on the next
// frame advanced."
//
// SO THE SILENCE IS READ TWICE. Once at the call, with no frame between the five
// poses, which is the sentence above stated exactly; and once over the frames
// advanced afterwards, which is where a cue a pose had merely deferred would
// arrive. The editor holds no run and no machine but the one these poses build,
// so nothing else on the screen has an event to sound on.
//
// AND THE READING IS SHOWN TO WORK, on the same build, in the same window: a
// build the harness simply cannot hear would pass a silence check by being
// silent. So the check closes by committing the same edit the way a PLAYER
// commits it — a pointer drag that moves a placed part — and reads the count
// move. That is `specs/ui.md`'s own "an event raised outside one ... sounds on
// the next frame advanced".
//
// THE VERDICT. Each of the five poses changed the machine; not one sound was
// emitted at the calls or on the frames after them; and the player's own drag,
// over the same build, sounds.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import { at, hexCenter } from "../field";
import { armPart, solution } from "../formats";
import { BARE, EAST, ORIGIN, SOUTH, WEST } from "../fixtures";
import {
  captureReplay,
  createHarness,
  drag,
  openChallengeDocument,
  openTitle,
  placePart,
  placeRise,
  placeSet,
  placeTrack,
  loadMachine,
  watchCues,
  type Harness,
} from "../harness";
import { openSilence } from "./silence";

/** Frames advanced after the poses, where a deferred cue would arrive. */
const AFTER = 6;

/** Where the placed arm is dragged to: a hex clear of everything else posed. */
const MOVED_TO = at(1, -1);

/** What `loadSolution` replaces the whole machine with. */
const RELOADED = solution([armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, [])]);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("places a machine five ways from code without sounding a place cue", async () => {
  await openTitle(h);
  await openSilence(h);

  await openChallengeDocument(h, BARE);
  assertEqual(
    (await h.snapshot()).editor.parts.length,
    0,
    "the editor opens on an empty machine, so every part below is one these poses placed",
  );

  const played = watchCues(h);
  const before = await h.sounds();

  const posed = await captureReplay(h, "silent", async () => {
    // Every call from here to the reading is a pose. No frame is advanced.
    await placePart(h, "arm", ORIGIN, 0);
    const withArm = (await h.snapshot()).editor.parts.length;
    await placeRise(h, 0, WEST);
    const withRise = (await h.snapshot()).editor.parts.length;
    await placeSet(h, 0, EAST);
    const withSet = (await h.snapshot()).editor.parts.length;
    await placeTrack(h, [SOUTH]);
    const withTrack = (await h.snapshot()).editor.parts.length;
    await loadMachine(h, RELOADED);
    const reloaded = (await h.snapshot()).editor.parts;

    const reading = { sounded: await h.sounds(), stamped: played.length };

    // Only now, past the reading, are the frames run a deferred cue would land on.
    await h.advance(AFTER);
    return { withArm, withRise, withSet, withTrack, reloaded, reading };
  });

  // Each pose changed the machine, so the silence is a silence over real edits.
  assertEqual(posed.withArm, 1, "placePart placed the arm");
  assertEqual(posed.withRise, 2, "placeRise placed the rise for reagent 0");
  assertEqual(posed.withSet, 3, "placeSet placed the set for product 0");
  assertEqual(posed.withTrack, 4, "placeTrack placed the one-cell track");
  assertLength(
    posed.reloaded,
    1,
    "loadSolution replaced the whole machine with the document's one part",
  );
  assertEqual(
    posed.reloaded[0]?.kind,
    "arm",
    "which is the arm the document names",
  );

  // And not one of them sounded, at the call or on the frames after it.
  assertEqual(
    posed.reading.sounded,
    before,
    "the five machine poses sound nothing at the call: a pose changes the state alone",
  );
  assertEqual(
    posed.reading.stamped,
    0,
    "and no cue was attributed to a frame, because no frame ran between them",
  );
  assertEqual(
    await h.sounds(),
    before,
    "and none arrived on the frames advanced afterwards either: no CUES.place is deferred out of a pose",
  );

  // The control: the same edit committed the player's way does sound.
  await drag(h, hexCenter(ORIGIN), hexCenter(MOVED_TO));
  await h.advance(2);
  assertGreaterThan(
    await h.sounds(),
    before,
    "the same build sounds when a POINTER commits the move, so the silence above is the pose's rather than a build that cannot be heard",
  );
});
