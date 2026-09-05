// The words the readouts are made of.
//
// Every string the screen layer prints that is not fixed copy from
// `src/constants.ts` is composed here, away from the drawing, so what a readout
// says can be tested without a canvas. Nothing in this module draws, and
// nothing in it reads anything but its arguments.

import type { DeepReadonly } from "@clockwyrks/simple-3d";
import {
  FAIL_TEXT,
  RUN_SPEEDS,
  SITE_NAMES,
  TICK_HZ,
  type ActionName,
} from "./constants";
import type {
  AxisName,
  Command,
  FailCause,
  ReadonlyGantryState,
  Score,
  Step,
  Tool,
} from "./game";
import type { EditRefusal, StartIssue } from "./sim";
import {
  currentProgram,
  highlightedIndex,
  resultsItems,
  siteUnlocked,
} from "./state";

/** A number at a fixed number of places, with `-0` printed as `0`. */
export function fixed(value: number, places = 1): string {
  if (!Number.isFinite(value)) return "—";
  const text = value.toFixed(places);
  return text === "-" + (0).toFixed(places) ? (0).toFixed(places) : text;
}

/** A cost or a budget: whole force-free units, grouped for reading. */
export function cost(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** A run clock or a par time, in seconds. */
export const seconds = (value: number): string => `${fixed(value, 2)}s`;

/** The run clock at a tick (`specs/program.md`). */
export const clock = (tick: number): string => seconds(tick / TICK_HZ);

// ---- The axes --------------------------------------------------------------

/** The four axes in the order `specs/program.md` tabulates them. */
export const AXIS_ORDER: readonly AxisName[] = [
  "slew",
  "trolley",
  "hoist",
  "grip",
];

/** What each axis is called on screen, and the unit its value is read in. */
export const AXIS_LABEL: Readonly<Record<AxisName, string>> = {
  slew: "SLEW",
  trolley: "TROLLEY",
  hoist: "HOIST",
  grip: "GRIP",
};

const AXIS_UNIT: Readonly<Record<AxisName, string>> = {
  slew: "°",
  trolley: "u",
  hoist: "u",
  grip: "°",
};

/** An axis value with its unit, as every readout prints it. */
export const axisValue = (axis: AxisName, value: number): string =>
  `${fixed(value, 1)}${AXIS_UNIT[axis]}`;

/** One axis's line on the run screen: its value, and its target while live. */
export interface AxisReadout {
  readonly axis: AxisName;
  readonly label: string;
  readonly value: string;
  /** The live command's target, or `null` with no command on that axis. */
  readonly target: string | null;
  /** Whether the axis is turning, which the line marks. */
  readonly moving: boolean;
}

/** An axis as a readout reads it, whether the state's or a copy's. */
interface ReadableAxis {
  readonly value: number;
  readonly rate: number;
  readonly command: { readonly target: number } | null;
}

/** The four axis lines the run screen shows (`specs/ui.md`). */
export function axisReadouts(
  axes: Readonly<Record<AxisName, ReadableAxis>>,
): AxisReadout[] {
  return AXIS_ORDER.map((axis) => {
    const state = axes[axis];
    return {
      axis,
      label: AXIS_LABEL[axis],
      value: axisValue(axis, state.value),
      target:
        state.command === null ? null : axisValue(axis, state.command.target),
      moving: state.rate !== 0,
    };
  });
}

// ---- The tape --------------------------------------------------------------

/** One command, as `SLEW → 90.0° @ 30.0` (`specs/program.md`). */
export const commandText = (command: DeepReadonly<Command>): string =>
  `${AXIS_LABEL[command.axis]} → ${axisValue(command.axis, command.target)} @ ${fixed(
    command.rate,
    1,
  )}`;

/** One step's own line: what kind it is, and what it does. */
export function stepText(step: DeepReadonly<Step>): string {
  if (step.kind === "action") return step.action.toUpperCase();
  if (step.commands.length === 0) return "MOVE";
  return `MOVE  ${step.commands.map(commandText).join("   ")}`;
}

/**
 * The live step as `m / n` (`specs/ui.md`): `1 / n` before the first tick takes
 * a step and `n / n` once every step is complete. An empty tape reads `0 / 0`.
 */
export function stepCounter(stepIndex: number, length: number): string {
  if (length === 0) return "0 / 0";
  return `${Math.min(stepIndex + 1, length)} / ${length}`;
}

/** The watch speed, as `RUN_SPEEDS` cycles it. */
export const speedText = (index: number): string =>
  `×${RUN_SPEEDS[index] ?? RUN_SPEEDS[0]}`;

// ---- Readiness and failure -------------------------------------------------

/**
 * A short gloss for a start issue. The issue is always shown by its own name
 * (`specs/ui.md`); the gloss stands beside it so a player who has not read the
 * specification still knows what to do.
 */
export const ISSUE_GLOSS: Readonly<Record<StartIssue, string>> = {
  "no-ring": "place a slew ring on the tower",
  "no-rail": "lay rail for the trolley to run on",
  "invalid-rail": "the rails must form one straight arm track",
  "disconnected-members": "every member must reach an anchor or a flange",
  "empty-program": "the tape has no steps",
};

/** The fixed failure copy (`specs/ui.md`). */
export const failText = (cause: FailCause): string => FAIL_TEXT[cause];

/**
 * Why the editor would refuse an edit, in a player's words. `specs/ui.md` asks
 * only that a refusal be visible in the moment; the build screen shows this
 * line under the pointer, so a player reads why a click will do nothing before
 * making it as well as after.
 */
export const REFUSAL_TEXT: Readonly<Record<EditRefusal, string>> = {
  "off-lattice": "not a lattice node",
  "outside-envelope": "outside the build envelope",
  "same-node": "a member needs two different nodes",
  "too-long": "longer than this material allows",
  duplicate: "a member already joins those nodes",
  "inside-obstacle": "that reaches inside an obstacle",
  "rail-not-horizontal": "rail must be laid horizontal",
  "links-arm-tower": "that would join the arm to the tower",
  "over-budget": "that would take the cost past the budget",
  "ring-exists": "the crane already has a slew ring",
  "ring-on-ground": "the ring sits on a tower, not on the ground",
  "node-unused": "nothing to hang a counterweight on there",
  "counterweight-exists": "that node already carries a counterweight",
};

// ---- The build screen's palette of tools -----------------------------------

/** One entry of the tool palette: what it places, and the key that selects it. */
export interface ToolEntry {
  readonly tool: Tool;
  readonly label: string;
  readonly key: string;
  readonly selected: boolean;
}

const TOOL_LABEL: Readonly<Record<Tool, string>> = {
  strut: "STRUT",
  cable: "CABLE",
  rail: "RAIL",
  ring: "RING",
  counterweight: "WEIGHT",
  delete: "DELETE",
};

const TOOL_KEY: Readonly<Record<Tool, string>> = {
  strut: "1",
  cable: "2",
  rail: "3",
  ring: "4",
  counterweight: "5",
  delete: "6",
};

/** The palette, in the order the tool actions are bound (`specs/controls.md`). */
export function toolEntries(selected: Tool): ToolEntry[] {
  const order: Tool[] = [
    "strut",
    "cable",
    "rail",
    "ring",
    "counterweight",
    "delete",
  ];
  return order.map((tool) => ({
    tool,
    label: TOOL_LABEL[tool],
    key: TOOL_KEY[tool],
    selected: tool === selected,
  }));
}

// ---- The site select -------------------------------------------------------

/** The shape a site's state is marked with. */
export type SiteMark = "tick" | "arrow" | "cross";

/** One row of the site list (`specs/ui.md`). */
export interface SiteRow {
  readonly index: number;
  /** The displayed number: the index plus one. */
  readonly number: string;
  readonly name: string;
  readonly state: "locked" | "open" | "cleared";
  /**
   * The shape drawn beside the state, so a site reads without relying on hue
   * alone. It is a shape rather than a glyph so no font can fail to carry it.
   */
  readonly mark: SiteMark;
  readonly stateText: string;
  /** A cleared site's best score, or `null`. */
  readonly best: Score | null;
  readonly highlighted: boolean;
}

/** The six rows the site select lists, in order. */
export function siteRows(state: ReadonlyGantryState): SiteRow[] {
  const highlight = highlightedIndex(state);
  return SITE_NAMES.map((name, index) => {
    const cleared = state.cleared[index] === true;
    const unlocked = siteUnlocked(state, index);
    const which: SiteRow["state"] = cleared
      ? "cleared"
      : unlocked
        ? "open"
        : "locked";
    const best = state.best[index] ?? null;
    return {
      index,
      number: String(index + 1).padStart(2, "0"),
      name,
      state: which,
      mark: which === "cleared" ? "tick" : which === "open" ? "arrow" : "cross",
      stateText: which.toUpperCase(),
      best: best === null ? null : { cost: best.cost, time: best.time },
      highlighted: index === highlight,
    };
  });
}

/** The menu entries of whichever screen shows one, `null` where none does. */
export function menuEntries(
  state: ReadonlyGantryState,
): readonly string[] | null {
  if (state.screen === "title") return ["SITES", "HOW TO PLAY"];
  if (state.screen === "results") return resultsItems(state.siteIndex);
  return null;
}

/** How many steps the open site's tape carries, for the yard readout. */
export const programLength = (state: ReadonlyGantryState): number =>
  currentProgram(state).length;

// ---- How to play -----------------------------------------------------------

/** One block of the how-to page: a heading and the lines under it. */
export interface HowToSection {
  readonly heading: string;
  readonly lines: readonly string[];
}

const key = (action: ActionName): string =>
  ({
    up: "↑",
    down: "↓",
    left: "←",
    right: "→",
    "zoom-in": "=",
    "zoom-out": "-",
    confirm: "ENTER",
    back: "ESC",
    "tool-strut": "1",
    "tool-cable": "2",
    "tool-rail": "3",
    "tool-ring": "4",
    "tool-counterweight": "5",
    "tool-delete": "6",
    undo: "Z",
    check: "C",
    program: "P",
    build: "B",
    run: "G",
    speed: "S",
    mute: "M",
  })[action];

/** The how-to screen, in a player's words (`specs/ui.md`). */
export const HOW_TO: readonly HowToSection[] = [
  {
    heading: "READ THE SITE",
    lines: [
      "Mounts mark the anchors your crane is fixed to the ground at.",
      "Each load waits at its starting pose; its pad is the outlined",
      "footprint it must be set down on, with a notch showing the yaw",
      "it has to be turned to. Grey blocks are obstacles: nothing may",
      "reach inside one, at build time or while the tape runs.",
    ],
  },
  {
    heading: "BUILD",
    lines: [
      `Pick a tool — ${key("tool-strut")} strut, ${key("tool-cable")} cable, ${key("tool-rail")} rail, ${key("tool-ring")} slew ring,`,
      `${key("tool-counterweight")} counterweight, ${key("tool-delete")} delete — and click on the lattice.`,
      "A strut, a cable or a rail takes two clicks: the first node is",
      "held, the second places the member. Struts and rails push and",
      "pull; a cable only pulls, and goes slack under compression.",
      `${key("undo")} undoes the last edit, ${key("back")} drops a held node, and ${key("check")} solves`,
      "the crane where it stands and colours it by how hard each",
      "member is working. Watch the cost against the budget.",
    ],
  },
  {
    heading: "THE RING AND THE ARM",
    lines: [
      "The slew ring is the bearing everything turns on. Whatever the",
      "top flange carries is the arm and swings; whatever reaches the",
      "bottom flange or an anchor is the tower and stands still. Rail",
      "goes in the arm, in one straight unbroken run — that is the",
      "track the trolley drives along, and the hook hangs under it.",
    ],
  },
  {
    heading: "WRITE THE TAPE",
    lines: [
      `${key("program")} opens the tape, ${key("build")} goes back to building. A move step`,
      "drives one axis or several together to absolute targets: SLEW",
      "turns the arm, TROLLEY drives along the track, HOIST pays the",
      "cable out and in, GRIP turns the hook. ATTACH takes the load",
      "under the hook; RELEASE sets it down — on the pad, square, and",
      "nearly still, or it is dropped and the run is over.",
    ],
  },
  {
    heading: "SPEED COSTS STEEL",
    lines: [
      "A brisk rate loads the structure harder and swings the load",
      "wider. Overload a member and it breaks; overload the crane and",
      "it comes down. Your score is the crane's cost and the tape's",
      "running time, so cheap and brisk beats heavy and timid.",
    ],
  },
  {
    heading: "RUN AND WATCH",
    lines: [
      `${key("run")} runs the tape from either yard screen. ${key("speed")} cycles the watch`,
      `speed, ${key("back")} aborts. Drag the pointer or hold ${key("left")} ${key("right")} ${key("up")} ${key("down")} to orbit,`,
      `${key("zoom-in")} and ${key("zoom-out")} to zoom, and ${key("mute")} silences everything.`,
    ],
  },
];
