// The gg Dashboard's layout, across the two surfaces it is read on.
//
// The live monitor (`/runs/gg/:jobId/live`) and a finished run's gg tab
// (`/runs/:runId/gg`) render the *same* Dashboard over the same reduction of the same
// stream — the rich view is not something that changes shape once the run ends. The one
// deliberate difference is the status card, which the finished run omits because its page
// header already carries the run's state; everything below that must be identical, in the
// same order. These pin that, and the money row's own composition (Cost leading, Tokens
// beside it, the configuration under Tokens).

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
) {
  const derived = reduceGgEvents(EVENTS);
  return render(
    <GgDashboard
      status={status}
      usage={derived.usage}
      slotUsage={derived.slotUsage}
      perAgent={reduceGgEventsPerAgent(EVENTS)}
      agentForest={derived.agentForest}
      fsm={derived.fsm}
      capabilitySet={CAPABILITY_SET}
      runtime={deriveGgRuntime(
        derived.agentForest,
        derived.firstTimestamp,
        // Every event in the fixture carries the same timestamp, so the run's clock is
        // measured against one 90-second-later "present" — enough for the card to state a
        // wall clock and a summed agent time rather than two zeroes.
        Date.parse(TS) + 90_000,
      )}
      timeoutSeconds={4 * 3600}
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

describe("the gg Dashboard", () => {
  it("lays the live monitor's cards out in one deliberate order", () => {
    renderDashboard(STATUS);
    expect(cardLabels()).toEqual([
      "Status",
      "Turns",
      "Tokens / s",
      "Runtime",
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
      "Runtime",
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
    const card = screen.getByText("Status").parentElement!;
    expect(within(card).getByText("Running")).toBeInTheDocument();
    expect(card.textContent).toBe("StatusRunning");
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

  it("states both of the run's clocks and the ceiling it is bounded by", () => {
    renderDashboard(STATUS);
    const card = screen.getByText("Runtime").parentElement!;
    // The wall clock is the headline — 90s of it, per the fixture's stated present.
    expect(within(card).getByText("1m 30s")).toBeInTheDocument();
    expect(within(card).getByText("wall clock")).toBeInTheDocument();
    // And the sum beneath it: every event carries the run's start timestamp and neither
    // agent ended, so both agents count the full 90s — 3m 00s of agent time inside 1m 30s of
    // wall clock, which is the whole reason both figures are shown.
    expect(
      within(card).getByText("total 3m 00s across 2 agents"),
    ).toBeInTheDocument();
    expect(within(card).getByText("limit 4h")).toBeInTheDocument();
    // The ratio between them is what the tooltip spells out, so "2.0 agents at once" is
    // stated somewhere rather than left to be divided by the reader.
    expect(card.title).toContain("2.0 agents working at once");
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
