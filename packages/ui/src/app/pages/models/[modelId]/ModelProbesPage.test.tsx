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
// operator, and the backend's error envelope surfaced when a trigger is
// refused (409 already running / 422 no slug / 503 no key).

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
  releasedAt: null,
  inputModalities: [],
} as unknown as ModelSummary;

const COMPLETE: ModelProbe = {
  id: "probe-1",
  modelSlug: "claude-x",
  openrouterSlug: "anthropic/claude-x",
  provider: "DeepInfra",
  samples: 3,
  maxTokens: 3500,
  fullContext: false,
  status: "complete",
  error: null,
  verdict: "ready",
  cleanRate: 1,
  spend: 0.0123,
  createdAt: "2026-08-20T10:00:00Z",
  finishedAt: "2026-08-20T10:01:00Z",
};

const RUNNING: ModelProbe = {
  ...COMPLETE,
  id: "probe-2",
  provider: null,
  status: "running",
  verdict: null,
  cleanRate: null,
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
              sample: 1,
              provider: "DeepInfra",
              finishReason: "tool_calls",
              nativeFinishReason: "tool_calls",
              label: "clean-program",
              clean: true,
              programText: 'import { files } from "gg";\nfiles.list(".");',
              responseText: "",
              reasoningText: null,
              promptTokens: 1200,
              completionTokens: 340,
              cost: 0.0041,
              durationMs: 5300,
              error: null,
              createdAt: "2026-08-20T10:00:10Z",
            },
          ]
        : [],
    requestMessages: [
      { role: "system", content: "You are gg's responses-as-code agent." },
      { role: "user", content: "Build the game." },
      {
        role: "assistant",
        tool_calls: [
          {
            id: "seed-program-1",
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
      { role: "tool", tool_call_id: "seed-program-1", content: "ok" },
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

    // The history row: verdict badge, provider, clean rate, spend.
    expect(await screen.findAllByText("Ready")).not.toHaveLength(0);
    expect(screen.getAllByText("DeepInfra").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/clean 100%/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("$0.0123").length).toBeGreaterThan(0);

    // The newest probe is selected by default, so its detail loads: the rollup
    // and the classified item with its submitted program.
    expect(await screen.findAllByText("clean-program")).not.toHaveLength(0);
    expect(screen.getByText(/files\.list/)).toBeInTheDocument();
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

    await waitFor(() =>
      expect(trigger).toHaveBeenCalledWith(
        "claude-x",
        { samples: 3, maxTokens: 3500, fullContext: false },
        "t",
      ),
    );
    // The accepted probe lands at the head of the history immediately, still
    // running.
    expect(await screen.findByText("Running")).toBeInTheDocument();
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
