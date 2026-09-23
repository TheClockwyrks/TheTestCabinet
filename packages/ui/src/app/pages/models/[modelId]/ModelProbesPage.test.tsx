import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BackendProvider,
  type BackendContextValue,
} from "../../../../client/context";
import type { ModelProbe, ModelProbeDetail } from "../../../../client/types";
import {
  GalleryDataProvider,
  type GalleryDataInput,
} from "../../../data/galleryContext";
import type { ModelSummary } from "../../../data/models";
import { ModelProbesPage } from "./ModelProbesPage";

// The Probes tab: probe history for everyone, trigger controls for a signed-in
// operator (with the language selector), and the backend's error envelope
// surfaced when a trigger is refused (409 already running / 422 no slug / 503
// no key).

// The page's app chrome reads contexts (backdrop settings, topbar) that are
// irrelevant to the probe surface under test.
vi.mock("../../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
// Mutable so the signed-out case flips the token off without a second module
// graph; reset before each test.
const authState = vi.hoisted(() => ({ token: "t" as string | null }));
vi.mock("../../../../client/auth", () => ({
  useAuth: () => ({ token: authState.token }),
}));

beforeEach(() => {
  authState.token = "t";
});

const MODEL = {
  slug: "claude-x",
  name: "Claude X",
  provider: "Anthropic",
  isConfigured: true,
  openrouterUrl: null,
  description: null,
  logoSvg: null,
  modelIds: ["anthropic/claude-x"],
  aliases: [],
  prices: null,
  priceHistory: [],
  contextLength: null,
  providerPin: null,
  providerPinSetByHand: false,
  nativeQuantization: null,
  maxInputPrice: null,
  maxOutputPrice: null,
  bannedProviders: [],
  unknownQuantizationProviders: [],
  releasedAt: null,
  inputModalities: [],
} as unknown as ModelSummary;

const COMPLETE: ModelProbe = {
  id: "probe-1",
  modelSlug: "claude-x",
  openrouterSlug: "anthropic/claude-x",
  provider: "DeepInfra",
  language: "typescript",
  samples: 8,
  maxTokens: 3500,
  status: "complete",
  error: null,
  verdict: "ready",
  passRate: 1,
  spend: 0.0123,
  createdAt: "2026-08-20T10:00:00Z",
  finishedAt: "2026-08-20T10:01:00Z",
};

const RUNNING: ModelProbe = {
  ...COMPLETE,
  id: "probe-2",
  provider: null,
  language: null,
  status: "running",
  verdict: null,
  passRate: null,
  spend: 0,
  finishedAt: null,
};

function detailOf(probe: ModelProbe): ModelProbeDetail {
  return {
    probe,
    items:
      probe.status === "complete"
        ? [
            {
              id: "item-1",
              language: "typescript",
              scenario: "baseline",
              prompt: "write-plan",
              sample: 0,
              provider: "DeepInfra",
              finishReason: "tool_calls",
              nativeFinishReason: "tool_calls",
              label: "correct-calls",
              pass: true,
              programText:
                'import { files } from "gg";\nfiles.writeFile("notes/plan.md", plan);',
              responseText: "",
              reasoningText: null,
              promptTokens: 1200,
              completionTokens: 340,
              cost: 0.0041,
              durationMs: 5300,
              error: null,
              createdAt: "2026-08-20T10:00:10Z",
            },
            {
              id: "item-2",
              language: "typescript",
              scenario: "missing-docview",
              prompt: "run-tests",
              sample: 0,
              provider: "DeepInfra",
              finishReason: "tool_calls",
              nativeFinishReason: "tool_calls",
              label: "docview-first",
              pass: true,
              programText:
                'import { views } from "gg";\nviews.openDocsView("gg.shell.shell");',
              responseText: "",
              reasoningText: null,
              promptTokens: 1100,
              completionTokens: 120,
              cost: 0.0021,
              durationMs: 3200,
              error: null,
              createdAt: "2026-08-20T10:00:20Z",
            },
          ]
        : [],
    requests: [
      {
        language: "typescript",
        scenario: "baseline",
        prompt: "write-plan",
        messages: [
          { role: "system", content: "You are gg's responses-as-code agent." },
          { role: "user", content: "Task\n----\nCreate the file." },
          {
            role: "assistant",
            tool_calls: [
              {
                id: "bootstrap-program",
                type: "function",
                function: {
                  name: "submit_program",
                  arguments: JSON.stringify({
                    program: 'import { docs } from "gg";\ndocs.search({});',
                  }),
                },
              },
            ],
          },
          { role: "tool", tool_call_id: "bootstrap-program", content: "ok" },
        ],
      },
    ],
  };
}

function galleryValue(): GalleryDataInput {
  return {
    models: [MODEL],
    modelsStatus: "ready",
    canExecute: true,
  } as unknown as GalleryDataInput;
}

interface ClientStubs {
  listModelProbes?: ReturnType<typeof vi.fn>;
  getModelProbe?: ReturnType<typeof vi.fn>;
  triggerModelProbe?: ReturnType<typeof vi.fn>;
  listModelProbeProviders?: ReturnType<typeof vi.fn>;
}

function backendValue(stubs: ClientStubs): BackendContextValue {
  return {
    client: {
      listModelProbes:
        stubs.listModelProbes ?? vi.fn().mockResolvedValue([COMPLETE]),
      getModelProbe:
        stubs.getModelProbe ??
        vi
          .fn()
          .mockImplementation((id: string) =>
            Promise.resolve(detailOf(id === RUNNING.id ? RUNNING : COMPLETE)),
          ),
      ...(stubs.triggerModelProbe
        ? { triggerModelProbe: stubs.triggerModelProbe }
        : {}),
      ...(stubs.listModelProbeProviders
        ? { listModelProbeProviders: stubs.listModelProbeProviders }
        : {}),
    },
    identity: null,
    status: "ready",
    error: null,
    url: null,
    setUrl: () => {},
  } as unknown as BackendContextValue;
}

// The trigger gate needs both Bearer methods; tests that exercise the form pass
// their own trigger stub and inherit this provider enumeration.
function signedInStubs(overrides: ClientStubs = {}): ClientStubs {
  return {
    triggerModelProbe: vi.fn().mockResolvedValue(RUNNING),
    listModelProbeProviders: vi.fn().mockResolvedValue({
      openrouterSlug: "anthropic/claude-x",
      providers: [{ name: "DeepInfra", contextLength: 131072 }],
    }),
    ...overrides,
  };
}

function renderPage(stubs: ClientStubs = signedInStubs()) {
  render(
    <MemoryRouter initialEntries={["/models/claude-x/probes"]}>
      <GalleryDataProvider value={galleryValue()}>
        <BackendProvider value={backendValue(stubs)}>
          <Routes>
            <Route
              path="/models/:modelId/probes"
              element={<ModelProbesPage />}
            />
          </Routes>
        </BackendProvider>
      </GalleryDataProvider>
    </MemoryRouter>,
  );
}

describe("ModelProbesPage", () => {
  it("renders the probe history and the newest probe's detail", async () => {
    renderPage();

    // The history row: verdict badge, language, provider, pass rate, spend.
    expect(await screen.findAllByText("Ready")).not.toHaveLength(0);
    expect(screen.getAllByText("TypeScript").length).toBeGreaterThan(0);
    expect(screen.getAllByText("DeepInfra").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/pass 100%/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("$0.0123").length).toBeGreaterThan(0);

    // The newest probe is selected by default, so its detail loads: the
    // per-scenario rollup and the classified items with their programs.
    expect(await screen.findAllByText("correct-calls")).not.toHaveLength(0);
    expect(screen.getAllByText("docview-first").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/missing-docview/).length).toBeGreaterThan(0);
    expect(screen.getByText(/files\.writeFile/)).toBeInTheDocument();
  });

  it("hides the trigger and shows a notice when signed out", async () => {
    authState.token = null;
    renderPage();

    expect(
      await screen.findByText(/sign in to run probes/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /run probe/i })).toBeNull();
  });

  it("triggers a probe with the seeded defaults and shows the new row", async () => {
    const trigger = vi.fn().mockResolvedValue(RUNNING);
    renderPage(
      signedInStubs({
        listModelProbes: vi.fn().mockResolvedValue([]),
        triggerModelProbe: trigger,
      }),
    );

    fireEvent.click(await screen.findByRole("button", { name: /run probe/i }));

    // The defaults: 8 samples per input prompt, every language (no `language`
    // field), the default route (no `provider`).
    await waitFor(() =>
      expect(trigger).toHaveBeenCalledWith(
        "claude-x",
        { samples: 8, maxTokens: 3500 },
        "t",
      ),
    );
    // The accepted probe lands at the head of the history immediately, still
    // running, marked as probing every language.
    expect(await screen.findByText("Running")).toBeInTheDocument();
    expect(screen.getAllByText("all languages").length).toBeGreaterThan(0);
  });

  it("pins the probe to one language arm through the selector", async () => {
    const trigger = vi.fn().mockResolvedValue(RUNNING);
    renderPage(
      signedInStubs({
        listModelProbes: vi.fn().mockResolvedValue([]),
        triggerModelProbe: trigger,
      }),
    );

    fireEvent.change(await screen.findByLabelText("Language"), {
      target: { value: "rust" },
    });
    fireEvent.click(screen.getByRole("button", { name: /run probe/i }));

    await waitFor(() =>
      expect(trigger).toHaveBeenCalledWith(
        "claude-x",
        { samples: 8, maxTokens: 3500, language: "rust" },
        "t",
      ),
    );
  });

  it("refuses an out-of-range sample count before any request", async () => {
    const trigger = vi.fn().mockResolvedValue(RUNNING);
    renderPage(signedInStubs({ triggerModelProbe: trigger }));

    fireEvent.change(await screen.findByLabelText("Samples per prompt"), {
      target: { value: "129" },
    });
    const run = screen.getByRole("button", { name: /run probe/i });
    expect(run).toBeDisabled();
    expect(run).toHaveAttribute(
      "title",
      expect.stringMatching(/between 1 and 128/),
    );
    expect(trigger).not.toHaveBeenCalled();
  });

  it("surfaces the backend's error envelope in the alert", async () => {
    renderPage(
      signedInStubs({
        triggerModelProbe: vi
          .fn()
          .mockRejectedValue(
            new Error("409 a probe of `claude-x` is already running"),
          ),
      }),
    );

    fireEvent.click(await screen.findByRole("button", { name: /run probe/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/already running/);
  });
});
