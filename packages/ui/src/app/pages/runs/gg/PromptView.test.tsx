import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  GgTelemetryEvent,
  GgTelemetryKind,
} from "@test-cabinet/run-record/gg";
import type { HarnessEvent } from "../../../../client/types";
import { useAppSettings } from "../../../store/appSettings";
import { reduceGgEvents } from "./useGgRunState";
import type { AgentNode } from "./useGgRunState";
import { PromptView } from "./PromptView";

const TS = "2026-07-26T00:00:00Z";

// Wrap a gg telemetry payload in the HarnessEvent envelope the stream delivers.
function gg(kind: GgTelemetryKind): HarnessEvent {
  return {
    type: "gg",
    timestamp: TS,
    event: {
      timestamp: TS,
      sessionId: "s1",
      agentId: "root",
      ...kind,
    } as GgTelemetryEvent,
  };
}

// The root agent, which has no parent and so no brief — the Prompt view then shows
// the rendered opening prompt alone.
const ROOT: AgentNode = {
  id: "root",
  parentId: null,
  slot: "primary",
  modelId: "mock/scripted-builder",
  depth: 0,
  status: "running",
  suspendedMs: 0,
};

// A first turn carrying the two bands the Prompt view reads: the system framing and
// the build/user prompt the agent started from.
function promptStream(): HarnessEvent[] {
  return [
    gg({
      type: "context_message",
      id: "m_sys",
      role: "system",
      content: "you are gg",
      toolCalls: [],
      images: [],
      tokens: 10,
    } as GgTelemetryKind),
    gg({
      type: "context_message",
      id: "m_prompt",
      role: "user",
      content: "build a game",
      toolCalls: [],
      images: [],
      tokens: 20,
    } as GgTelemetryKind),
    gg({
      type: "prompt",
      request: [
        { id: "m_sys", source: "system" },
        { id: "m_prompt", source: "user_prompt" },
      ],
      totalTokens: 30,
      finishReason: "stop",
      tokens: {},
    } as GgTelemetryKind),
  ];
}

function renderPrompt() {
  const state = reduceGgEvents(promptStream());
  return render(
    <PromptView
      node={ROOT}
      prompts={state.prompts}
      pool={state.messagePool}
      live={false}
    />,
  );
}

describe("PromptView", () => {
  // The feed style is a persisted, app-wide preference; hold it at the default so
  // one test's choice can't leak into the next.
  beforeEach(() => {
    useAppSettings.getState().setEventFeedStyle("gutter");
  });

  it("lists the prompt's bands with their role and token cost", () => {
    renderPrompt();
    expect(screen.getByText("System")).toBeInTheDocument();
    expect(screen.getByText("User prompt")).toBeInTheDocument();
    expect(screen.getByText("system · 10 tokens")).toBeInTheDocument();
    expect(screen.getByText("user · 20 tokens")).toBeInTheDocument();
    expect(screen.getByText("you are gg")).toBeInTheDocument();
    expect(screen.getByText("build a game")).toBeInTheDocument();
  });

  // The prompt list is arranged by the same app-wide option as the activity feed, so
  // the container advertises the chosen style and the stylesheet does the arranging —
  // the same information in all three, only laid out differently.
  it.each(["gutter", "divider", "stacked"] as const)(
    "arranges the prompt messages in the %s style the user picked",
    (style) => {
      useAppSettings.getState().setEventFeedStyle(style);
      renderPrompt();
      const list = document.querySelector("[data-feed-style]");
      expect(list).toHaveAttribute("data-feed-style", style);
      // Whichever layout is picked, every message is still listed in full.
      expect(list?.querySelectorAll("li")).toHaveLength(2);
      expect(screen.getByText("System")).toBeInTheDocument();
      expect(screen.getByText("build a game")).toBeInTheDocument();
    },
  );

  it("keeps the fullscreen affordance on every prompt message", () => {
    renderPrompt();
    // One expand button per message — the escape hatch for a prompt too long to read
    // in the inline block, which is capped tighter here than in the Requests view.
    expect(
      screen.getByRole("button", {
        name: "Open System system message fullscreen",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Open User prompt user message fullscreen",
      }),
    ).toBeInTheDocument();
  });

  it("explains an unrecorded prompt rather than showing an empty list", () => {
    render(
      <PromptView node={ROOT} prompts={[]} pool={new Map()} live={false} />,
    );
    expect(
      screen.getByText("The exact prompt isn’t recorded for this run."),
    ).toBeInTheDocument();
  });
});
