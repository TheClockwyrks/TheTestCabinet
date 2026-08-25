// The gg Dashboard's layout, across the two surfaces it is read on.
//
// The live monitor (`/runs/gg/:jobId/live`) and a finished run's gg tab
// (`/runs/:runId/gg`) render the *same* Dashboard over the same reduction of the same
// stream — the rich view is not something that changes shape once the run ends. The one
// deliberate difference is the status card, which the finished run omits because its page
// header already carries the run's state; everything below that must be identical, in the
// same order. These pin that, the error row (three sibling tiles of its own, so the
// consecutive peak and the type ranking are not footnotes to the total), the clocks row
// (four sibling tiles of its own, so the run's two clocks are not footnotes to one
// another), and the money row's own composition (Cost leading, Tokens beside it, the
// configuration under Tokens).

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type {
  GgCapabilitySet,
  GgTelemetryEvent,
  GgTelemetryKind,
} from "@test-cabinet/run-record/gg";
import type { HarnessEvent } from "../../../../client/types";
import { GgDashboard, type GgDashboardStatus } from "./GgDashboard";
import { deriveGgRuntime } from "./ggRuntime";
import { reduceGgEvents, reduceGgEventsPerAgent } from "./useGgRunState";

const TS = "2026-07-29T00:00:00Z";

function gg(
  agentId: string,
  kind: GgTelemetryKind,
  parentAgentId?: string,
): HarnessEvent {
  return {
    type: "gg",
    timestamp: TS,
    event: {
      timestamp: TS,
      sessionId: "s1",
      agentId,
      parentAgentId,
      ...kind,
    } as GgTelemetryEvent,
  };
}

// A two-profile, two-model run's worth of attributed usage deltas and turn timings — enough
// for the Cost widget to carry a spend split, with the root outspending the reviewer, and
// for the generation rate to be a blend of two different per-model rates. Every attribution
// names its profile by id; the names those ids read as are the configuration's business.
const EVENTS: HarnessEvent[] = [
  gg("root", { type: "turn_started", turn: 1 } as GgTelemetryKind),
  gg("root", {
    type: "agent_spawned",
    profileId: "root",
    modelId: "vendor/big",
    depth: 0,
  } as GgTelemetryKind),
  gg("root", {
    type: "usage",
    profileId: "root",
    modelId: "vendor/big",
    tokens: {
      uncachedInput: 4000,
      cachedInput: 500,
      output: 300,
      reasoning: 100,
    },
    cost: { comparable: 0.02, actual: 0.02 },
  } as GgTelemetryKind),
  // 400 generated tokens over 4s of model time — 100 tok/s.
  gg("root", {
    type: "turn_timing",
    promptMs: 10,
    requestMs: 4000,
    responseMs: 10,
  } as GgTelemetryKind),
  gg(
    "agent-0",
    {
      type: "agent_spawned",
      profileId: "reviewer",
      modelId: "vendor/small",
      depth: 1,
    } as GgTelemetryKind,
    "root",
  ),
  gg(
    "agent-0",
    {
      type: "usage",
      profileId: "reviewer",
      modelId: "vendor/small",
      tokens: {
        uncachedInput: 900,
        cachedInput: null,
        output: 100,
        reasoning: null,
      },
      cost: { comparable: 0.01, actual: 0.01 },
    } as GgTelemetryKind,
    "root",
  ),
  // 100 generated tokens over half a second — 200 tok/s.
  gg(
    "agent-0",
    {
      type: "turn_timing",
      promptMs: 10,
      requestMs: 500,
      responseMs: 10,
    } as GgTelemetryKind,
    "root",
  ),
];

// Both profiles the fixture's attributions name, so the spend split has a name to read each
// slug as. This is a set as a run records it — launching resolved its internal ids away —
// so `slug` is what everything joins on; `name` is only ever the prose beside it.
const CAPABILITY_SET: GgCapabilitySet = {
  agents: [
    {
      slug: "root",
      name: "Root",
      capabilities: [{ id: "shell", enabled: true, params: {} }],
      modelId: "vendor/big",
      openingTurn: { modules: [], functions: [] },
    },
    {
      slug: "reviewer",
      name: "Reviewer",
      capabilities: [{ id: "shell", enabled: true, params: {} }],
      modelId: "vendor/small",
      openingTurn: { modules: [], functions: [] },
    },
  ],
};

// The live monitor's running status: the pill and nothing else. A live run has as many
// agents working as it has dispatched, so the card carries no phrase about "the agent".
const STATUS: GgDashboardStatus = {
  label: "Running",
  detail: null,
  tone: "live",
};

function renderDashboard(
  status?: GgDashboardStatus,
  children?: React.ReactNode,
  // The run's ceiling, which the catalog resolves — passed explicitly so a test can render
  // the case where it could not be reached (null) as well as the ordinary one.
  timeoutSeconds: number | null = 4 * 3600,
  // Whether the run is still executing at the stated present. It gates the clocks row's two
  // instantaneous counts — "2 agents working" is a claim about now — so a finished run is
  // rendered by saying so here rather than by doctoring the fixture's statuses.
  stillRunning = true,
) {
  // The configuration goes into the reduction as well as onto the panel, as the live page
  // wires it: it is what resolves the profile id each attribution names into the name the
  // agent rows read by.
  const derived = reduceGgEvents(EVENTS, CAPABILITY_SET);
  return render(
    <GgDashboard
      status={status}
      usage={derived.usage}
      slotUsage={derived.slotUsage}
      perAgent={reduceGgEventsPerAgent(EVENTS, CAPABILITY_SET)}
      agentForest={derived.agentForest}
      capabilitySet={CAPABILITY_SET}
      runtime={deriveGgRuntime(
        derived.agentForest,
        derived.firstTimestamp,
        // Every event in the fixture carries the same timestamp, so the run's clock is
        // measured against one 90-second-later "present" — enough for the card to state a
        // wall clock and a summed agent time rather than two zeroes.
        Date.parse(TS) + 90_000,
        stillRunning,
      )}
      timeoutSeconds={timeoutSeconds}
    >
      {children}
    </GgDashboard>,
  );
}

// The cards, in the order the Dashboard lays them out, each read by its own label — so
// "the same layout" is asserted as a sequence rather than a set of present nodes.
function cardLabels(): string[] {
  return [...document.querySelectorAll("[class*='cardLabel']")].map(
    (node) => node.textContent ?? "",
  );
}

// The Status card, reached from its label — which lives one level down from the card, in
// the header row it shares with the kill control.
function statusCard(): HTMLElement {
  return screen.getByText("Status").parentElement!.parentElement!;
}

describe("the gg Dashboard", () => {
  it("lays the live monitor's cards out in one deliberate order", () => {
    renderDashboard(STATUS);
    expect(cardLabels()).toEqual([
      "Status",
      "Turns",
      "Tokens / s",
      "Total errors",
      "Max consecutive errors",
      "Top error types",
      "Runtime",
      "Active",
      "Waiting",
      "Time limit",
      "Cost",
      "Tokens",
      "Configuration",
      "Agents · 2",
    ]);
  });

  it("lays a finished run's gg tab out identically, minus the status card", () => {
    // The run's state is the detail page's own header, so the Dashboard does not restate
    // it — and nothing else moves because of that.
    renderDashboard();
    expect(cardLabels()).toEqual([
      "Turns",
      "Tokens / s",
      "Total errors",
      "Max consecutive errors",
      "Top error types",
      "Runtime",
      "Active",
      "Waiting",
      "Time limit",
      "Cost",
      "Tokens",
      "Configuration",
      "Agents · 2",
    ]);
  });

  it("says the run is running without claiming what its agents are doing", () => {
    // The pill carries the phase; a run has as many agents working as it has dispatched, so
    // there is no one thing "the agent" is doing to put beside it.
    renderDashboard(STATUS);
    // The label now sits in a header row of its own (it shares that row with the kill
    // control), so the card is a grandparent of its label rather than its parent.
    const card = statusCard();
    expect(within(card).getByText("Running")).toBeInTheDocument();
    expect(card.textContent).toBe("StatusRunning");
  });

  it("puts the kill control on the label's row, not under the pill", () => {
    // The control is reached deliberately and the three figures beside this card are read
    // at a glance, so it takes the card's trailing corner — a fixed place, level with the
    // label — instead of wrapping under a status line whose length varies with the detail.
    renderDashboard({ ...STATUS, action: <button>Kill Run</button> });
    const kill = screen.getByRole("button", { name: "Kill Run" });
    const header = screen.getByText("Status").parentElement!;
    expect(header).toContainElement(kill);
    // And it is the pill's sibling row, not the pill's own line.
    expect(
      within(screen.getByText("Running").parentElement!).queryByRole("button"),
    ).toBeNull();
  });

  it("leaves the label's row alone on a run with nothing to kill", () => {
    // A finished run supplies no control, and an empty slot for one would leave the header
    // a control's height taller than the label it holds — the label would sit somewhere
    // else the moment a run ended.
    renderDashboard(STATUS);
    const header = screen.getByText("Status").parentElement!;
    expect(header.childElementCount).toBe(1);
  });

  it("states the run's generation rate across every model it used", () => {
    renderDashboard(STATUS);
    // 400 generated tokens in 4s on the big model and 100 in 0.5s on the small one: the run
    // generated 500 tokens over 4.5s of model time, so it reads ~111 tok/s — the average
    // across its models, not the mean of their two rates (which would claim 150).
    const card = screen.getByText("Tokens / s").parentElement!;
    expect(within(card).getByText("111")).toBeInTheDocument();
    expect(within(card).getByText("tok/s across 2 models")).toBeInTheDocument();
    // A one-figure average cannot show its own composition, so the models behind it are
    // named on hover (no catalog is mounted here, so each reads by its id).
    expect(card.title).toBe("vendor/small: 200 tok/s\nvendor/big: 100 tok/s");
  });

  it("gives each of the run's clocks a tile of its own rather than one headline and three footnotes", () => {
    renderDashboard(STATUS);
    // The wall clock — 90s of it, per the fixture's stated present.
    const wall = screen.getByText("Runtime").parentElement!;
    expect(within(wall).getByText("1m 30s")).toBeInTheDocument();
    expect(within(wall).getByText("wall clock")).toBeInTheDocument();
    // The ratio between the two clocks is the one fact no tile states on its face, so it
    // rides on the wall clock's tooltip rather than being left for the reader to divide.
    expect(wall.title).toContain("2.0 agents working at once");

    // The summed agent time beside it, at the same weight: every event carries the run's
    // start timestamp and neither agent ended, so both count the full 90s — 3m 00s of agent
    // time inside 1m 30s of wall clock, which is the whole reason both figures are shown.
    const active = screen.getByText("Active").parentElement!;
    expect(within(active).getByText("3m 00s")).toBeInTheDocument();

    // Neither agent ever blocked, so the waiting reads zero rather than vanishing — the row
    // keeps its shape as a live run starts and stops blocking, and "0s / none waiting" is a
    // positive statement that nothing is stuck, which an absent tile would not be.
    const waiting = screen.getByText("Waiting").parentElement!;
    expect(within(waiting).getByText("0s")).toBeInTheDocument();
    expect(within(waiting).getByText("none waiting")).toBeInTheDocument();

    // And the ceiling, on a tile of its own instead of a line under an unrelated clock.
    const limit = screen.getByText("Time limit").parentElement!;
    expect(within(limit).getByText("4h")).toBeInTheDocument();
    expect(within(limit).getByText("wall-clock ceiling")).toBeInTheDocument();
  });

  it("counts the agents working right now under the time they have worked", () => {
    renderDashboard(STATUS);
    // Both of the fixture's agents are live (nothing returned them and no session end
    // reconciled them), so the run has two working and none waiting. This is the count the
    // sum above it is *not*: how many agents contributed to 3m 00s is a different question,
    // and it is the tooltip that keeps the two apart.
    const active = screen.getByText("Active").parentElement!;
    expect(within(active).getByText("2 agents working")).toBeInTheDocument();
    expect(active.title).toContain("2 agents that have run");
    expect(active.title).toContain("working right now");
  });

  it("stops counting agents at work once the run is no longer running", () => {
    // The same fixture read as a finished run — and it is exactly the shape that catches
    // this out: nothing in it ever ends, because a stream truncated by a kill or a harness
    // error never emits the session end that would reconcile its agents. The clocks are the
    // record of what the run did and stay; the counts are claims about now and go to zero,
    // rather than a concluded run's page insisting two agents are still working.
    renderDashboard(undefined, undefined, 4 * 3600, false);
    const wall = screen.getByText("Runtime").parentElement!;
    expect(within(wall).getByText("1m 30s")).toBeInTheDocument();
    const active = screen.getByText("Active").parentElement!;
    expect(within(active).getByText("3m 00s")).toBeInTheDocument();
    expect(within(active).getByText("none working")).toBeInTheDocument();
    const waiting = screen.getByText("Waiting").parentElement!;
    expect(within(waiting).getByText("none waiting")).toBeInTheDocument();
  });

  it("keeps the ceiling's tile when no limit resolved rather than shortening the row", () => {
    // The catalog could not be reached, so there is no figure to state. The tile holds its
    // place — a row that dropped to three tiles would move every clock beside it, and the
    // absence would read as "this run has no ceiling" rather than "we could not look one up".
    renderDashboard(STATUS, undefined, null);
    const limit = screen.getByText("Time limit").parentElement!;
    expect(within(limit).getByText("—")).toBeInTheDocument();
    expect(within(limit).getByText("no limit resolved")).toBeInTheDocument();
    // And the row is still four tiles, in the same order.
    expect(cardLabels().slice(6, 10)).toEqual([
      "Runtime",
      "Active",
      "Waiting",
      "Time limit",
    ]);
  });

  it("leads the panel with the run's notices rather than burying them under the cards", () => {
    // A run that has just finished says so where the reader is already looking. Trailing the
    // cards put "run complete" a screen below the fold on the very surface being watched to
    // learn exactly that.
    renderDashboard(STATUS, <p>Run complete</p>);
    const notice = screen.getByText("Run complete");
    const firstCardLabel = screen.getByText("Status");
    expect(
      notice.compareDocumentPosition(firstCardLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("accounts the run's spend inside the Cost widget, per agent and per model", () => {
    renderDashboard(STATUS);
    // Cost leads the money row, carrying the total and both spend splits; Tokens and the
    // configuration are their own tiles beside/under it.
    const cost = screen.getByText("Cost").parentElement!;
    expect(within(cost).getByText("$0.0300")).toBeInTheDocument();
    expect(within(cost).getByText("Per agent")).toBeInTheDocument();
    // Costliest profile first, each naming the model bound to it (no catalog is mounted
    // here, so a model reads by its id).
    const profiles = within(cost).getAllByText(/^(Root|Reviewer)$/);
    expect(profiles.map((node) => node.textContent)).toEqual([
      "Root",
      "Reviewer",
    ]);
    // Those names are prose over an accounting kept by profile id — which is what the row
    // carries, and what a reader hovering one is told it is really reading.
    expect(profiles.map((node) => node.getAttribute("title"))).toEqual([
      "root",
      "reviewer",
    ]);
    // Per model too, always — this run binds one model per profile, so it lists the same
    // two rows again, which is a fact about the configuration rather than a reason to
    // withhold the reading. Each model therefore names itself twice: once as a profile's
    // binding, once as a per-model row.
    expect(within(cost).getByText("Per model")).toBeInTheDocument();
    expect(within(cost).getAllByText("vendor/big")).toHaveLength(2);
    expect(within(cost).getAllByText("vendor/small")).toHaveLength(2);
  });

  it("keeps two profiles that share a name apart in the spend split", () => {
    // Nothing makes a name unique, and a within-run A/B is precisely the configuration
    // that carries two of one: the same reviewer, on two models, so the pair can be
    // compared. Folded on the name they would read as a single row of doubled figures —
    // the one reading that answers neither question — so the split is kept by profile id
    // and the rows that collide say which id each is.
    const perAgent =
      within(renderSharedName()).getByText("Per agent").parentElement!;
    const rows = within(perAgent).getAllByText(/^Reviewer/);
    expect(rows.map((node) => node.textContent)).toEqual([
      "Reviewer (reviewer)",
      "Reviewer (reviewer-2)",
    ]);
    expect(rows.map((node) => node.getAttribute("title"))).toEqual([
      "reviewer",
      "reviewer-2",
    ]);
    // Each keeps its own figures rather than one row carrying the pair's sum.
    expect(within(perAgent).getByText("$0.0200")).toBeInTheDocument();
    expect(within(perAgent).getByText("$0.0100")).toBeInTheDocument();
    // And the root, whose name nothing collides with, is left alone.
    expect(within(perAgent).getByText("Root")).toBeInTheDocument();
  });
});

// A run whose configuration names two of its profiles alike — an A/B of one reviewer over
// two models — rendered through the Dashboard, returning its Cost card.
function renderSharedName(): HTMLElement {
  const events: HarnessEvent[] = [
    gg("root", {
      type: "agent_spawned",
      profileId: "root",
      modelId: "vendor/big",
      depth: 0,
    } as GgTelemetryKind),
    gg("root", {
      type: "usage",
      profileId: "root",
      modelId: "vendor/big",
      tokens: { uncachedInput: 4000, cachedInput: null, output: 300 },
      cost: { comparable: 0.05, actual: 0.05 },
    } as GgTelemetryKind),
    ...(
      [
        ["agent-0", "reviewer", "vendor/small", 0.02],
        ["agent-1", "reviewer-2", "vendor/tiny", 0.01],
      ] as const
    ).flatMap(([agentId, profileId, modelId, spend]) => [
      gg(
        agentId,
        {
          type: "agent_spawned",
          profileId,
          modelId,
          depth: 1,
        } as GgTelemetryKind,
        "root",
      ),
      gg(
        agentId,
        {
          type: "usage",
          profileId,
          modelId,
          tokens: { uncachedInput: 900, cachedInput: null, output: 100 },
          cost: { comparable: spend, actual: spend },
        } as GgTelemetryKind,
        "root",
      ),
    ]),
  ];
  const set: GgCapabilitySet = {
    agents: [
      {
        slug: "root",
        name: "Root",
        capabilities: [],
        modelId: "vendor/big",
        openingTurn: { modules: [], functions: [] },
      },
      {
        slug: "reviewer",
        name: "Reviewer",
        capabilities: [],
        modelId: "vendor/small",
        openingTurn: { modules: [], functions: [] },
      },
      {
        slug: "reviewer-2",
        name: "Reviewer",
        capabilities: [],
        modelId: "vendor/tiny",
        openingTurn: { modules: [], functions: [] },
      },
    ],
  };
  const derived = reduceGgEvents(events, set);
  render(
    <GgDashboard
      usage={derived.usage}
      slotUsage={derived.slotUsage}
      perAgent={reduceGgEventsPerAgent(events, set)}
      agentForest={derived.agentForest}
      capabilitySet={set}
      runtime={deriveGgRuntime(
        derived.agentForest,
        derived.firstTimestamp,
        Date.parse(TS) + 90_000,
        true,
      )}
      timeoutSeconds={4 * 3600}
    />,
  );
  return screen.getByText("Cost").parentElement!;
}

// One turn's outcome, as gg publishes it — the event the error row is folded from.
function outcome(
  agentId: string,
  turns: number,
  extra: Partial<Extract<GgTelemetryKind, { type: "turn_outcome" }>> = {},
): HarnessEvent {
  return gg(agentId, {
    type: "turn_outcome",
    outcome: "progressed",
    consecutiveErrors: 0,
    turns,
    ...extra,
  } as GgTelemetryKind);
}

// The Dashboard over the shared fixture plus whatever outcomes a test is about, which is
// what the error row reads. Rendered without a status card so the assertions are about the
// row rather than about which surface it is on.
function renderErrors(...outcomes: HarnessEvent[]) {
  const events = [...EVENTS, ...outcomes];
  const derived = reduceGgEvents(events, CAPABILITY_SET);
  return render(
    <GgDashboard
      usage={derived.usage}
      slotUsage={derived.slotUsage}
      perAgent={reduceGgEventsPerAgent(events, CAPABILITY_SET)}
      agentForest={derived.agentForest}
      capabilitySet={CAPABILITY_SET}
      runtime={deriveGgRuntime(
        derived.agentForest,
        derived.firstTimestamp,
        Date.parse(TS) + 90_000,
        true,
      )}
      timeoutSeconds={4 * 3600}
    />,
  );
}

// One of the error row's three tiles, reached from its own label.
function errorTile(label: string): HTMLElement {
  return screen.getByText(label).parentElement!;
}

// A card's headline figure — the big slot, read apart from the ranked counts under it,
// which are the same shape of digits.
function headline(card: HTMLElement): string {
  return card.querySelector("[class*='metricValue']")?.textContent ?? "";
}

// The ranking, in the order it puts its rows: each row's type label and its count, with
// the base-kind badge that sits between them dropped — the badge is asserted on its own
// where it is the point.
function rankedTypes(): Array<[string, string]> {
  return [
    ...errorTile("Top error types").querySelectorAll(
      "[class*='errorTypes'] li",
    ),
  ].map((row) => [
    row.querySelector("[class*='errorTypeLabel']")?.textContent ?? "",
    row.querySelector("[class*='errorTypeCount']")?.textContent ?? "",
  ]);
}

describe("the gg Dashboard's error row", () => {
  it("states the failures with the denominator they were taken against", () => {
    // Never a bare percentage: 50% of two turns and 50% of two hundred are not the same
    // claim about a configuration, and the count of attempts is what tells them apart.
    renderErrors(
      outcome("root", 1),
      outcome("root", 2, {
        outcome: "error",
        error: "transpile",
        errorType: "transpile_syntax",
        consecutiveErrors: 1,
      }),
      outcome("root", 3, {
        outcome: "error",
        error: "transpile",
        errorType: "transpile_syntax",
        consecutiveErrors: 2,
      }),
      outcome("root", 4),
    );
    const total = errorTile("Total errors");
    expect(headline(total)).toBe("2");
    expect(within(total).getByText("50% of 4 turns")).toBeInTheDocument();
  });

  it("gives the consecutive peak a tile rather than a clause on the rate's line", () => {
    // It is the counter gg's own ceiling is enforced on — whether two failures in forty
    // turns were adjacent is the difference between a flaky run and one falling over — so
    // it reads at the same weight as the total beside it, and says whose peak it is: a
    // maximum over agents, since turns from concurrent agents interleave.
    renderErrors(
      outcome("root", 1, {
        outcome: "error",
        error: "model_api",
        errorType: "model_retry_exhausted",
        consecutiveErrors: 1,
      }),
      outcome("root", 2, {
        outcome: "error",
        error: "model_api",
        errorType: "model_retry_exhausted",
        consecutiveErrors: 2,
      }),
      outcome("agent-0", 1, {
        outcome: "error",
        error: "model_api",
        errorType: "model_retry_exhausted",
        consecutiveErrors: 1,
      }),
    );
    const peak = errorTile("Max consecutive errors");
    // Two in a row for the root and one for the subagent: the peak is two, not the three
    // errors summed and not the six a naive streak over the merged stream might claim.
    expect(headline(peak)).toBe("2");
    expect(
      within(peak).getByText("in a row at worst, by one agent"),
    ).toBeInTheDocument();
    expect(peak.title).toContain("any single agent");
  });

  it("ranks the specific error types by count, most common first", () => {
    // The ranking is over the twenty-odd specific types rather than the six base kinds —
    // "top error types" over six buckets is barely a narrowing.
    renderErrors(
      outcome("root", 1, {
        outcome: "error",
        error: "program_fault",
        errorType: "program_unknown_name",
        consecutiveErrors: 1,
      }),
      outcome("root", 2, {
        outcome: "error",
        error: "program_fault",
        errorType: "program_unknown_name",
        consecutiveErrors: 2,
      }),
      outcome("root", 3, {
        outcome: "error",
        error: "sandbox_limit",
        errorType: "sandbox_timeout",
        consecutiveErrors: 3,
      }),
    );
    expect(rankedTypes()).toEqual([
      ["unknown name", "2"],
      ["execution timeout", "1"],
    ]);
    // The base kind rides along as a badge, because a specific type does not always name
    // its own family — "unknown name" says nothing about being a program fault, and the
    // families are what gg's five error ceilings are written against.
    const ranking = errorTile("Top error types");
    expect(within(ranking).getByText("program fault")).toBeInTheDocument();
    expect(within(ranking).getByText("sandbox limit")).toBeInTheDocument();
  });

  it("names only three types however many the run produced", () => {
    // The point of a ranking is the narrowing. A run failing five ways lists the worst
    // three; the fourth and fifth are what the Errors panel is for.
    renderErrors(
      ...(
        [
          "transpile_syntax",
          "transpile_syntax",
          "transpile_syntax",
          "sandbox_trap",
          "sandbox_trap",
          "model_parse",
          "program_throw",
        ] as const
      ).map((errorType, i) =>
        outcome("root", i + 1, {
          outcome: "error",
          error: "transpile",
          errorType,
          consecutiveErrors: i + 1,
        }),
      ),
    );
    expect(rankedTypes()).toEqual([
      ["syntax error", "3"],
      ["sandbox trap", "2"],
      // Two rows tie at one — "uncaught throw" and "unparseable model response" — and the
      // tie breaks on the label, so a live run's ranking does not shuffle equal rows past
      // each other as it re-renders.
      ["uncaught throw", "1"],
    ]);
  });

  it("does not pad the ranking out to three", () => {
    renderErrors(
      outcome("root", 1, {
        outcome: "error",
        error: "sandbox_limit",
        errorType: "sandbox_out_of_memory",
        consecutiveErrors: 1,
      }),
    );
    expect(rankedTypes()).toEqual([["out of memory", "1"]]);
  });

  it("says a clean run is clean, and says so against its turn count", () => {
    renderErrors(outcome("root", 1), outcome("root", 2), outcome("agent-0", 1));
    const total = errorTile("Total errors");
    expect(headline(total)).toBe("0");
    expect(
      within(total).getByText("no errored turns of 3"),
    ).toBeInTheDocument();
    // No streak claim on a run that has no streak, and nothing to rank — but each tile
    // still says so rather than rendering an empty box.
    expect(headline(errorTile("Max consecutive errors"))).toBe("0");
    expect(
      within(errorTile("Max consecutive errors")).getByText("no turn errored"),
    ).toBeInTheDocument();
    expect(rankedTypes()).toEqual([]);
    expect(
      within(errorTile("Top error types")).getByText("no errors to rank"),
    ).toBeInTheDocument();
  });

  it("claims nothing at all for a stream that carries no outcomes", () => {
    // A run that has not finished its first turn. A "0" there would read as a clean record
    // it has no evidence for — in every one of the three tiles, not just the total.
    renderErrors();
    expect(headline(errorTile("Total errors"))).toBe("—");
    expect(headline(errorTile("Max consecutive errors"))).toBe("—");
    expect(screen.getAllByText("no turn outcomes reported yet")).toHaveLength(
      3,
    );
  });

  it("reports the replies loop detection threw away, and only when there were any", () => {
    // Not errors — the retry succeeded — but money spent on nothing, which is the whole
    // figure that says whether arming the detector paid for itself. It hangs on the total,
    // which is the tile about what the run spent its turns on.
    renderErrors(
      outcome("root", 1, {
        loopAborts: 3,
        loopAbortWords: 9195,
        loopAbortChars: 58400,
      }),
      outcome("root", 2),
    );
    expect(
      within(errorTile("Total errors")).getByText("looping", { exact: false }),
    ).toBeInTheDocument();
    // And how much they generated, which is the half the count cannot say. It is stated
    // here because the output is billed and deliberately absent from the run's cost.
    expect(
      within(errorTile("Total errors")).getByText(
        "9,195 words (58,400 characters) generated and thrown away",
      ),
    ).toBeInTheDocument();

    // A run that left the detector disarmed — which is every run by default — says nothing.
    renderErrors(outcome("root", 1));
    expect(
      within(
        screen.getAllByText("Total errors")[1]!.parentElement!,
      ).queryByText("looping", { exact: false }),
    ).toBeNull();
  });
});
