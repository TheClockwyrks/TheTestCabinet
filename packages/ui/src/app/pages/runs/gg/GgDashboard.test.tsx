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

// A two-slot, two-model run's worth of attributed usage deltas — enough for the Cost
// widget to carry a spend split, with the root outspending the reviewer.
const EVENTS: HarnessEvent[] = [
  gg("root", { type: "turn_started", turn: 1 } as GgTelemetryKind),
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

const STATUS: GgDashboardStatus = {
  label: "Running",
  detail: "the agent is working",
  tone: "live",
};

function renderDashboard(status?: GgDashboardStatus) {
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
    />,
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
      "Cost",
      "Tokens",
      "Configuration",
      "Agents · 2",
    ]);
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
    expect(within(cost).getByText("vendor/big")).toBeInTheDocument();
    expect(within(cost).getByText("vendor/small")).toBeInTheDocument();
    // One model per slot, so the per-model split would only restate the per-slot one.
    expect(within(cost).queryByText("Per model")).not.toBeInTheDocument();
  });
});
