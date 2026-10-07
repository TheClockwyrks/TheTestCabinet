// Orrery — the base variant's showcase capture driver.
//
// THIS IS NOT A VALIDATOR. No review item names it, it lives outside
// `validation/` so no run ever loads it, and it is staged by hand. What it is is
// the case's own validator harness reused as a RECORDING RIG: it stands the
// reference build up exactly as a check does, plays the game the way a player
// plays it, and keeps what the engine's recorder saw.
//
// WHAT IT PLAYS. One take is one sitting: the title screen is opened, a mode is
// chosen with a key press, a challenge is taken off its select screen, a machine
// is BUILT on the field with pointer drags out of the tray and instruction keys
// into the tape panel, and the machine is then run until it has delivered its
// product `CONSTELLATION_TARGET` times and the challenge completes. Nothing is
// cut, nothing is staged, and the take runs from the title to the solved panel in
// one unbroken drive.
//
// WHAT IT MAY NOT DO, AND DOES NOT.
// `guides/authoring/authoring-a-case-showcase.md`: "Arranging the input is
// authoring; posing the outcome through the debug surface is fabrication." So
// every frame below is driven through the two doors a player has — the runtime's
// own keyboard (`h.tap`, `h.hold`, `h.release`) and its own pointer
// (`h.mousePress`, `h.mouseGlide`, `h.mouseRelease`), each of which dispatches a
// real event at the surface and runs the frame that delivers it. The debug
// surface is used for exactly two things, and both are READS: `snapshot()`, which
// is how the driver knows where the game got to, and `referenceSolution`, which
// is how it knows what machine to build. Nothing is placed, posed, spawned,
// loaded, tallied or completed through the surface. The validators pose; the
// showcase plays.
//
// The machine is TYPED IN rather than loaded. `referenceSolution` hands back the
// build's own answer as a document, and {@link buildMachine} turns that document
// back into the gestures that would have produced it: a drag out of the right
// tray slot onto the right hex, `part-cw`/`part-grow` on the live ghost to turn
// and lengthen it before the release, a lay along a track's cells, and one
// instruction key per tape cell. What lands on the field is therefore the build's
// own machine, put there by the build's own editor.
//
// THE PRODUCED ART IS REAL. Orrery's harness already gives this process the three
// things a browser gives the engine's asset loader — a `fetch` that reads the
// committed file, a `createImageBitmap` that decodes it, and an `AudioContext`
// that decodes a `.wav` — so a sprite reaches the recording as its own pixels
// rather than as the fallback a bare Node process would leave. A showcase has to
// show the real art, so this driver REFUSES to record a take whose warm-up drew
// no decoded image at all, or whose loader reported a failure.
//
// THE AUDITION RECORDS EVERY TAKE AND KEEPS THE WINNER. Each candidate is played
// under the recorder, written under its own name, and measured; the driver then
// names the most watchable, and that take's files are the ones copied into the
// showcase. Nothing is played twice. With `TCAB_VALIDATION_MEDIA_DIR` unset every
// write below is a no-op, so the same audition is a dry run that only measures.

import { it } from "vitest";
import {
  CONSTELLATION_TARGET,
  DEFAULT_SPEED_INDEX,
  PARTS,
  SPEEDS,
  TICK_HZ,
  type ActionName,
  type InstructionName,
  type ModeName,
  type PartName,
} from "./constants";
import {
  firstVisibleRow,
  hexCenter,
  regionCenter,
  tapeLabel,
  traySlot,
  type Hex,
  type StagePoint,
} from "./field";
import type { Solution, SolutionPart } from "./formats";
import {
  captureReplay,
  captureStill,
  createHarness,
  distinctSources,
  keyFor,
  type Harness,
  type OrrerySnapshot,
} from "./harness";

/* -------------------------------------------------------------------------- */
/* The knobs                                                                  */
/* -------------------------------------------------------------------------- */

/** Read an environment number, falling back where it is unset or unreadable. */
function number(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/**
 * The take recorded when one is named: `<mode>:<number>`, one-based, as the
 * select screen numbers a challenge. Naming one skips the audition entirely and
 * writes the take under the showcase's own file names.
 */
const NAMED_TAKE = process.env.TCAB_SHOWCASE_TAKE ?? "";

/**
 * The takes auditioned when none is named, in the order they are tried.
 *
 * ALL TEN ARE EXTRAS, AND THAT IS FORCED BY THE GAME RATHER THAN CHOSEN.
 * `specs/modes/campaign.md` opens the course on challenge `1` and leaves "every
 * other challenge locked" until the one before it is completed, so a single
 * sitting can only ever reach `campaign:1` — and it is a three-part opener that
 * runs well under the bounds below. `specs/modes/extras.md`'s shelf is "open from
 * the start", every row of it can be entered, and its ten challenges span the
 * whole machine, so that is where a take is drawn from.
 */
const AUDITION =
  process.env.TCAB_SHOWCASE_TAKES ??
  "campaign:1,extras:2,extras:3,extras:4,extras:5,extras:6,extras:7,extras:8,extras:9,extras:10";

/** The shortest a take may run, in seconds. Under this it reads as a snippet. */
const MIN_SECONDS = number("TCAB_SHOWCASE_MIN_SECONDS", 20);

/** The longest a take may run, in seconds. The preview stage is not a film. */
const MAX_SECONDS = number("TCAB_SHOWCASE_MAX_SECONDS", 40);

/**
 * How many speed steps the player presses once the run is under way, and after
 * how many cycles. A run opens at `SPEEDS[DEFAULT_SPEED_INDEX]` (3 cycles a
 * second), which is the pace the first deliveries are watched at; a machine
 * whose product needs many periods is then wound on, exactly as a player winds
 * one on.
 */
const SPEED_TAPS = Math.max(
  0,
  Math.round(number("TCAB_SHOWCASE_SPEED_TAPS", 0)),
);
const SPEED_AFTER_CYCLES = Math.max(
  0,
  Math.round(number("TCAB_SHOWCASE_SPEED_AFTER", 12)),
);

/** `1` writes a still every few seconds, for eyeballing a take. */
const QA_STILLS = process.env.TCAB_SHOWCASE_QA_STILLS === "1";

/** How often a QA still is written, in frames. */
const QA_EVERY = Math.max(1, Math.round(number("TCAB_SHOWCASE_QA_EVERY", 120)));

/* -------------------------------------------------------------------------- */
/* Pacing                                                                     */
/* -------------------------------------------------------------------------- */
//
// A take is driven at exactly `TICK_HZ` frames a second, so every figure here is
// both a frame count and a duration. They are the difference between a clip that
// reads as a person playing and one that reads as a script running: a press is
// let land before the next one is made, a drag crosses the field rather than
// jumping it, and each screen is held long enough to be read.

/** How long the title is held before the menu is worked. */
const TITLE_LINGER = 48;
/** How long a menu press is let land. */
const AFTER_KEY = 14;
/** How long the select screen is read before a challenge is taken. */
const SELECT_LINGER = 36;
/** How many frames a drag out of the tray takes to cross the field. */
const DRAG_FRAMES = 14;
/** How long a ghost is turned for, between one rotation press and the next. */
const AFTER_GHOST_KEY = 5;
/** How long the field is looked at between one placement and the next. */
const BETWEEN_PARTS = 16;
/** How long an instruction key is let land before the next is pressed. */
const AFTER_INSTRUCTION = 4;
/** How long the finished row is looked at before the next is written. */
const BETWEEN_ROWS = 18;
/** How long the finished machine is looked at before `play` is pressed. */
const BEFORE_PLAY = 34;
/** How long the solved panel is held before the take ends. */
const SOLVED_LINGER = 84;

/* -------------------------------------------------------------------------- */
/* A take                                                                     */
/* -------------------------------------------------------------------------- */

/** One sitting: a mode, and the challenge taken off its select screen. */
interface Take {
  mode: ModeName;
  /** One-based, as the select screen numbers a challenge. */
  number: number;
}

/** What a take was worth, once played. */
interface Measured {
  take: Take;
  /** The challenge's own name, as the heading carries it. */
  name: string;
  /** Frames driven from the title to the last frame of the solved panel. */
  frames: number;
  /** Those frames as seconds, at `TICK_HZ`. */
  seconds: number;
  /** Parts the machine was built from. */
  parts: number;
  /** The machine's period, in cycles. */
  period: number;
  /** Cycles the run took to complete. */
  cycles: number;
  /** Whether the run completed rather than faulting or running out. */
  completed: boolean;
  /** Frames spent building, which is the half a viewer reads as authorship. */
  buildFrames: number;
  /** Frames spent running, which is the half a viewer reads as the machine. */
  runFrames: number;
}

/** `<mode>:<number>` back into a take, or `null` for anything else. */
function parseTake(text: string): Take | null {
  const [mode, index] = text.trim().split(":");
  if (mode !== "campaign" && mode !== "extras") return null;
  const number_ = Number(index);
  if (!Number.isInteger(number_) || number_ < 1) return null;
  return { mode, number: number_ };
}

/** How a take is written in a log line. */
function takeName(take: Take): string {
  return `${take.mode}:${take.number}`;
}

/** The prefix an auditioned take's files carry, so every take keeps its own. */
function takePrefix(take: Take): string {
  return `${take.mode}-${String(take.number)}-`;
}

/* -------------------------------------------------------------------------- */
/* The player's two doors                                                     */
/* -------------------------------------------------------------------------- */

/** Press an action's key, run the frame that delivers it, and let it land. */
async function press(
  h: Harness,
  action: ActionName,
  settle = AFTER_KEY,
): Promise<void> {
  await h.tap(keyFor(action));
  await h.advance(settle);
}

/** Press the key an instruction is written with. */
function pressInstruction(
  h: Harness,
  instruction: InstructionName,
): Promise<void> {
  return press(h, `ins-${instruction}` as ActionName, AFTER_INSTRUCTION);
}

/**
 * Move the pressed pointer from where it is to `to`, one frame per step, so the
 * drag's ghost is retargeted across the field rather than teleported onto it.
 */
async function glide(
  h: Harness,
  from: StagePoint,
  to: StagePoint,
  steps = DRAG_FRAMES,
): Promise<void> {
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    await h.mouseGlide(
      from.x + (to.x - from.x) * t,
      from.y + (to.y - from.y) * t,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Building the machine the player's way                                      */
/* -------------------------------------------------------------------------- */

/**
 * Which tray entry places `part`, by the rule `specs/editor.md` fixes: "the
 * challenge's `permitted` part kinds, in the order of `PARTS`; then one `rise`
 * per reagent, in reagent order; then one `set` per product, in product order."
 */
function slotFor(snapshot: OrrerySnapshot, part: SolutionPart): number {
  const challenge = snapshot.challenge;
  if (challenge === null) throw new Error("no challenge is open");
  const kinds = [...challenge.permitted].sort(
    (a: PartName, b: PartName) => PARTS.indexOf(a) - PARTS.indexOf(b),
  );
  if (part.kind === "rise") return kinds.length + (part.index ?? 0);
  if (part.kind === "set") {
    return kinds.length + challenge.reagents.length + (part.index ?? 0);
  }
  const at_ = kinds.indexOf(part.kind);
  if (at_ < 0) {
    throw new Error(`the tray offers no ${part.kind} on "${challenge.name}"`);
  }
  return at_;
}

/**
 * Turn and lengthen the live ghost to the pose the document names, through the
 * four actions `specs/editor.md` lets a drag read.
 *
 * The ghost "opens at rotation `0` and length `1`", so a rotation of `r` is `r`
 * presses of `part-cw` or `6 - r` of `part-ccw`, whichever is fewer, and a length
 * of `n` is `n - 1` presses of `part-grow`.
 */
async function poseGhost(h: Harness, part: SolutionPart): Promise<void> {
  const rotation = (((part.rotation ?? 0) % 6) + 6) % 6;
  const cw = rotation <= 3;
  const turns = cw ? rotation : 6 - rotation;
  for (let i = 0; i < turns; i += 1) {
    await press(h, cw ? "part-cw" : "part-ccw", AFTER_GHOST_KEY);
  }
  for (let i = 1; i < (part.length ?? 1); i += 1) {
    await press(h, "part-grow", AFTER_GHOST_KEY);
  }
}

/** The hex a solution part is anchored on. A track is anchored on its first cell. */
function anchorOf(part: SolutionPart): Hex {
  const first = part.cells?.[0];
  if (first !== undefined) return first;
  return { q: part.q ?? 0, r: part.r ?? 0 };
}

/**
 * Take one part out of the tray and drop it on the field: the gesture
 * `specs/editor.md` calls a drag "From the tray".
 */
async function dragOut(
  h: Harness,
  slot: number,
  to: Hex,
  part: SolutionPart,
): Promise<void> {
  const from = regionCenter(traySlot(slot));
  const onto = hexCenter(to);
  await h.mousePress(from.x, from.y);
  await glide(h, from, onto);
  await poseGhost(h, part);
  await h.mouseRelease();
  await h.advance(BETWEEN_PARTS);
}

/**
 * Lay a track's path: a press on the one-cell track begins the lay from its
 * `last` end, each move onto an adjacent hex appends it, and a move onto the
 * other end closes the loop (`specs/editor.md`, Laying track).
 */
async function layTrack(h: Harness, part: SolutionPart): Promise<void> {
  const cells = part.cells ?? [];
  if (cells.length < 2 && part.closed !== true) return;
  const start = hexCenter(cells[0] as Hex);
  await h.mousePress(start.x, start.y);
  let from = start;
  for (const cell of cells.slice(1)) {
    const onto = hexCenter(cell);
    await glide(h, from, onto, 6);
    from = onto;
  }
  if (part.closed === true) {
    await glide(h, from, start, 6);
  }
  await h.mouseRelease();
  await h.advance(BETWEEN_PARTS);
}

/**
 * Write one arm's tape, key by key.
 *
 * The row is reached by pressing its LABEL, which "points [the cursor] at that
 * row, column `0`" and sets the focus to the tape panel, and the panel's scroll
 * is derived from where the cursor already is — so the visible row is computed
 * from the snapshot rather than assumed.
 */
async function writeRow(
  h: Harness,
  row: number,
  tape: readonly (InstructionName | null)[],
): Promise<void> {
  const before = await h.snapshot();
  const rows = before.editor.parts.filter((part) => part.tape !== null);
  const cursorRow = before.editor.cursor;
  const selected =
    cursorRow === null
      ? null
      : rows.findIndex((part) => part.id === cursorRow.part);
  const first = firstVisibleRow(
    selected === null || selected < 0 ? null : selected,
  );
  const visible = row - first;
  if (visible < 0 || visible > 4) {
    throw new Error(
      `tape row ${row} is not on screen from first row ${first}; this take ` +
        "needs a machine of at most five tape rows",
    );
  }
  const label = regionCenter(tapeLabel(visible));
  await h.mousePress(label.x, label.y);
  await h.mouseRelease();
  await h.advance(AFTER_KEY);
  for (const cell of tape) {
    if (cell === null) {
      await press(h, "right", AFTER_INSTRUCTION);
    } else {
      await pressInstruction(h, cell);
    }
  }
  await h.advance(BETWEEN_ROWS);
}

/**
 * Build the whole of `solution` on the open challenge, through the editor.
 *
 * The document is the build's own answer, read off the surface; what puts it on
 * the field is the tray, the pointer and the instruction keys.
 */
async function buildMachine(h: Harness, solution: Solution): Promise<void> {
  for (const part of solution.parts) {
    const snapshot = await h.snapshot();
    await dragOut(h, slotFor(snapshot, part), anchorOf(part), part);
    if (part.kind === "track") await layTrack(h, part);
  }
  // Which tape row each placed part owns. The panel "shows one row per arm and
  // wheel, in placement order", and one drag placed one part, so the machine on
  // the field is in the document's own order and the rows fall out of it — a
  // wheel whose tape is empty still holds a row, and a sigil holds none.
  const placed = await h.snapshot();
  const rows = new Map<number, number>();
  let next = 0;
  placed.editor.parts.forEach((view, index) => {
    if (view.tape !== null) rows.set(index, next++);
  });
  for (const [index, part] of solution.parts.entries()) {
    const tape = part.tape;
    const row = rows.get(index);
    if (tape === undefined || tape.length === 0 || row === undefined) continue;
    await writeRow(h, row, tape);
  }
}

/* -------------------------------------------------------------------------- */
/* One take, from the title to the solved panel                               */
/* -------------------------------------------------------------------------- */

/** The title menu's items, in the order `specs/ui.md` stacks them. */
const TITLE_ITEMS: ModeName[] = ["campaign", "extras"];

/**
 * Play one whole take on `h`, and answer what it was worth.
 *
 * `stills` is called at the three moments a still is worth having — the finished
 * machine, the run mid-flight, and the completion — so the recorded take and the
 * frames beside it in the carousel come from ONE sitting.
 */
async function playTake(
  h: Harness,
  take: Take,
  stills: (id: string) => Promise<void>,
): Promise<Measured> {
  const start = h.frame();

  // The title. A player looks at it before touching anything.
  await h.advance(TITLE_LINGER);
  const item = TITLE_ITEMS.indexOf(take.mode);
  for (let i = 0; i < item; i += 1) await press(h, "down");
  await press(h, "confirm");

  // The select screen, and the challenge taken off it.
  await h.advance(SELECT_LINGER);
  for (let i = 1; i < take.number; i += 1) await press(h, "down");
  await press(h, "confirm");

  const opened = await h.snapshot();
  if (opened.screen !== "editor" || opened.challenge === null) {
    throw new Error(
      `${takeName(take)} did not reach the editor: the game is on ` +
        `"${opened.screen}"`,
    );
  }
  const name = opened.challenge.name;

  // The machine, built out of the tray and typed into the tape panel.
  const solution = await h.debug.referenceSolution(take.mode, take.number - 1);
  await buildMachine(h, solution);
  await h.advance(BEFORE_PLAY);
  const built = await h.snapshot();
  await stills("machine");
  const buildFrames = h.frame() - start;

  // The run.
  await press(h, "play", AFTER_KEY);
  const running = await h.snapshot();
  if (running.sim === null || running.sim.status !== "running") {
    throw new Error(
      `${takeName(take)} did not start: ${running.sim?.status ?? "no run"}`,
    );
  }

  let sped = SPEED_TAPS === 0;
  let midway = false;
  let completed = false;
  let cycles = 0;
  const budget = 60 * TICK_HZ;
  for (let i = 0; i < budget; i += 1) {
    await h.advance(1);
    const snapshot = await h.snapshot();
    const sim = snapshot.sim;
    if (sim === null) break;
    cycles = sim.cycle;
    if (!sped && sim.cycle >= SPEED_AFTER_CYCLES) {
      sped = true;
      for (let k = 0; k < SPEED_TAPS; k += 1) await press(h, "speed-up", 6);
    }
    if (
      !midway &&
      sim.tallies.some((tally) => tally >= Math.ceil(CONSTELLATION_TARGET / 2))
    ) {
      midway = true;
      await stills("running");
    }
    if (sim.status === "complete") {
      completed = true;
      break;
    }
    if (sim.status === "faulted") break;
  }
  const runFrames = h.frame() - start - buildFrames;

  // The solved panel, held long enough to read.
  if (completed) {
    await stills("solved");
    await h.advance(SOLVED_LINGER);
  }

  const frames = h.frame() - start;
  return {
    take,
    name,
    frames,
    seconds: frames / TICK_HZ,
    parts: built.editor.parts.length,
    period: built.editor.period,
    cycles,
    completed,
    buildFrames,
    runFrames,
  };
}

/* -------------------------------------------------------------------------- */
/* Standing the build up                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A harness with the produced art already in it.
 *
 * The engine's loader fetches and decodes on its own promises, so the game is
 * given a stretch of frames to finish loading before anything is recorded — and
 * the result is CHECKED, because a clip drawn entirely from the fallback shapes
 * would be a picture of a bare Node process rather than of the game.
 */
async function warmed(): Promise<Harness> {
  const h = await createHarness();
  await h.advance(90);
  if (h.assetFailures.length > 0) {
    await h.dispose();
    throw new Error(
      `the reference's produced assets did not load: ` +
        h.assetFailures.map((failure) => failure.path).join(", "),
    );
  }
  const sources = distinctSources(await h.lastCalls());
  if (sources.length === 0) {
    await h.dispose();
    throw new Error(
      "the title frame drew no decoded image, so this take would show the " +
        "build's fallback shapes rather than the art it produced",
    );
  }
  return QA_STILLS ? watched(h) : h;
}

/**
 * The same harness, writing a still every {@link QA_EVERY} frames.
 *
 * Purely for eyeballing a take: a strip of frames across the whole of it, the
 * build included, is how the pacing above was settled. It writes nothing when
 * the media directory is unset, like every other write here.
 */
function watched(h: Harness): Harness {
  const advance = h.advance.bind(h);
  let last = h.frame();
  const wrapped = async (frames = 1): Promise<void> => {
    await advance(frames);
    const now = h.frame();
    if (Math.floor(now / QA_EVERY) > Math.floor(last / QA_EVERY)) {
      await captureStill(h, `qa-${String(now).padStart(5, "0")}`);
    }
    last = now;
  };
  return Object.assign(Object.create(h) as Harness, { advance: wrapped });
}

/* -------------------------------------------------------------------------- */
/* The audition, and the recording                                            */
/* -------------------------------------------------------------------------- */

/** How watchable a measured take is. Higher is better; `null` disqualifies it. */
function score(measured: Measured): number | null {
  if (!measured.completed) return null;
  if (measured.seconds < MIN_SECONDS || measured.seconds > MAX_SECONDS) {
    return null;
  }
  // A richer machine is a better preview, and a take that spends about as long
  // being built as it does running reads as one sitting rather than as two.
  const balance =
    1 - Math.abs(measured.buildFrames - measured.runFrames) / measured.frames;
  return measured.parts * 10 + measured.period + balance * 20;
}

/** One line of the audition's report. */
function report(measured: Measured, chosen: number | null): string {
  return [
    takeName(measured.take).padEnd(12),
    measured.name.padEnd(22),
    `${measured.seconds.toFixed(1)}s`.padStart(7),
    `${String(measured.parts)} parts`.padStart(9),
    `period ${String(measured.period)}`.padStart(11),
    `${String(measured.cycles)} cycles`.padStart(11),
    measured.completed ? "complete" : "UNFINISHED",
    chosen === null ? "— out of bounds" : `score ${chosen.toFixed(1)}`,
  ].join("  ");
}

/**
 * Play one take on a fresh, warmed build under the recorder, writing its replay
 * and its three stills under `prefix`, and answer what it was worth.
 */
async function record(take: Take, prefix: string): Promise<Measured> {
  const h = await warmed();
  try {
    return await captureReplay(h, `${prefix}solving-a-challenge`, () =>
      playTake(h, take, (id) => captureStill(h, `${prefix}${id}`)),
    );
  } finally {
    await h.dispose();
  }
}

/** The log line that closes a recording. */
function pacing(measured: Measured): string {
  return (
    `${measured.seconds.toFixed(1)}s at ${String(TICK_HZ)} frames a second, ` +
    `opening at ${String(SPEEDS[DEFAULT_SPEED_INDEX])} cycles a second`
  );
}

it(
  "records the base variant's showcase from the reference build",
  { timeout: 60 * 60 * 1000 },
  async () => {
    const named = parseTake(NAMED_TAKE);

    if (named !== null) {
      console.log(
        `orrery showcase: recording the named take ${takeName(named)}`,
      );
      const measured = await record(named, "");
      console.log(report(measured, score(measured)));
      if (!measured.completed) {
        throw new Error(
          `${takeName(named)} did not complete, so the recorded take ends on ` +
            "nothing",
        );
      }
      console.log(`orrery showcase: ${pacing(measured)}`);
      return;
    }

    const candidates = AUDITION.split(",")
      .map(parseTake)
      .filter((take): take is Take => take !== null);
    let best: { measured: Measured; score: number } | null = null;
    for (const take of candidates) {
      const measured = await record(take, takePrefix(take));
      const value = score(measured);
      console.log(report(measured, value));
      if (value !== null && (best === null || value > best.score)) {
        best = { measured, score: value };
      }
    }
    if (best === null) {
      throw new Error(
        "no auditioned take came in complete and within the bounds; widen " +
          "them, or name one with TCAB_SHOWCASE_TAKE to record it regardless",
      );
    }
    const prefix = takePrefix(best.measured.take);
    console.log(
      `orrery showcase: keep ${takeName(best.measured.take)}, written as ` +
        `${prefix}solving-a-challenge.json.gz, ${prefix}machine.png, ` +
        `${prefix}running.png and ${prefix}solved.png; ${pacing(best.measured)}`,
    );
  },
);
