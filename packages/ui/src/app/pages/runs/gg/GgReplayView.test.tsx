import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import {
  BackendProvider,
  type BackendContextValue,
} from "../../../../client/context";
import type { BackendClient } from "../../../../client/clients";
import type { GgReplayRecordV1 } from "@test-cabinet/run-record/gg";
import { GgReplayView } from "./GgReplayView";

// The logic under test is the record fetch + step-through, not the app shell.
vi.mock("../../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../../components/PromptHeader", () => ({
  PromptHeader: () => null,
}));

// A small two-agent record: the root turn calls a tool (with its recorded result),
// then a subagent takes its own turn. Ordered by the global `seq`.
const RECORD: GgReplayRecordV1 = {
  sessionId: "run-xyz",
  capabilitySet: {
    preset: "full",
    agents: [
      {
        name: "Root",
        capabilities: [{ id: "replay", enabled: true, params: {} }],
        modelId: "test/model",
      },
    ],
  },
  entries: [
    {
      agentId: "root",
      seq: 1,
      type: "model_io",
      request: {
        messages: [
          { role: "system", content: "You are building a game." },
          { role: "user", content: "Start the build." },
        ],
        tools: [{ name: "shell", description: "Run a shell command." }],
      },
      response: {
        text: "I'll list the files.",
        toolCalls: [{ id: "call-1", name: "shell", arguments: { cmd: "ls" } }],
        finishReason: "tool_calls",
        usage: { totalTokens: 1234 },
      },
    },
    {
      agentId: "root",
      seq: 2,
      type: "tool_result",
      call: { id: "call-1", name: "shell", arguments: { cmd: "ls" } },
      outcome: { ok: true, output: "src/\nCargo.toml", summary: "2 entries" },
    },
    {
      agentId: "agent-0",
      seq: 3,
      type: "model_io",
      request: {
        messages: [{ role: "user", content: "Implement the renderer." }],
        tools: [],
      },
      response: {
        text: "Done.",
        toolCalls: [],
        finishReason: "stop",
        usage: { totalTokens: 42 },
      },
    },
  ],
};

function backendValue(
  readGgReplay: BackendClient["readGgReplay"],
): BackendContextValue {
  const client = { readGgReplay } as unknown as BackendClient;
  return {
    client,
    identity: null,
    status: "ready",
    error: null,
    url: "http://backend",
    setUrl: () => {},
  };
}

function renderView(readGgReplay: BackendClient["readGgReplay"]) {
  return render(
    <MemoryRouter initialEntries={["/runs/gg/run-xyz/replay"]}>
      <BackendProvider value={backendValue(readGgReplay)}>
        <Routes>
          <Route path="/runs/gg/:runId/replay" element={<GgReplayView />} />
        </Routes>
      </BackendProvider>
    </MemoryRouter>,
  );
}

describe("GgReplayView", () => {
  it("renders a small record and steps forward and back", async () => {
    const readGgReplay = vi.fn().mockResolvedValue({ format: "v1", record: RECORD });
    renderView(readGgReplay);

    // It fetches the run's replay record by id.
    await waitFor(() => expect(readGgReplay).toHaveBeenCalledWith("run-xyz"));

    // Step 1 (root's model turn): its counter, what it saw (the prompt), and what it
    // did (the response + the tool call).
    await waitFor(() =>
      expect(screen.getByTestId("replay-counter")).toHaveTextContent(
        "step 1 / 2",
      ),
    );
    expect(screen.getByText("You are building a game.")).toBeInTheDocument();
    expect(screen.getByText("I'll list the files.")).toBeInTheDocument();
    // The tool call the model made this turn is shown.
    expect(screen.getAllByText("shell").length).toBeGreaterThan(0);
    // The recorded tool result attaches to this same turn.
    expect(screen.getByText(/2 entries/)).toBeInTheDocument();
    expect(screen.getByText(/Cargo\.toml/)).toBeInTheDocument();

    // Step forward to the subagent's turn.
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    await waitFor(() =>
      expect(screen.getByTestId("replay-counter")).toHaveTextContent(
        "step 2 / 2",
      ),
    );
    expect(screen.getByText("Implement the renderer.")).toBeInTheDocument();
    expect(screen.getByText("Done.")).toBeInTheDocument();

    // Step back to the root turn.
    fireEvent.click(screen.getByRole("button", { name: /Prev/ }));
    await waitFor(() =>
      expect(screen.getByTestId("replay-counter")).toHaveTextContent(
        "step 1 / 2",
      ),
    );
    expect(screen.getByText("I'll list the files.")).toBeInTheDocument();
  });

  it("filters the steps to one agent", async () => {
    renderView(vi.fn().mockResolvedValue({ format: "v1", record: RECORD }));
    await waitFor(() =>
      expect(screen.getByTestId("replay-counter")).toHaveTextContent(
        "step 1 / 2",
      ),
    );

    // Filtering to the subagent narrows the walk to its single turn.
    fireEvent.click(screen.getByRole("tab", { name: /agent-0/ }));
    await waitFor(() =>
      expect(screen.getByTestId("replay-counter")).toHaveTextContent(
        "step 1 / 1",
      ),
    );
    expect(screen.getByText("Implement the renderer.")).toBeInTheDocument();
  });

  it("shows a tidy empty state when the run captured no replay", async () => {
    renderView(vi.fn().mockResolvedValue(null));
    expect(
      await screen.findByText(/No replay record for this run/i),
    ).toBeInTheDocument();
  });

  // A newer recorder's record shares its outer field names with the v1 shape this view
  // walks, so the failure it guards against is silent: every step would render an empty
  // "saw" and the reader would blame the run. Say so instead.
  it("refuses a record from a newer recorder instead of walking it", async () => {
    renderView(vi.fn().mockResolvedValue({ format: "newer", formatVersion: 2 }));
    expect(
      await screen.findByText(/format v2, which this\s+app cannot read yet/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("replay-counter")).not.toBeInTheDocument();
  });
});
