// The gg Dashboard's layout, across the two surfaces it is read on.
//
// The live monitor (`/runs/gg/:jobId/live`) and a finished run's gg tab
// (`/runs/:runId/gg`) render the *same* Dashboard over the same reduction of the same
// stream — the rich view is not something that changes shape once the run ends. The one
// deliberate difference is the status card, which the finished run omits because its page
// header already carries the run's state; everything below that must be identical, in the
// same order. These pin that, the clocks row (four sibling tiles of its own, so the run's
// two clocks are not footnotes to one another), and the money row's own composition (Cost
// leading, Tokens beside it, the configuration under Tokens).

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

// A two-slot, two-model run's worth of attributed usage deltas and turn timings — enough
// for the Cost widget to carry a spend split, with the root outspending the reviewer, and
// for the generation rate to be a blend of two different per-model rates.
const EVENTS: HarnessEvent[] = [
  gg("root", { type: "turn_started", turn: 1 } as GgTelemetryKind),
  gg("root", {
    type: "agent_spawned",
    slot: "root",
    modelId: "vendor/big",
    depth: 0,
  } as GgTelemetryKind),
  gg("root", {
    type: "usage",
    slot: "root",
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
      slot: "reviewer",
      modelId: "vendor/small",
      depth: 1,
    } as GgTelemetryKind,
    "root",
  ),
  gg(
    "agent-0",
    {
      type: "usage",
      slot: "reviewer",
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

const CAPABILITY_SET: GgCapabilitySet = {
  agents: [
    {
      name: "Root",
      capabilities: [{ id: "shell", enabled: true, params: {} }],
      modelId: "vendor/big",
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
  const derived = reduceGgEvents(EVENTS);
  return render(
    <GgDashboard
      status={status}
      usage={derived.usage}
      slotUsage={derived.slotUsage}
      perAgent={reduceGgEventsPerAgent(EVENTS)}
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
      "Errors",
      "Tokens / s",
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
      "Errors",
      "Tokens / s",
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
    expect(cardLabels().slice(4, 8)).toEqual([
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

  it("accounts the run's spend inside the Cost widget, per slot and per model", () => {
    renderDashboard(STATUS);
    // Cost leads the money row, carrying the total and both spend splits; Tokens and the
    // configuration are their own tiles beside/under it.
    const cost = screen.getByText("Cost").parentElement!;
    expect(within(cost).getByText("$0.0300")).toBeInTheDocument();
    expect(within(cost).getByText("Per slot")).toBeInTheDocument();
    // Costliest slot first, each naming the model bound to it (no catalog is mounted
    // here, so a model reads by its id).
    expect(
      within(cost)
        .getAllByText(/^(root|reviewer)$/)
        .map((node) => node.textContent),
    ).toEqual(["root", "reviewer"]);
    // Per model too, always — this run binds one model per slot, so it lists the same two
    // rows again, which is a fact about the configuration rather than a reason to withhold
    // the reading. Each model therefore names itself twice: once as a slot's binding, once
    // as a per-model row.
    expect(within(cost).getByText("Per model")).toBeInTheDocument();
    expect(within(cost).getAllByText("vendor/big")).toHaveLength(2);
    expect(within(cost).getAllByText("vendor/small")).toHaveLength(2);
  });
});

// One turn's outcome, as gg publishes it — the event the Errors card is folded from.
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
// what the Errors card reads. Rendered without a status card so the assertions are about
// the card rather than about which surface it is on.
function renderErrors(...outcomes: HarnessEvent[]) {
  const events = [...EVENTS, ...outcomes];
  const derived = reduceGgEvents(events);
  return render(
    <GgDashboard
      usage={derived.usage}
      slotUsage={derived.slotUsage}
      perAgent={reduceGgEventsPerAgent(events)}
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

// The Errors card, reached from its label.
function errorsCard(): HTMLElement {
  return screen.getByText("Errors").parentElement!;
}

// A card's headline figure — the big slot, read apart from the per-kind counts under it,
// which are the same shape of digits.
function headline(card: HTMLElement): string {
  return card.querySelector("[class*='metricValue']")?.textContent ?? "";
}

describe("the gg Dashboard's Errors card", () => {
  it("states the failures with the denominator they were taken against", () => {
    // Never a bare percentage: 50% of two turns and 50% of two hundred are not the same
    // claim about a configuration, and the count of attempts is what tells them apart.
    renderErrors(
      outcome("root", 1),
      outcome("root", 2, {
        outcome: "error",
        error: "transpile",
        consecutiveErrors: 1,
      }),
      outcome("root", 3, {
        outcome: "error",
        error: "transpile",
        consecutiveErrors: 2,
      }),
      outcome("root", 4),
    );
    const card = errorsCard();
    expect(headline(card)).toBe("2");
    expect(
      within(card).getByText("50% of 4 turns · 2 in a row at worst"),
    ).toBeInTheDocument();
  });

  it("splits the failures by kind, showing only the kinds that happened", () => {
    // Five zeroed rows under a run that failed one way would bury the one row that matters.
    renderErrors(
      outcome("root", 1, {
        outcome: "error",
        error: "model_api",
        consecutiveErrors: 1,
      }),
      outcome("root", 2, {
        outcome: "error",
        error: "missing_completion",
        consecutiveErrors: 2,
      }),
    );
    const card = errorsCard();
    expect(within(card).getByText("model call")).toBeInTheDocument();
    expect(within(card).getByText("no work declared")).toBeInTheDocument();
    expect(within(card).queryByText("sandbox limit")).toBeNull();
  });

  it("says a clean run is clean, and says so against its turn count", () => {
    renderErrors(outcome("root", 1), outcome("root", 2), outcome("agent-0", 1));
    const card = errorsCard();
    expect(headline(card)).toBe("0");
    expect(within(card).getByText("no errored turns of 3")).toBeInTheDocument();
    // Nothing to split, so no split — and no streak claim on a run that has no streak.
    expect(within(card).queryByText("model call")).toBeNull();
  });

  it("claims nothing at all for a stream that carries no outcomes", () => {
    // A run recorded before gg published outcomes, or one that has not finished its first
    // turn. A "0" there would read as a clean record it has no evidence for.
    renderErrors();
    const card = errorsCard();
    expect(headline(card)).toBe("—");
    expect(
      within(card).getByText("no turn outcomes reported yet"),
    ).toBeInTheDocument();
  });

  it("reports the replies loop detection threw away, and only when there were any", () => {
    // Not errors — the retry succeeded — but money spent on nothing, which is the whole
    // figure that says whether arming the detector paid for itself.
    renderErrors(outcome("root", 1, { loopAborts: 3 }), outcome("root", 2));
    expect(
      within(errorsCard()).getByText("looping", { exact: false }),
    ).toBeInTheDocument();

    // A run that left the detector disarmed — which is every run by default — says nothing.
    renderErrors(outcome("root", 1));
    expect(
      within(screen.getAllByText("Errors")[1]!.parentElement!).queryByText(
        "looping",
        { exact: false },
      ),
    ).toBeNull();
  });
});
