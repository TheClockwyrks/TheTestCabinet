import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import {
  BackendProvider,
  type BackendContextValue,
} from "../../../../client/context";
import type { BackendClient } from "../../../../client/clients";
import type {
  GgCapabilitySet,
  GgReplayRecordV1,
} from "@test-cabinet/run-record/gg";
import type { GgReplayRecord } from "@test-cabinet/run-record/gg-replay";
import { GgReplayView } from "./GgReplayView";

// The logic under test is the record fetch + step-through, not the app shell.
vi.mock("../../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../../components/PromptHeader", () => ({
  PromptHeader: () => null,
}));

const CAPABILITIES: GgCapabilitySet = {
  preset: "full",
  agents: [
    {
      name: "Root",
      capabilities: [{ id: "replay", enabled: true, params: {} }],
      modelId: "test/model",
    },
  ],
};

// A 1×1 transparent PNG — a real image, so the rendered `src` is a real data URL.
const PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

// A small two-agent pooled record: the root turn sees a system prompt and a mockup it
// was seeded with, calls a tool (with its recorded result and its prompt frame), then a
// subagent takes its own turn. Ordered by the global `seq`.
const RECORD: GgReplayRecord = {
  formatVersion: 2,
  recorder: { ggVersion: "0.7.0" },
  fidelity: "standard",
  sessionId: "run-xyz",
  capabilitySet: CAPABILITIES,
  seed: { prompt: "Build the thing." },
  agents: [
    { agentId: "root", profile: "Root", origin: { type: "root" } },
    {
      agentId: "agent-0",
      profile: "Builder",
      origin: { type: "spawn", parent: "root", ordinal: 1 },
    },
  ],
  messages: [
    { id: "m0", body: { role: "system", content: "You are building a game." } },
    {
      id: "m1",
      body: {
        role: "user",
        content: "Start the build.",
        images: [{ $blob: 0 }],
      },
    },
    { id: "m2", body: { role: "user", content: "Implement the renderer." } },
  ],
  toolsets: [
    {
      id: "t0",
      tools: [{ name: "shell", description: "Run a shell command." }],
    },
  ],
  texts: ["src/\nCargo.toml", "2 entries"],
  blobs: [{ id: "b0", mediaType: "image/png", bytes: 68, dataBase64: PIXEL }],
  entries: [
    {
      agentId: "root",
      seq: 1,
      type: "model_io",
      request: {
        role: "agent",
        shape: "complete",
        messages: [0, 1],
        toolset: 0,
        fingerprint: { messages: 2, conversation: "c0" },
      },
      response: {
        text: "I'll list the files.",
        toolCalls: [{ id: "call-1", name: "shell", arguments: { cmd: "ls" } }],
        finishReason: "tool_calls",
        usage: { output: 40, reasoning: 2 },
      },
    },
    {
      agentId: "root",
      seq: 2,
      type: "prompt_frame",
      items: [
        {
          message: 0,
          slot: "system",
          source: "system",
          retention: "pinned",
          turn: 0,
        },
        {
          message: 1,
          slot: "thread",
          source: "file_view",
          retention: "pinned",
          turn: 0,
          label: "specs/mockup.png",
          region: { offset: 1, limit: 200 },
        },
      ],
    },
    {
      agentId: "root",
      seq: 3,
      type: "tool_result",
      call: { id: "call-1", name: "shell", arguments: { cmd: "ls" } },
      outcome: { ok: true, output: 0, summary: 1 },
    },
    {
      agentId: "agent-0",
      seq: 4,
      type: "model_io",
      request: {
        role: "agent",
        shape: "complete",
        messages: [2],
        fingerprint: { messages: 1, conversation: "c1" },
      },
      response: { text: "Done.", finishReason: "stop", usage: { output: 3 } },
    },
  ],
};

// The transcript shape a build before format v2 wrote: model I/O and tool results, with
// every payload inline and no prompt frame anywhere.
const LEGACY: GgReplayRecordV1 = {
  sessionId: "run-old",
  capabilitySet: CAPABILITIES,
  entries: [
    {
      agentId: "root",
      seq: 1,
      type: "model_io",
      request: {
        messages: [{ role: "user", content: "Start the build." }],
        tools: [],
      },
      response: { text: "On it.", finishReason: "stop" },
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

function renderRecord(record: GgReplayRecord = RECORD) {
  return renderView(vi.fn().mockResolvedValue({ format: "v2", record }));
}

describe("GgReplayView", () => {
  it("renders a pooled record and steps forward and back", async () => {
    const readGgReplay = vi
      .fn()
      .mockResolvedValue({ format: "v2", record: RECORD });
    renderView(readGgReplay);

    // It fetches the run's replay record by id.
    await waitFor(() => expect(readGgReplay).toHaveBeenCalledWith("run-xyz"));

    // Step 1 (root's model turn): its counter, what it saw (the pooled messages), and
    // what it did (the response and the tool call it made).
    await waitFor(() =>
      expect(screen.getByTestId("replay-counter")).toHaveTextContent(
        "step 1 / 2",
      ),
    );
    // Each message shows twice — a one-line preview in the collapsed row and the full
    // body in the expansion beneath it — so these count rather than demand one.
    expect(
      screen.getAllByText("You are building a game.", { exact: false }),
    ).not.toHaveLength(0);
    expect(
      screen.getAllByText("I'll list the files.", { exact: false }),
    ).not.toHaveLength(0);
    // The recorded tool result attaches to this same turn, with its pooled text
    // resolved back out of the text pool.
    expect(screen.getByText(/2 entries/)).toBeInTheDocument();
    expect(screen.getByText(/Cargo\.toml/)).toBeInTheDocument();

    // Step forward to the subagent's turn.
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    await waitFor(() =>
      expect(screen.getByTestId("replay-counter")).toHaveTextContent(
        "step 2 / 2",
      ),
    );
    expect(
      screen.getAllByText("Implement the renderer.", { exact: false }),
    ).not.toHaveLength(0);

    // Step back to the root turn.
    fireEvent.click(screen.getByRole("button", { name: /Prev/ }));
    await waitFor(() =>
      expect(screen.getByTestId("replay-counter")).toHaveTextContent(
        "step 1 / 2",
      ),
    );
  });

  it("populates the Context column from the turn's prompt frame", async () => {
    renderRecord();
    await waitFor(() =>
      expect(screen.getByTestId("replay-counter")).toHaveTextContent("step 1"),
    );

    // The four typed fields the prompt frame is the only record of: the slot (a system
    // prompt is otherwise indistinguishable from a rebuilt usage signal), the
    // retention, the turn, and a paged view's window.
    expect(
      screen.getAllByTitle("system slot · pinned · t0").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByTitle("pinned · t0 · specs/mockup.png@1+200").length,
    ).toBeGreaterThan(0);
    // And the band it was attributed to reaches the row's tag, from the same frame.
    expect(screen.getByText("File views")).toBeInTheDocument();
  });

  it("resolves an inline image out of the blob pool", async () => {
    renderRecord();
    await waitFor(() =>
      expect(screen.getByTestId("replay-counter")).toHaveTextContent("step 1"),
    );

    // The message row is collapsed by default; the picture lives in its body.
    const image = await screen.findByAltText("Attached image/png image");
    expect(image).toHaveAttribute("src", `data:image/png;base64,${PIXEL}`);
  });

  it("filters the steps to one agent", async () => {
    renderRecord();
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
    expect(
      screen.getAllByText("Implement the renderer.", { exact: false }),
    ).not.toHaveLength(0);
  });

  it("walks a legacy record behind the older-gg banner", async () => {
    renderView(vi.fn().mockResolvedValue({ format: "v1", record: LEGACY }));

    // It walks — the record is still readable, and refusing it would strand every run
    // recorded before the format changed.
    await waitFor(() =>
      expect(screen.getByTestId("replay-counter")).toHaveTextContent(
        "step 1 / 1",
      ),
    );
    expect(screen.getAllByText("On it.", { exact: false })).not.toHaveLength(0);
    // With no frame there is no band to colour the row by, so it falls back to the
    // message's own role — labelled as the role it is, not inferred into a band.
    expect(screen.getByText("user")).toBeInTheDocument();
    // Behind a banner that says what it cannot tell you, so an empty Context column
    // reads as "not recorded" rather than as a defect in the run.
    expect(
      screen.getByText(/Captured by an older gg \(record format v1\)/),
    ).toBeInTheDocument();
  });

  it("says what a truncated capture is missing", async () => {
    renderRecord({
      ...RECORD,
      truncation: { reason: "session_killed", lastSeq: 3 },
    });
    expect(await screen.findByText(/killed mid-capture/)).toBeInTheDocument();
    expect(screen.getByText(/seq 3/)).toBeInTheDocument();
    // Truncation is a fact about the capture, never a refusal: the record still walks.
    expect(screen.getByTestId("replay-counter")).toHaveTextContent(
      "step 1 / 2",
    );
  });

  it("shows a tidy empty state when the run has no replay record", async () => {
    renderView(vi.fn().mockResolvedValue(null));
    expect(
      await screen.findByText(/No replay record for this run/i),
    ).toBeInTheDocument();
  });

  // A newer recorder's record shares its outer field names with the shape this view
  // walks, so the failure it guards against is silent: the walk would render a session
  // that reads as complete while dropping every input kind it does not know. Say so.
  it("refuses a record from a newer recorder instead of walking it", async () => {
    renderView(
      vi.fn().mockResolvedValue({ format: "newer", formatVersion: 9 }),
    );
    expect(
      await screen.findByText(/format v9, which this\s+app cannot read yet/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("replay-counter")).not.toBeInTheDocument();
  });

  it("reports the capture's fidelity and the build that wrote it", async () => {
    renderRecord();
    const header = await screen.findByText(/model turns across/);
    expect(within(header).queryByText("")).toBeNull();
    expect(header).toHaveTextContent("standard fidelity");
    expect(header).toHaveTextContent("gg 0.7.0");
  });
});
