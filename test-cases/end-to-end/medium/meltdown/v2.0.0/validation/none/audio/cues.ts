// audio/cues — what this group can hear, and the moves its points raise their
// events with. CASE-PROVIDED.
//
// WHAT CAN BE READ FROM OUTSIDE AN ENGINELESS BUILD, AND WHY THAT IS THE FAIR
// READING. Under an engine the cue bus is the engine's: the game asks for a cue
// BY NAME and the bus announces the play, so a check reads the name, the frame
// and the gain. There is no bus here to ask — `specs/audio.md` hands the whole
// audio layer to the build, which "synthesize[s]" its cues "with the Web Audio
// API" itself — so what is observed is the SOUND. The shared harness's
// `audio-init.js` probe is injected before a line of the build's own script runs
// and wraps the two doors a browser can emit sound through: a Web Audio source node being `start()`ed, whatever
// kind it is, and an `<audio>` element being played. The harness brackets every
// driven frame around that count, so a sound is attributed to the frame that
// produced it ({@link watchCues}).
//
// NOTHING ABOUT THE SYNTHESIS IS ASSUMED. Not the waveform, not the envelope, not
// the duration, not the gain, and not the number of sources one cue is made of —
// `specs/audio.md` fixes none of them, and a blip built from a tone and a noise
// burst is two sources and one cue. So a point here asks WHETHER a frame sounded
// and WHICH frame, never how loudly.
//
// WHAT IS THEREFORE ASSERTED, ACROSS ALL TWELVE POINTS. `specs/audio.md`: "A cue
// is raised by the frame that resolves the event it answers, and it is played
// from the frame loop, so a cue always names one real frame", and "An event that
// does not resolve raises nothing." So a point drives its event on an otherwise
// silent floor and holds that the event's frame sounded and that no other frame
// of the drive did. That separates a build that cues the event from one that cues
// nothing, one that cues a frame late, and one that blips every frame.
//
// WHERE PRESENCE CANNOT DECIDE A POINT, COUNTING CAN. Four of the ten cues answer
// events that can only ever happen on a frame that already carries another cue: a
// trip is carried over `100` by a shot, a kill is dealt by a shot, a wave clears
// on the frame its last unit dies or leaks, and victory arrives on a wave clear.
// The cue's NAME being unobservable, "the frame sounded" is equally true of a
// build that plays only the cue underneath. But `specs/audio.md` gives the build
// ten cues, "[e]ach cue ... short and distinct from the other nine", one per
// event, so a given cue is one defined sound that emits the same way every time
// it plays — and a frame carrying TWO of them therefore emits strictly more sound
// than the same frame carrying one. Those four points drive both frames and hold
// the richer one strictly above the plainer one. That is an ORDERING, not a
// threshold: no number of sources per cue is assumed, and a build whose every cue
// is a three-oscillator chord passes it exactly as one whose cues are single
// tones does.
//
// WHAT IS NOT ASSERTED, AND CANNOT BE. The cue's NAME. A build that plays its
// menu blip on every shot is not caught here, because the name is unobservable
// from outside an engineless build and inferring a cue from the waveform the
// reference happens to use would grade builds against an implementation rather
// than against the specification. NO POINT IN THIS PROJECT MAY ASSERT A CUE NAME;
// whether the ten are told apart by ear is what the `presentation` domain rating
// is for.
//
// AUDIO IS ARMED WITH A REAL KEY FIRST. A browser will not open an audio context
// without a user gesture, and a build is free to open its own only from a genuine
// DOM event, so every point but `audio/no-autoplay` calls `h.armAudio()` — a
// press of `UNBOUND_KEY`, a key `specs/controls.md` binds to nothing, delivered
// through Chromium's own input pipeline, which disturbs no game state.
// `audio/no-autoplay` is the point about the window BEFORE that gesture and
// therefore never makes one.
//
// A CUE RAISED BY A POINTER PRESS IS REACHED WITH A REAL MOUSE. `place` and
// `sell` answer things a player does, and `specs/instrumentation.md` is explicit
// that "No operation on this surface plays a cue, and none can", so a placement
// posed through `place()` or a sale posed through `sellTower()` would be silent in
// a perfectly good build. The keyboard actions go in through Chromium's own
// pipeline ({@link Harness.hold}), and the pointer presses through Chromium's own
// mouse at the CSS point the harness maps the logical one to
// ({@link mousePress}).
//
// THE MOVES BELOW ARE ARRANGEMENT, NOT VERDICTS. Each is a sequence of the atomic
// operations `specs/instrumentation.md` gives the surface, plus real input where
// the event needs it, in the shape
// `guides/authoring/writing-debug-apis-and-validators.md` asks for. They live here
// rather than in the shared harness because raising an event in order to listen to
// it is this group's own subject. NOT ONE THRESHOLD IS DECIDED IN THIS FILE: the
// ceilings below bound a build that never does the thing at all, and each point
// states its own reading itself.

import { fail } from "../assert";
import {
  BINDINGS,
  OPENING_TILES,
  tileCX,
  tileCY,
  type Exhaust,
  type Tile,
  type TowerType,
} from "../constants";
import {
  framesFor,
  lastUnit,
  shopControl,
  type Harness,
  type MeltdownSnapshot,
  type TimedCue,
  type UnitView,
} from "../harness";

/* -------------------------------------------------------------------------- */
/* Reading the sounds                                                         */
/* -------------------------------------------------------------------------- */

/** How many sounds the build emitted on `frame`. */
export function soundsOn(played: readonly TimedCue[], frame: number): number {
  return played.filter((cue) => cue.frame === frame).length;
}

/**
 * The frames of every sound that did NOT land on `frame`.
 *
 * Empty is what a point requires; anything else names the frames a build sounded
 * on that its event did not happen on.
 */
export function framesOtherThan(
  played: readonly TimedCue[],
  frame: number,
): number[] {
  return played.filter((cue) => cue.frame !== frame).map((cue) => cue.frame);
}

/** The frames of every sound that landed on none of `frames`. */
export function framesOutside(
  played: readonly TimedCue[],
  frames: readonly number[],
): number[] {
  return played
    .filter((cue) => !frames.includes(cue.frame))
    .map((cue) => cue.frame);
}

/**
 * The most sound any ONE frame other than `frame` carried, and `0` when no other
 * frame sounded at all.
 *
 * What the four counting points hold their richer frame above. Taken per frame
 * rather than in total, because a drive that ran twenty plain shots emitted
 * twenty sounds and each of those frames carried one cue.
 */
export function peakOtherThan(
  played: readonly TimedCue[],
  frame: number,
): number {
  const counts = new Map<number, number>();
  for (const cue of played) {
    if (cue.frame === frame) continue;
    counts.set(cue.frame, (counts.get(cue.frame) ?? 0) + 1);
  }
  return counts.size === 0 ? 0 : Math.max(...counts.values());
}

/** How many distinct frames of the drive carried any sound at all. */
export function soundingFrames(played: readonly TimedCue[]): number[] {
  return [...new Set(played.map((cue) => cue.frame))].sort((a, b) => a - b);
}

/* -------------------------------------------------------------------------- */
/* Ceilings                                                                   */
/* -------------------------------------------------------------------------- */
//
// A CEILING, NOT A TOLERANCE. Every event below happens on the first frame that
// can carry it in a conforming build, and each point reads the frame it actually
// happened on rather than a frame this file predicted — so widening any of these
// changes no verdict. What they bound is the cost of a build that never fires,
// never sells, never leaks, or never trips.

/** An event a press resolves: a menu move, a sale, a placement. */
export const PRESS_CEILING = framesFor(1);

/**
 * A shot resolving. The slowest emitter's interval is the Lance's `1.25` s
 * (`specs/towers.md`), and a run of firing lands its first shot one full interval
 * after the target was acquired (`specs/combat.md`).
 */
export const SHOT_CEILING = framesFor(4);

/**
 * A unit crossing one tile. The slowest unit is the Core at `30` logical units
 * per second (`specs/surge.md`) and a tile is `19` across, so one tile is `0.64`
 * s of game time.
 */
export const WALK_CEILING = framesFor(4);

/**
 * A firing emitter carrying itself over `100`. The Stutter gains
 * `heatPerShot / mass` per shot at `7` shots a second against air cooling
 * proportional to its heat (`specs/heat.md`), which crosses the trip inside three
 * seconds of game time from cold; this is triple that.
 */
export const TRIP_CEILING = framesFor(9);

/* -------------------------------------------------------------------------- */
/* Naming the frame an event resolved on                                      */
/* -------------------------------------------------------------------------- */

/** Where a drive got to, and the state it got there in. */
export interface Resolution {
  /** Whether the situation was reached inside the ceiling. */
  hit: boolean;
  /** The frame it was first read on, as {@link Harness.frame} counts frames. */
  frame: number;
  snapshot: MeltdownSnapshot;
}

/**
 * Run frames one at a time until `holds`, and name the frame it first held on.
 *
 * ONE FRAME PER SAMPLE is what makes the frame exact, and it is why nothing in
 * this file uses a coarser poll: a point that reads the sound on "the frame the
 * event resolved" cannot afford a sample that covers five frames and cannot say
 * which of them carried it.
 *
 * A situation that already holds before the first frame runs is a MIS-POSED
 * SCENARIO rather than an event, and it fails here rather than quietly
 * attributing the event to the frame before the drive.
 */
export async function frameWhere(
  h: Harness,
  holds: (snapshot: MeltdownSnapshot) => boolean,
  ceiling: number,
  doing = "the scenario",
): Promise<Resolution> {
  const swept = await h.until(holds, { maxFrames: ceiling, poll: 1 });
  if (swept.hit && swept.frames === 0) {
    fail(
      `${doing}: the event to resolve on a frame of this drive`,
      "the situation already held before the drive opened a frame",
    );
  }
  return { hit: swept.hit, frame: h.frame(), snapshot: swept.snapshot };
}

/**
 * Hold a real key until `holds`, and name the frame the event resolved on.
 *
 * TWO CONFORMANT WAYS TO READ A PRESS, ONE FRAME EACH. `specs/controls.md` reads
 * every action "as a press edge" that "fires once per press", and an engineless
 * build wrote its own keyboard layer, so it either latches the edge in its
 * `keydown` handler or compares held state at the top of each frame. The second
 * resolves the event on the first frame driven after the key goes down, which
 * {@link frameWhere} names. The first resolves it IN THE HANDLER, between two
 * driven frames — the situation already holds before a frame is opened — and
 * `specs/audio.md` has its cue "played from the frame loop, so a cue always
 * names one real frame": the next frame the loop runs. The shared harness
 * credits a sound started between driven frames to that same next frame, so for
 * a build of that kind the event's frame is the one driven right after the key
 * went down, and that is the frame this returns.
 *
 * WHAT IS STILL A MIS-POSED SCENARIO: the situation holding BEFORE the key goes
 * down. That is read here, once, and fails the way {@link frameWhere} fails,
 * because no press resolved anything.
 */
async function pressWhere(
  h: Harness,
  code: string,
  holds: (snapshot: MeltdownSnapshot) => boolean,
  ceiling: number,
  doing: string,
): Promise<Resolution> {
  if (holds(await h.snapshot())) {
    fail(
      `${doing}: the event to resolve on a frame of this drive`,
      "the situation already held before the key went down",
    );
  }
  await h.hold(code);
  try {
    if (holds(await h.snapshot())) {
      // Resolved in the handler, between frames: the frame loop that plays the
      // cue runs next, and that frame is the event's.
      await h.advance(1);
      return { hit: true, frame: h.frame(), snapshot: await h.snapshot() };
    }
    return await frameWhere(h, holds, ceiling, doing);
  } finally {
    await h.release(code);
  }
}

/* -------------------------------------------------------------------------- */
/* The keyboard moves                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Move the highlight of whatever menu is on screen on by one, and let the key go
 * the moment it moves ({@link pressWhere}).
 *
 * `specs/screens.md`: "`up` and `down` move the highlight one row, and the
 * highlight wraps at both ends". The action is released as soon as the highlight
 * has moved, so exactly one move happens whether a build reads the movement
 * action as a press edge or repeats it while held — `specs/controls.md` reads
 * every action as a press edge that "fires once per press", and holding it down
 * "fires its action exactly once", so both readings move the highlight once and
 * neither is decided here.
 */
export async function moveHighlight(h: Harness): Promise<Resolution> {
  const from = (await h.snapshot()).menuIndex;
  return pressWhere(
    h,
    BINDINGS.down,
    (snapshot) => snapshot.menuIndex !== from,
    PRESS_CEILING,
    "the menu move",
  );
}

/**
 * Sell the selected tower with the key `specs/controls.md` binds `sell` to, and
 * let the key go the moment the tower is gone.
 *
 * `KeyS` on a selected tower "[s]ells the selected tower", and selling "pays its
 * refund into the money and removes it" (`specs/building.md`), so the frame the
 * sale resolves on is the frame the roster shortens.
 */
export async function sellSelected(h: Harness): Promise<Resolution> {
  const standing = (await h.snapshot()).towers.length;
  return pressWhere(
    h,
    BINDINGS.sell,
    (snapshot) => snapshot.towers.length < standing,
    PRESS_CEILING,
    "the sale",
  );
}

/**
 * Send the coming wave and let it release its first unit, with the world gate
 * open only for as long as that takes.
 *
 * `specs/waves.md`: "Sending is what begins Wave 1", a build phase's "sending
 * starts it earlier", and "A wave releases its units one at a time ... the first
 * on the frame the wave begins". THE GATE IS OPENED HERE ON PURPOSE and it is the
 * only place in this group that opens it: a wave that never released a unit never
 * clears (`specs/waves.md`), so the three points about a clearing wave need a
 * wave that really was released, by the run's own release rather than by
 * `addUnit`. It is shut again the moment the first unit is on the floor, so the
 * next release of `WAVE_SPAWN_INTERVAL` never arrives and the floor the point
 * reads carries that one unit and nothing else.
 */
export async function sendWave(h: Harness): Promise<Resolution> {
  await h.debug.setWaveSpawning(true);
  try {
    return await pressWhere(
      h,
      BINDINGS.send,
      (snapshot) => snapshot.phase === "wave" && snapshot.surge.length > 0,
      PRESS_CEILING,
      "the send",
    );
  } finally {
    await h.debug.setWaveSpawning(false);
  }
}

/* -------------------------------------------------------------------------- */
/* The pointer moves                                                          */
/* -------------------------------------------------------------------------- */

/** The three frames one real press and release ran, and what each left behind. */
export interface PressResult {
  /** The frame the pointer's arrival at the point was delivered on. */
  moveFrame: number;
  moved: MeltdownSnapshot;
  /** The frame the press was delivered on. */
  downFrame: number;
  pressed: MeltdownSnapshot;
  /** The frame the RELEASE resolved on: the frame an interaction lands on. */
  frame: number;
  snapshot: MeltdownSnapshot;
}

/**
 * A press and a release at one logical stage point, made with Chromium's own
 * mouse, with one frame run after each of the three events.
 *
 * WHY A REAL MOUSE. `specs/controls.md` answers "a press and release inside one
 * region as one interaction with that region", and
 * `specs/instrumentation.md` is explicit that no operation of the debug surface
 * plays a cue — so a press posed through `pointerDown`/`pointerUp` is entitled to
 * be silent, and only a genuine pointer event can raise `place` or `sell`. The
 * logical point is mapped through the harness's own fit, which at the stage's own
 * size is the identity.
 *
 * WHY ONE FRAME AFTER EACH EVENT. `specs/audio.md` plays every cue "from the
 * frame loop", so a press that resolves between two frames has its cue raised by
 * the next one; and a build that instead reads the pointer inside its update
 * resolves the press on that same next frame. Either way the interaction lands on
 * the ONE frame run after the release, which is the frame this returns as
 * `frame`. The move and press frames are returned too, so a point can hold that
 * nothing sounded before the release.
 */
export async function mousePress(
  h: Harness,
  x: number,
  y: number,
): Promise<PressResult> {
  const at = h.css(x, y);
  await h.page.mouse.move(at.x, at.y);
  await h.advance(1);
  const moveFrame = h.frame();
  const moved = await h.snapshot();

  await h.page.mouse.down();
  await h.advance(1);
  const downFrame = h.frame();
  const pressed = await h.snapshot();

  await h.page.mouse.up();
  await h.advance(1);
  return {
    moveFrame,
    moved,
    downFrame,
    pressed,
    frame: h.frame(),
    snapshot: await h.snapshot(),
  };
}

/**
 * Move Chromium's own mouse to a logical stage point and run the frame that
 * delivers it.
 *
 * WHY A REAL MOUSE. `specs/instrumentation.md` is explicit that no operation of
 * the debug surface plays a cue, so a move posed through `pointerMove` is
 * entitled to be silent. Only a genuine pointer event can raise the `menu` cue
 * `specs/controls.md` binds to the pointer reaching a row. The logical point is
 * mapped through the harness's own fit, which at the stage's own size is the
 * identity.
 *
 * The frame run after the move is the frame the cue belongs to, and it is what
 * is returned.
 */
export async function mouseMove(
  h: Harness,
  x: number,
  y: number,
): Promise<number> {
  const at = h.css(x, y);
  await h.page.mouse.move(at.x, at.y);
  await h.advance(1);
  return h.frame();
}

/**
 * Arm a tower type by pressing the shop entry the PANEL reported for it.
 *
 * `specs/hud.md` leaves where each control sits to the build and reports the
 * rectangles it chose, and `specs/controls.md` makes a press and release on "A
 * shop entry" arm "that entry's type". So the coordinates come from the build's
 * own `controls.shop` and the press is a real one. Arming resolves no event of
 * the cue table, so this stretch of the drive is part of a point's silence.
 */
export async function armFromShop(
  h: Harness,
  type: TowerType,
): Promise<PressResult> {
  const entry = shopControl(await h.snapshot(), type, "arming from the shop");
  return mousePress(h, entry.x + entry.w / 2, entry.y + entry.h / 2);
}

/* -------------------------------------------------------------------------- */
/* The surge moves                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Stand the unit `id` on the last tile before its own exhaust, walking.
 *
 * `specs/mazing.md`: "A unit leaves the floor when the tile its centre occupies
 * is one of the opening tiles of its assigned exhaust", and
 * `specs/instrumentation.md` recomputes its route from the tile the posed
 * position falls in. So a unit posed one tile inside the opening walks the single
 * step its own locomotion takes to leave, on an empty floor with nothing else on
 * it — which is what makes the leak the only event in the window.
 *
 * The tile is the middle of the opening's run, so a footprint a point posed
 * elsewhere cannot be in the way.
 */
export async function poseAtExhaustDoor(
  h: Harness,
  id: number,
  exhaust: Exhaust,
): Promise<Tile> {
  const opening = OPENING_TILES[exhaust];
  const door = opening[Math.floor(opening.length / 2)];
  const inside: Tile =
    exhaust === "right"
      ? { col: door.col - 1, row: door.row }
      : { col: door.col, row: door.row - 1 };
  await h.debug.setUnitPosition(id, tileCX(inside.col), tileCY(inside.row));
  await h.debug.setUnitMotion(id, true);
  return inside;
}

/** Run frames one at a time until the floor is clear of surge. */
export function leakOut(h: Harness, doing = "the leak"): Promise<Resolution> {
  return frameWhere(
    h,
    (snapshot) => snapshot.surge.length === 0,
    WALK_CEILING,
    doing,
  );
}

/** What one released unit's whole life on the floor came to. */
export interface ReleasedLeak {
  /** The send that began the wave and put its first unit on the floor. */
  released: Resolution;
  /** The unit that was released, as the frame it arrived on reported it. */
  unit: UnitView;
  /** The frame it left the floor through its exhaust. */
  leak: Resolution;
}

/**
 * Send the wave the run is prepared for, walk its one released unit out through
 * its exhaust, and name the frame it left on.
 *
 * The move the three transition points share. It assumes the caller has posed a
 * MILESTONE wave, which `specs/waves.md` makes a Core wave of exactly one unit
 * (`waveSize(w, n) = 1 if waveType(w, n) = "core"`), so the send releases one unit
 * and leaves nothing pending — which is what lets a single leak be the wave's last
 * live unit.
 *
 * `pending` is then posed on top, and it is the DISTINGUISHING VALUE the two
 * boards of `audio/wave-clear-cue` differ in: `specs/waves.md` clears a wave "on
 * the frame in which its last live unit dies or leaks WITH NONE OF IT LEFT TO
 * RELEASE", so `0` clears and `1` does not. The world gate is already shut by
 * {@link sendWave}, so a unit still counted as pending never actually arrives and
 * the floor stays as posed either way.
 *
 * It poses no tower and kills nothing: the wave's last unit leaves by walking out,
 * which `specs/waves.md` makes a clearing event exactly as a death is, and which
 * needs no emitter, no damage arithmetic and no heat.
 */
export async function releaseAndLeak(
  h: Harness,
  pending: number,
): Promise<ReleasedLeak> {
  const released = await sendWave(h);
  const unit = lastUnit(released.snapshot);
  if (unit === undefined) {
    fail(
      "the send to put the wave's first unit on the floor (specs/waves.md)",
      "the surge roster was empty on the frame the wave began",
    );
  }
  await h.debug.setWavePending(pending);
  await poseAtExhaustDoor(h, unit.id, unit.exhaust);
  const leak = await leakOut(h, "the released unit's leak");
  return { released, unit, leak };
}

/**
 * Deliver the FIRST INPUT, so the build's cues are unlocked.
 *
 * `specs/audio.md` makes a freshly loaded build silent: "the game makes no sound
 * at all before the first input reaches it: until then it starts no audio source
 * and plays no clip". There is no bus in an engineless build; the build owns the
 * unlock itself. A point that poses a floor and drives frames has delivered no
 * input at all, so a build that keeps that rule is silent for the whole drive
 * and the point reads the autoplay rule instead of the cue it is about. Every
 * scenario in this group that reaches its event WITHOUT a press or a pointer of
 * its own therefore opens with this, before it poses anything.
 *
 * `audio/no-autoplay` is the point that decides the rule itself, and it is the
 * one point in this group that must never call this.
 *
 * The input is one `down` on the menu a freshly loaded build opens on — the same
 * input `no-autoplay` uses, and the cheapest one a game one frame old can take.
 * It lands before the scenario is posed and so on a frame no reading here is
 * taken on.
 */
export async function reachFirstInput(h: Harness): Promise<void> {
  await h.tap(BINDINGS.down);
}
