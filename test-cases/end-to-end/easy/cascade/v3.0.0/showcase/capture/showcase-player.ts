// Cascade — the scripted player that captures the showcase. CAPTURE-ONLY: this
// file is never staged into a run and no validator imports it.
//
// WHAT IT DOES. It opens the reference build in a real browser and PLAYS: it
// clicks NEW GAME on the title screen with the real mouse, reads the deal the
// game dealt, plans a solve through `showcase-solitaire.ts`, and performs that
// plan one ordinary gesture at a time — a click on the stock, a drag of a run
// between columns, a double-click that sends a card home. Chromium records the
// page while it does, and the `.webm` it writes is the showcase's leading entry.
//
// THE DEAL IS THE GAME'S OWN. Nothing chooses it: the game shuffles when NEW
// GAME is clicked, the driver reads what it dealt, and a deal the planner cannot
// win inside the move budget is a take that is abandoned. So a capture is an
// AUDITION — several takes are played, each on the deal the game happened to
// deal, and the best of the ones that could be won is kept.
//
// NOTHING ON SCREEN IS POSED. The surface is only ever READ. `snapshot()` is
// read throughout — but a read changes nothing: it is how the driver CHECKS that
// the game did what the plan expected, and a divergence fails the capture rather
// than being papered over. Every card that moves on screen moved because the
// build's own rules accepted a mouse gesture. Nothing here calls `reset`,
// `move`, `autoMove`, `turnStock`, `deal`, `addCard`, `setScreen`, or any of the
// pose operations, and nothing here touches the clock: the game runs on its own
// animation frame, in real time, which is what makes the recording a recording
// of the game rather than of the harness.
//
// WHY THE MOUSE AND NOT `pointerDown`. `specs/controls.md` gives the surface's
// pointer operations the same path a real event takes, so either would drive the
// same rules — but only a real event exercises the build's own listeners, and a
// clip of the game should be a clip of the thing a player touches.

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Browser, BrowserContext, Page } from "playwright";
import { connectChromium } from "./chromium";
import {
  CARD_H,
  CARD_W,
  COLUMN_X,
  DOUBLE_CLICK_SLOP,
  DOUBLE_CLICK_WINDOW,
  DRAG_THRESHOLD,
  STAGE_H,
  STAGE_W,
  STOCK_X,
  TABLEAU_Y,
  TITLE_NEW_GAME_ITEM,
  TOP_ROW_Y,
  WASTE_X,
} from "./constants";
import {
  type CascadeSnapshot,
  type CardView,
  type MenuRect,
  type Point,
  columnCardTops,
  facesOf,
  rectCenter,
} from "./harness";
import {
  type Deal,
  type Move,
  type Position,
  type SearchLimits,
  SUITS,
  apply,
  cardsHome,
  codeOf,
  describe,
  isWin,
  nameOf,
  positionFor,
  solve,
} from "./showcase-solitaire";

/** The handle the engineless build installs its surface on. */
const HANDLE = "__cascade";

/** How long to wait for that surface before giving up on the page. */
const SURFACE_TIMEOUT_MS = 10_000;

/** Wait `ms`, and answer at once for anything that has already gone by. */
const sleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((done) => setTimeout(done, ms));

/* -------------------------------------------------------------------------- */
/* Pacing                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * How long each part of a gesture takes, in milliseconds of real time.
 *
 * These are the clip's pacing, and they are the one thing worth tuning by eye: a
 * take that is too quick reads as a machine and one that is too slow spends the
 * carousel's budget on a lull.
 *
 * EVERY FIGURE IS A FLOOR, NOT A SLEEP. A mouse event costs a round trip to the
 * browser and the browser answers it on its next frame, so a pointer move already
 * takes about a sixtieth of a second whatever this file asks for — which is
 * exactly the rate a smooth glide wants. So a glide asks for a DURATION and a
 * number of samples, spends what the round trips cost, and sleeps only the
 * remainder. The take then runs at the same speed on a fast host and a slow one,
 * and the pointer is sampled about once per drawn frame either way.
 */
export interface Pace {
  /** Gliding the pointer to where the next gesture starts. */
  approachMs: number;
  approachSteps: number;
  /** Carrying a lifted run to its target. */
  carryMs: number;
  carrySteps: number;
  /** Between the two clicks of a double click. Must stay inside the window. */
  doubleGapMs: number;
  /** The beat after a gesture, before the next one begins. */
  settleMs: number;
  /** The title screen, before NEW GAME is clicked. */
  titleMs: number;
  /** The freshly dealt table, before the first gesture. */
  dealMs: number;
  /** How much of the victory cascade the clip keeps. */
  cascadeMs: number;
}

export const DEFAULT_PACE: Pace = {
  // The approach is a single move, because nothing on screen follows the pointer
  // while nothing is in hand: the game draws no cursor of its own, and a browser's
  // screencast does not record the one the machine draws. What a viewer sees of a
  // gesture is the card being carried, so that is where the samples go.
  approachMs: 40,
  approachSteps: 1,
  carryMs: 190,
  carrySteps: 8,
  doubleGapMs: 60,
  settleMs: 80,
  titleMs: 800,
  dealMs: 640,
  cascadeMs: 2900,
};

/* -------------------------------------------------------------------------- */
/* Reading the game                                                            */
/* -------------------------------------------------------------------------- */

/** Call one operation of the build's surface. */
async function call(
  page: Page,
  operation: string,
  args: unknown[] = [],
): Promise<unknown> {
  return page.evaluate(
    ([handle, name, rest]) =>
      (
        window as unknown as Record<
          string,
          Record<string, (...a: unknown[]) => unknown>
        >
      )[handle][name](...rest),
    [HANDLE, operation, args] as const,
  );
}

async function snapshot(page: Page): Promise<CascadeSnapshot> {
  return (await call(page, "snapshot")) as CascadeSnapshot;
}

/**
 * Where the build drew item `index` of the menu the current screen shows, as
 * the surface's `menuItemRect` reports it. A reading, like `snapshot`: the
 * layout is the build's own, so the driver asks rather than assumes.
 */
async function menuItemRect(page: Page, index: number): Promise<MenuRect> {
  const rect = (await call(page, "menuItemRect", [index])) as MenuRect | null;
  if (rect === null) {
    throw new Error(
      `cascade: menuItemRect(${index}) reports no item on the current screen`,
    );
  }
  return rect;
}

/** The face-down cards of a column, which are always the ones at its head. */
function downCount(column: readonly CardView[]): number {
  let count = 0;
  while (count < column.length && !column[count].faceUp) count += 1;
  return count;
}

/** The game's own state, as the plan's model reads it. */
export function positionOf(state: CascadeSnapshot): Position {
  // The model holds one rank per SUIT rather than per foundation slot, because
  // which slot a suit claimed is the game's own business: the first Ace played
  // takes the first empty foundation (`specs/foundations.md`).
  const foundations = [0, 0, 0, 0];
  for (const pile of state.foundations) {
    const top = pile[pile.length - 1];
    if (top !== undefined) foundations[SUITS.indexOf(top.suit)] = top.rank;
  }
  return {
    columns: state.tableau.map((column) =>
      column.map((card) => codeOf(card.suit, card.rank)),
    ),
    down: state.tableau.map(downCount),
    foundations,
    stock: state.stock.map((card) => codeOf(card.suit, card.rank)),
    waste: state.waste.map((card) => codeOf(card.suit, card.rank)),
  };
}

/** The deal the game dealt, as the planner's model reads one. */
function dealOf(state: CascadeSnapshot): Deal {
  return {
    columns: state.tableau.map((column) =>
      column.map((card) => codeOf(card.suit, card.rank)),
    ),
    stock: state.stock.map((card) => codeOf(card.suit, card.rank)),
  };
}

/**
 * A position as one line: every pile, in order, with a face-down card written as
 * the card it is under a leading dot.
 *
 * It is both the failure message and the comparison — two positions are the same
 * exactly when they read the same — so a divergence can never be reported as
 * something the reader cannot see.
 */
function showPosition(position: Position): string {
  const columns = position.columns
    .map(
      (column, index) =>
        `${index}:[${column
          .map((code, row) =>
            row < position.down[index] ? `.${nameOf(code)}` : nameOf(code),
          )
          .join(" ")}]`,
    )
    .join(" ");
  const stock = position.stock.map(nameOf).join(" ");
  const waste = position.waste.map(nameOf).join(" ");
  return `${columns} F:[${position.foundations.join("/")}] S:[${stock}] W:[${waste}]`;
}

function samePosition(a: Position, b: Position): boolean {
  return showPosition(a) === showPosition(b);
}

/* -------------------------------------------------------------------------- */
/* The pointer                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The real mouse, moved the way a hand moves it.
 *
 * It also keeps the game's double-click rule honest in both directions. A press
 * within `DOUBLE_CLICK_SLOP` of the previous one and inside `DOUBLE_CLICK_WINDOW`
 * IS a double click (`specs/controls.md`), which is how a card is sent home — and
 * which is also how two unrelated gestures at nearly the same spot turn into an
 * auto-move nobody asked for. So a gesture that means to double-click presses
 * twice in the same place at once, and a gesture that does not is nudged to a
 * different part of the same card, or waited out.
 */
class Hand {
  private at: Point = { x: STAGE_W / 2, y: STAGE_H - 60 };
  private lastPress: Point = { x: -1000, y: -1000 };

  constructor(private readonly page: Page) {}

  get position(): Point {
    return this.at;
  }

  /**
   * Glide to a point over `ms`, easing in and out, sampling `steps` times.
   *
   * Each sample costs what it costs; the wait after it is only what is left of
   * that sample's share of `ms`.
   */
  async glide(to: Point, ms: number, steps: number): Promise<void> {
    const from = this.at;
    const budget = ms / steps;
    for (let i = 1; i <= steps; i += 1) {
      const began = Date.now();
      const t = i / steps;
      const eased = t * t * (3 - 2 * t);
      await this.page.mouse.move(
        from.x + (to.x - from.x) * eased,
        from.y + (to.y - from.y) * eased,
      );
      await sleep(budget - (Date.now() - began));
    }
    this.at = to;
  }

  /**
   * Make sure a press here cannot be read as the second click of whatever
   * gesture came before it, waiting out the window when it would be.
   *
   * The wait is on the GAME'S clock rather than the wall clock, because the
   * double-click window is measured in the game's own time (`specs/controls.md`)
   * and a page that has just been asked to render a full table can spend longer
   * on a frame than the frame is worth. Two gestures in a row on the same pile
   * normally land far enough apart that this does nothing at all — see
   * {@link columnPoint} and {@link wastePoint}.
   */
  async separate(point: Point): Promise<void> {
    const near =
      Math.hypot(point.x - this.lastPress.x, point.y - this.lastPress.y) <=
      DOUBLE_CLICK_SLOP + 4;
    if (!near) return;
    await this.page.waitForFunction(
      ([handle, window_]) => {
        const state = (
          window as unknown as Record<
            string,
            {
              snapshot(): { simTime: number; lastPress: { at: number } | null };
            }
          >
        )[handle].snapshot();
        return (
          state.lastPress === null ||
          state.simTime - state.lastPress.at > window_
        );
      },
      [HANDLE, DOUBLE_CLICK_WINDOW + 0.02] as const,
      { polling: "raf", timeout: 5000 },
    );
  }

  /**
   * Press, and wait for the FRAME that reads the press.
   *
   * A pointer event is buffered when it arrives and taken by the next frame the
   * game runs (`specs/controls.md`), so a press that Chromium has acknowledged is
   * not yet a press the game has seen. Waiting for the game's own reading of the
   * button is what makes each gesture a thing that happened rather than a thing
   * that was sent, and it is why the run in hand can be read straight afterwards.
   */
  async down(): Promise<void> {
    await this.page.mouse.down();
    this.lastPress = this.at;
    await this.read(true);
  }

  /** Release, and wait for the frame that reads the release. */
  async up(): Promise<void> {
    await this.page.mouse.up();
    await this.read(false);
  }

  private async read(down: boolean): Promise<void> {
    await this.page.waitForFunction(
      ([handle, want]) =>
        (
          window as unknown as Record<
            string,
            { snapshot(): { pointer: { down: boolean } } }
          >
        )[handle].snapshot().pointer.down === want,
      [HANDLE, down] as const,
      { polling: "raf", timeout: 5000 },
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Where a gesture starts and where it ends                                    */
/* -------------------------------------------------------------------------- */

/** The centre of the stock, which a click turns. */
const STOCK_POINT: Point = {
  x: STOCK_X + CARD_W / 2,
  y: TOP_ROW_Y + CARD_H / 2,
};

/**
 * Where to press to take hold of the waste's playable card.
 *
 * The waste answers a press inside its ANCHOR footprint whatever its shown set
 * fans to (`specs/table.md`), so under Draw Three the point that both lies in
 * that rectangle and lies under the card actually being lifted is the anchor's
 * right-hand end — a three-card fan reaches from `398` to `498`, and the anchor
 * ends at `446`. Under Draw One the two are the same place.
 */
function wastePoint(alternate: number): Point {
  // Two places rather than one, alternating, so two gestures on the waste in a
  // row are never inside the double-click slop of each other.
  return {
    x: WASTE_X + CARD_W - 12,
    y: TOP_ROW_Y + (alternate % 2 === 0 ? 40 : 108),
  };
}

/**
 * Where to press to take hold of the card at `row` of column `index`, and the
 * whole run beneath it.
 *
 * The card drawn over every other card at a point is the LOWEST whose footprint
 * contains it (`specs/controls.md`), so a press meant for a card that is
 * overlapped has to land in the strip of it that nothing covers: between its own
 * top edge and the top edge of the card below it. The lowest card of a column is
 * covered by nothing and is pressed at its middle.
 *
 * `alternate` picks which corner of that strip the press lands in. Two gestures
 * in a row on the same card land in different corners, more than
 * `DOUBLE_CLICK_SLOP` apart, so neither is read as the other's second click.
 */
function columnPoint(
  index: number,
  column: readonly CardView[],
  row: number,
  alternate = 0,
): Point {
  const tops = columnCardTops(facesOf(column));
  const top = tops[row];
  const below = tops[row + 1];
  const band = Math.min(below === undefined ? CARD_H : below - top, CARD_H);
  const side = alternate % 2 === 0 ? -1 : 1;
  const lift = Math.min(22, Math.max(0, band / 2 - 5));
  return {
    x: COLUMN_X[index] + CARD_W / 2 + side * 26,
    y: top + band / 2 + side * lift,
  };
}

/**
 * Where the leading card of a run will come to rest on column `to`.
 *
 * Aiming the release there rather than at the middle of the pile's drop
 * rectangle is what makes the drop LOOK like a drop: the card is let go exactly
 * where it lands. It resolves to the same pile either way, because a run's
 * leading card sits within its own height of the column's lowest card and the
 * column answers a release anywhere from `TABLEAU_Y` down to that card's bottom
 * edge (`specs/table.md`).
 */
function landingTopLeft(
  to: number,
  column: readonly CardView[],
  run: readonly boolean[],
): Point {
  if (column.length === 0) {
    return { x: COLUMN_X[to], y: TABLEAU_Y };
  }
  const after = [...facesOf(column), ...run];
  const tops = columnCardTops(after);
  return { x: COLUMN_X[to], y: tops[column.length] };
}

/* -------------------------------------------------------------------------- */
/* One take                                                                    */
/* -------------------------------------------------------------------------- */

export interface TakeRequest {
  /** How many cards a turn of the stock moves: `1` or `3`. */
  turnCount: number;
  /** Where this take's media goes. Nothing is written when it is absent. */
  outDir?: string;
  /** Whether Chromium records the page. A take with no `outDir` never does. */
  record: boolean;
  /** How hard to look for a plan, and how long a plan may be. */
  search: SearchLimits;
  pace?: Pace;
  /**
   * How far into the plan to start looking for the mid-play still, as a share of
   * its gestures. The still is taken in the beat after a gesture, so the table is
   * always at rest in it.
   */
  midStillAt?: number;
  /** What to re-encode the recording at, as an ffmpeg bitrate (`380k`). */
  bitrate?: string;
  /** Print each gesture as it is made. */
  verbose?: boolean;
}

export interface TakeReport {
  /**
   * Whether the deal the game dealt could be won inside the move budget. A take
   * that could not is abandoned before a single gesture, and every other field
   * below is zero.
   */
  solved: boolean;
  moves: number;
  /** Turns of the stock, and how many of them brought the waste back around. */
  turns: number;
  recycles: number;
  /** Cards carried between piles, which is what the clip is worth watching for. */
  drags: number;
  /** How long the take ran, wall clock, in seconds. */
  seconds: number;
  /** The longest stretch with no card moving, in seconds. */
  longestLull: number;
  /** Consecutive stock turns, at their longest. */
  longestTurnRun: number;
  /** What was written, by name. */
  files: string[];
}

/**
 * Play one whole game on whatever deal the game deals and, when asked, record
 * it.
 *
 * The plan is a function of the deal alone and the pace is fixed, so what a take
 * shows is decided by the deal the game happened to shuffle. A deal the planner
 * cannot win inside the move budget ends the take before its first gesture, with
 * `solved` false and nothing written; {@link auditionTakes} is what plays takes
 * until enough have been won.
 */
export async function captureTake(
  browserWs: string,
  url: string,
  request: TakeRequest,
): Promise<TakeReport> {
  const pace = request.pace ?? DEFAULT_PACE;
  const files: string[] = [];

  const browser: Browser = await connectChromium(browserWs, {
    slug: "cascade",
  });
  const context: BrowserContext = await browser.newContext({
    viewport: { width: STAGE_W, height: STAGE_H },
    deviceScaleFactor: 1,
    ...(request.record && request.outDir !== undefined
      ? {
          recordVideo: {
            dir: request.outDir,
            size: { width: STAGE_W, height: STAGE_H },
          },
        }
      : {}),
  });
  const page = await context.newPage();
  const problems: string[] = [];
  page.on("pageerror", (error) =>
    problems.push(String(error.message || error)),
  );
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });

  try {
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(
      (handle) =>
        typeof (window as never)[handle] === "object" &&
        (window as never)[handle] !== null,
      HANDLE,
      { timeout: SURFACE_TIMEOUT_MS },
    );

    const hand = new Hand(page);
    await hand.glide({ x: STAGE_W / 2, y: 620 }, 300, 8);

    // One mouse position, checked against the game's own reading of it, so a
    // take cannot be driven at coordinates the page maps somewhere else.
    await hand.glide({ x: 400, y: 300 }, 60, 3);
    const aimed = await snapshot(page);
    if (
      Math.abs(aimed.pointer.x - 400) > 1 ||
      Math.abs(aimed.pointer.y - 300) > 1
    ) {
      throw new Error(
        `cascade: the page maps a mouse at (400, 300) to (${aimed.pointer.x}, ${aimed.pointer.y}); the stage is not 1:1 with the window`,
      );
    }
    if (aimed.screen !== "title") {
      throw new Error(`cascade: the page opened on ${aimed.screen}`);
    }

    const started = Date.now();
    let lastEvent = started;
    let longestLull = 0;
    const beat = (): void => {
      longestLull = Math.max(longestLull, (Date.now() - lastEvent) / 1000);
      lastEvent = Date.now();
    };

    // The title screen, then NEW GAME: the deal comes from the game's own
    // control, pressed with the mouse, like everything after it.
    await hand.glide({ x: STAGE_W / 2, y: 560 }, 260, 7);
    if (request.outDir !== undefined) {
      const name = "title.png";
      await page.screenshot({ path: `${request.outDir}/${name}` });
      files.push(name);
    }
    await sleep(pace.titleMs);
    await hand.glide(
      rectCenter(await menuItemRect(page, TITLE_NEW_GAME_ITEM)),
      pace.approachMs,
      pace.approachSteps,
    );
    await hand.down();
    await hand.up();
    beat();
    await sleep(pace.dealMs);

    const dealt = await snapshot(page);
    if (dealt.screen !== "playing") {
      throw new Error(`cascade: NEW GAME left the game on ${dealt.screen}`);
    }

    // The plan, made against the deal the game dealt. A deal that cannot be won
    // inside the limits ends the take here: the page is closed, its recording is
    // discarded, and the next take deals afresh.
    const deal = dealOf(dealt);
    const { plan } = solve(deal, request.turnCount, request.search);
    if (plan === null) {
      return {
        solved: false,
        moves: 0,
        turns: 0,
        recycles: 0,
        drags: 0,
        seconds: 0,
        longestLull: 0,
        longestTurnRun: 0,
        files: [],
      };
    }

    // The clip is a recording of real time, so the page has to be RUNNING in real
    // time: the double-click window, the cascade's launch interval and every
    // pace figure below are all measured in the game's own seconds. A page whose
    // animation frame the browser has throttled would still play a correct game,
    // slowly, and the clip would be worthless — so it is caught here rather than
    // discovered in the file.
    const paced = await page.evaluate(
      async ([handle, ms]) => {
        const api = (
          window as unknown as Record<
            string,
            { snapshot(): { simTime: number } }
          >
        )[handle];
        const before = api.snapshot().simTime;
        await new Promise((done) => setTimeout(done, ms));
        return api.snapshot().simTime - before;
      },
      [HANDLE, 500] as const,
    );
    if (paced < 0.4) {
      throw new Error(
        `cascade: the page advanced ${paced.toFixed(3)} s of game time in half a second of real time; it is being throttled`,
      );
    }

    const model = positionFor(deal);
    const figures = scorePlan(plan, deal, request.turnCount);
    // The mid-play still is taken at the first settled moment past this share of
    // the plan at which the table is worth a picture: the stock still holding
    // cards, the waste showing everything a turn of this deal mode shows, and
    // enough home for the foundations to have started.
    const midFrom = Math.round((request.midStillAt ?? 0.3) * plan.length);
    let midTaken = false;
    let longestTurnRun = 0;
    let turnRun = 0;

    // The table as it stands, carried from one gesture to the next: what the game
    // was read to be after a gesture is what it still is when the next one starts,
    // and a crossing into the page costs about a frame of the clip.
    let table = dealt;

    for (const [index, move] of plan.entries()) {
      turnRun = move.kind === "turn" ? turnRun + 1 : 0;
      longestTurnRun = Math.max(longestTurnRun, turnRun);

      await perform(page, hand, pace, table, move, index);
      if (!apply(model, move, request.turnCount)) {
        throw new Error(
          `cascade: the plan's own model refused ${describe(move)} at gesture ${index}`,
        );
      }
      beat();
      await sleep(pace.settleMs);

      table = await snapshot(page);
      // The gesture that sends the fifty-second card home wins the game, and the
      // victory cascade begins on that very frame — it takes cards back off the
      // foundations and puts them in the air (`specs/victory.md`), so by the time
      // this reads the table there is nothing left to compare. What is checked
      // there is the thing that matters: that the GAME decided it had been won.
      if (isWin(model)) {
        if (table.screen !== "won") {
          throw new Error(
            `cascade: every card is home but the game is still on ${table.screen}`,
          );
        }
      } else {
        const seen = positionOf(table);
        if (!samePosition(seen, model)) {
          throw new Error(
            `cascade: gesture ${index} (${describe(move)}) did not do what the plan expected\n` +
              `  planned: ${showPosition(model)}\n` +
              `  the game: ${showPosition(seen)}`,
          );
        }
      }
      if (request.verbose === true) {
        process.stdout.write(
          `  ${String(index).padStart(3)} ${describe(move)} — ${cardsHome(model)} home\n`,
        );
      }
      // The picture wanted is the stock still holding cards, the waste showing
      // everything a turn of this deal mode shows, and the foundations under way.
      // Past four fifths of the plan that becomes unlikely — the stock empties —
      // so from there any settled table will do rather than none at all.
      const wanted =
        table.stock.length > 0 &&
        table.wasteVisibleCount >= request.turnCount &&
        cardsHome(model) >= 4;
      if (
        !midTaken &&
        index >= midFrom &&
        request.outDir !== undefined &&
        table.screen === "playing" &&
        (wanted || index >= Math.round(plan.length * 0.8))
      ) {
        const name = "mid-play.png";
        await page.screenshot({ path: `${request.outDir}/${name}` });
        files.push(name);
        midTaken = true;
      }
    }

    // The win, which the game declared for itself, and the cascade it opens.
    const won = await snapshot(page);
    if (won.screen !== "won") {
      throw new Error(
        `cascade: the plan finished with ${cardsHome(model)} cards home but the game is on ${won.screen}`,
      );
    }
    // Nothing is touched from here: a press on the won screen deals a fresh game
    // (`specs/controls.md`), so the hand is taken off the table and the cascade
    // is left to run.
    await hand.glide({ x: STAGE_W - 40, y: STAGE_H - 30 }, 400, 8);
    await sleep(pace.cascadeMs);
    // The cascade's still is taken here, at the end, rather than partway through:
    // a screenshot stops the page for a moment, and a moment of stopped page in
    // the middle of fifty-two cards in flight is a stutter in the clip. Taken
    // after the last thing the clip needed, it costs the recording nothing.
    if (request.outDir !== undefined) {
      const name = "the-cascade.png";
      await page.screenshot({ path: `${request.outDir}/${name}` });
      files.push(name);
    }

    const end = await snapshot(page);
    if (end.launched < 1) {
      throw new Error("cascade: the victory cascade launched nothing");
    }
    if (problems.length > 0) {
      throw new Error(`cascade: the page reported ${problems[0]}`);
    }

    const seconds = (Date.now() - started) / 1000;
    const video = page.video();
    await context.close();
    if (video !== null && request.record && request.outDir !== undefined) {
      const name = "cascade-solved.webm";
      const raw = join(request.outDir, "cascade-solved.raw.webm");
      await video.saveAs(raw);
      await video.delete().catch(() => undefined);
      compress(raw, join(request.outDir, name), request.bitrate ?? "380k");
      files.push(name);
    }
    return {
      solved: true,
      moves: plan.length,
      turns: figures.turns,
      recycles: figures.recycles,
      drags: figures.drags,
      seconds: Number(seconds.toFixed(1)),
      longestLull: Number(longestLull.toFixed(2)),
      longestTurnRun,
      files,
    };
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

/* -------------------------------------------------------------------------- */
/* The recording, made small enough to be a page cost                          */
/* -------------------------------------------------------------------------- */

/**
 * The ffmpeg Playwright brought with it, which is the one that wrote the
 * recording in the first place.
 *
 * Found the way `chromium.ts` finds a browser: an explicit path first, then the
 * browser cache this host actually has. Nothing else on the machine is asked for,
 * so a capture needs no tool a Playwright install does not already carry.
 */
function bundledFfmpeg(): string | null {
  const explicit = process.env.TCAB_SHOWCASE_FFMPEG;
  if (explicit !== undefined && explicit !== "") return explicit;
  const base =
    process.env.PLAYWRIGHT_BROWSERS_PATH ||
    join(homedir(), ".cache", "ms-playwright");
  let names: string[];
  try {
    names = readdirSync(base);
  } catch {
    return null;
  }
  for (const name of names.sort().reverse()) {
    if (!/^ffmpeg-\d+$/.test(name)) continue;
    for (const binary of ["ffmpeg-linux", "ffmpeg-mac", "ffmpeg-win64.exe"]) {
      const candidate = join(base, name, binary);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Re-encode the recording at a bitrate a carousel can afford.
 *
 * Chromium writes its screencast at whatever the recorder felt like, which for a
 * clip of this length is several megabytes — and the catalog's preview stage
 * fetches the leading entry the moment a visitor picks the case, so its weight is
 * a page cost. One VP8 pass at a fixed bitrate takes the same pictures down to
 * about a third of that with no visible difference on a table of flat colour and
 * crisp type.
 *
 * IT CHANGES NOTHING ABOUT WHAT THE CLIP SHOWS. Same frames, same order, same
 * timing; only the compression is different — the publish pipeline re-encodes it
 * again on its way to `.mp4` regardless. A host with no ffmpeg keeps the
 * recording exactly as Chromium wrote it, and says so.
 */
function compress(raw: string, destination: string, bitrate: string): void {
  const ffmpeg = bundledFfmpeg();
  if (ffmpeg === null) {
    process.stdout.write(
      "cascade: no ffmpeg found, keeping the recording as Chromium wrote it\n",
    );
    renameSync(raw, destination);
    return;
  }
  const result = spawnSync(
    ffmpeg,
    [
      "-v",
      "error",
      "-y",
      "-i",
      raw,
      "-c:v",
      "libvpx",
      "-b:v",
      bitrate,
      "-crf",
      "33",
      "-g",
      "240",
      "-deadline",
      "good",
      "-cpu-used",
      "2",
      "-threads",
      "8",
      "-auto-alt-ref",
      "1",
      "-lag-in-frames",
      "25",
      "-an",
      destination,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0 || !existsSync(destination)) {
    process.stdout.write(
      `cascade: ffmpeg would not re-encode (${result.stderr?.trim() ?? result.error?.message ?? "no output"}), keeping the recording as Chromium wrote it\n`,
    );
    renameSync(raw, destination);
    return;
  }
  process.stdout.write(
    `cascade: recording ${(statSync(raw).size / 1e6).toFixed(2)} MB -> ${(statSync(destination).size / 1e6).toFixed(2)} MB at ${bitrate}\n`,
  );
  unlinkSync(raw);
}

/* -------------------------------------------------------------------------- */
/* The gestures                                                                */
/* -------------------------------------------------------------------------- */

/** Make the one gesture `move` calls for, against the table as it stands. */
async function perform(
  page: Page,
  hand: Hand,
  pace: Pace,
  state: CascadeSnapshot,
  move: Move,
  /** Which gesture of the plan this is, which decides where on a card it lands. */
  index: number,
): Promise<void> {
  switch (move.kind) {
    case "turn":
      await click(hand, pace, STOCK_POINT);
      return;
    case "waste-home":
      await doubleClick(hand, pace, wastePoint(index));
      return;
    case "column-home": {
      const column = state.tableau[move.from];
      await doubleClick(
        hand,
        pace,
        columnPoint(move.from, column, column.length - 1, index),
      );
      return;
    }
    case "waste-column": {
      const run = [true];
      await drop(
        page,
        hand,
        pace,
        wastePoint(index),
        landingTopLeft(move.to, state.tableau[move.to], run),
      );
      return;
    }
    case "column-column": {
      const column = state.tableau[move.from];
      const row = column.length - move.count;
      const run = column.slice(row).map(() => true);
      await drop(
        page,
        hand,
        pace,
        columnPoint(move.from, column, row, index),
        landingTopLeft(move.to, state.tableau[move.to], run),
      );
      return;
    }
  }
}

/** A press and a release in the same place, which is a click. */
async function click(hand: Hand, pace: Pace, at: Point): Promise<void> {
  await hand.glide(at, pace.approachMs, pace.approachSteps);
  await hand.separate(at);
  await hand.down();
  await hand.up();
}

/**
 * Two clicks in the same place, inside the window and the slop, which is what
 * sends a card home (`specs/controls.md`).
 */
async function doubleClick(hand: Hand, pace: Pace, at: Point): Promise<void> {
  // The first press of a double click must not be read as the SECOND press of
  // the gesture before it, which would send a card home unasked.
  await hand.glide(at, pace.approachMs, pace.approachSteps);
  await hand.separate(at);
  await hand.down();
  await hand.up();
  await sleep(pace.doubleGapMs);
  await hand.down();
  await hand.up();
}

/**
 * Lift whatever is under `from`, carry it so its leading card comes to rest with
 * its top-left at `landing`, and let it go.
 *
 * The run keeps the offset between the press point and its leading card's
 * top-left (`specs/controls.md`), and that offset is read off the game itself
 * after the press rather than worked out here, so a build that lifts a run at a
 * different offset is still carried to the place the plan named.
 */
async function drop(
  page: Page,
  hand: Hand,
  pace: Pace,
  from: Point,
  landing: Point,
): Promise<void> {
  await hand.glide(from, pace.approachMs, pace.approachSteps);
  await hand.separate(from);
  await hand.down();
  const after = await snapshot(page);
  const held = after.drag;
  if (held === null) {
    throw new Error(
      `cascade: a press at (${from.x}, ${from.y}) lifted nothing, so there is nothing to carry` +
        ` — the waste shows ${after.wasteVisibleCount} of ${after.waste.length},` +
        ` sets ${JSON.stringify(after.wasteSets)}, screen ${after.screen},` +
        ` last press ${JSON.stringify(after.lastPress)} at sim ${after.simTime.toFixed(3)}`,
    );
  }
  const to = {
    x: from.x + (landing.x - held.x),
    y: from.y + (landing.y - held.y),
  };
  if (Math.hypot(to.x - from.x, to.y - from.y) <= DRAG_THRESHOLD) {
    throw new Error(
      "cascade: the run has nowhere to travel, so the release would be a click",
    );
  }
  await hand.glide(to, pace.carryMs, pace.carrySteps);
  await hand.up();
}

/* -------------------------------------------------------------------------- */
/* What a plan promises, and the audition that picks a take                    */
/* -------------------------------------------------------------------------- */

/** What a plan promises about the take it would make. */
interface PlanFigures {
  turns: number;
  /** Turns made on an empty stock, each of which brings the waste back around. */
  recycles: number;
  /** Cards carried between piles, which is what the clip is worth watching for. */
  drags: number;
}

/** Read a plan's figures off the model, before a gesture is made. */
function scorePlan(
  plan: readonly Move[],
  deal: Deal,
  turnCount: number,
): PlanFigures {
  const position = positionFor(deal);
  let recycles = 0;
  for (const move of plan) {
    if (move.kind === "turn" && position.stock.length === 0) recycles += 1;
    apply(position, move, turnCount);
  }
  return {
    turns: plan.filter((move) => move.kind === "turn").length,
    recycles,
    drags: plan.filter(
      (move) => move.kind === "column-column" || move.kind === "waste-column",
    ).length,
  };
}

/** The four files a recorded take writes, and the order they are moved in. */
const TAKE_FILES = [
  "title.png",
  "mid-play.png",
  "the-cascade.png",
  "cascade-solved.webm",
] as const;

export interface AuditionRequest {
  turnCount: number;
  /** Where the winning take's media goes. Nothing is written when absent. */
  outDir?: string;
  /** How many won takes to play before choosing between them. */
  takes: number;
  /** How many deals to try before giving up on finding `takes` won ones. */
  deals: number;
  search: SearchLimits;
  pace?: Pace;
  midStillAt?: number;
  bitrate?: string;
  verbose?: boolean;
  /** Called with each take's report as it finishes. */
  report?: (take: number, report: TakeReport) => void;
}

export interface AuditionReport {
  /** Every won take, in the order it was played. */
  played: TakeReport[];
  /** The index into `played` of the take that was kept, or `-1` for none. */
  winner: number;
  /** How many deals were dealt, won or not. */
  dealt: number;
}

/**
 * Play takes until `takes` of them have been won, or `deals` deals have been
 * tried, and keep the best.
 *
 * Each won take is recorded into its own subdirectory of `outDir`, and once the
 * audition is over the winner's four files are moved up into `outDir` itself and
 * the rest are deleted. The winner is the shortest take, and among takes of the
 * same length the one with the shortest run of nothing but stock turns — the
 * figures that decide how long the clip runs and how long its longest lull is.
 * Nothing about the ordering is a judgement made for you beyond that: every
 * take's figures are reported, so a person can re-run for more.
 */
export async function auditionTakes(
  browserWs: string,
  url: string,
  request: AuditionRequest,
): Promise<AuditionReport> {
  const played: TakeReport[] = [];
  const dirs: string[] = [];
  let dealt = 0;

  while (played.length < request.takes && dealt < request.deals) {
    dealt += 1;
    const takeDir =
      request.outDir === undefined
        ? undefined
        : join(request.outDir, `take-${String(played.length + 1)}`);
    if (takeDir !== undefined) mkdirSync(takeDir, { recursive: true });

    const report = await captureTake(browserWs, url, {
      turnCount: request.turnCount,
      outDir: takeDir,
      record: takeDir !== undefined,
      search: request.search,
      pace: request.pace,
      midStillAt: request.midStillAt,
      bitrate: request.bitrate,
      verbose: request.verbose,
    });
    if (!report.solved) {
      if (takeDir !== undefined)
        rmSync(takeDir, { recursive: true, force: true });
      continue;
    }
    played.push(report);
    if (takeDir !== undefined) dirs.push(takeDir);
    request.report?.(played.length, report);
  }

  let winner = -1;
  for (const [index, report] of played.entries()) {
    if (winner < 0) {
      winner = index;
      continue;
    }
    const best = played[winner];
    if (
      report.moves < best.moves ||
      (report.moves === best.moves &&
        report.longestTurnRun < best.longestTurnRun)
    ) {
      winner = index;
    }
  }

  if (request.outDir !== undefined) {
    for (const [index, dir] of dirs.entries()) {
      if (index === winner) {
        for (const name of TAKE_FILES) {
          const from = join(dir, name);
          if (existsSync(from)) renameSync(from, join(request.outDir, name));
        }
      }
      rmSync(dir, { recursive: true, force: true });
    }
  }

  return { played, winner, dealt };
}

/* -------------------------------------------------------------------------- */
/* What a suite calls                                                          */
/* -------------------------------------------------------------------------- */

/** Read a whole-number environment knob, or its default. */
export function knob(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`cascade: ${name} is not a number: ${raw}`);
  }
  return value;
}
