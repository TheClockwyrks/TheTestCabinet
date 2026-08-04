import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import {
  BackendProvider,
  type BackendContextValue,
} from "../../../client/context";
import type { Model } from "../../../client/types";
import { ComparisonEditPage } from "./ComparisonEditPage";
import {
  capabilitySetFromDraft,
  emptyDraft,
} from "../runs/gg/ggConfigDraft";

// The page's app chrome reads contexts (gallery data, backdrop settings) that are
// irrelevant to the form logic under test.
vi.mock("../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../../client/auth", () => ({
  useAuth: () => ({ token: "t" }),
}));
// A single already-selected case, so the only remaining save gate is the
// configuration rows themselves.
vi.mock("../../runtime/useCatalog", () => ({
  useCatalog: () => ({
    cases: [{ slug: "carom", versions: ["v1.0.0"] }],
    slug: "carom",
    version: "v1.0.0",
    variant: "base",
    versionInfo: {
      testType: "end-to-end",
      variants: [{ slug: "base", name: "Base" }],
      maxRuntimeSeconds: 600,
    },
    error: null,
    loading: false,
    noBackend: false,
    setSlug: () => {},
    setVersion: () => {},
    setVariant: () => {},
  }),
}));
vi.mock("../../data/useTestCases", () => ({
  useTestCases: () => ({ testCases: [], status: "ready" }),
}));
vi.mock("../../data/useTestCaseName", () => ({
  useTestCaseName: () => (slug: string) => slug,
}));

const MODEL = {
  slug: "gpt-5-6-sol",
  name: "GPT-5.6 Sol",
  provider: "OpenAI",
  curated: true,
  openrouterUrl: null,
  description: null,
  logoSvg: null,
  coveredModelIds: [],
  aliases: [
    { slug: "gpt-5.6-sol", harnessFamily: "codex" },
    { slug: "openai/gpt-5.6-sol", harnessFamily: "openrouter" },
  ],
  price: null,
  priceHistory: [],
  contextLength: null,
  releasedAt: null,
} as unknown as Model;

// The account's one saved gg configuration. There are no shared built-ins, so a gg arm
// has something to point at only because an account saved something.
const SAVED_GG_CONFIG = {
  id: "cfg-minimal",
  name: "minimal",
  description: "the launchable baseline",
  capabilitySet: capabilitySetFromDraft(emptyDraft(), "minimal"),
};

function backendValue(
  createComparison: ReturnType<typeof vi.fn>,
): BackendContextValue {
  return {
    client: {
      listModels: vi.fn().mockResolvedValue([MODEL]),
      listGgConfigs: vi.fn().mockResolvedValue([SAVED_GG_CONFIG]),
      createComparison,
    },
    identity: null,
    status: "ready",
    error: null,
    url: null,
    setUrl: () => {},
  } as unknown as BackendContextValue;
}

function renderPage(createComparison = vi.fn()) {
  render(
    <MemoryRouter initialEntries={["/runs/comparisons/new"]}>
      <BackendProvider value={backendValue(createComparison)}>
        <Routes>
          <Route
            path="/runs/comparisons/new"
            element={<ComparisonEditPage />}
          />
          <Route path="/runs/comparisons/:id" element={<div>detail</div>} />
        </Routes>
      </BackendProvider>
    </MemoryRouter>,
  );
  return createComparison;
}

/** Let the page's async model-catalog fetch settle, so no state update lands
 *  after the assertions (React logs an act() warning for one that does). */
async function settle() {
  await act(async () => {});
}

/** Point the harness row at an OpenRouter-routed harness, whose family the test
 *  catalog's model has a slug in (the default harness is Claude Code, which the
 *  one-model catalog deliberately does not cover). */
function chooseOpenRouterHarness() {
  fireEvent.change(screen.getByLabelText("Harness"), {
    target: { value: "kilo" },
  });
}

/** Pick the catalog's one model in the combobox at `index` among the form's
 *  model inputs. */
async function pickModel(index: number) {
  const inputs = await screen.findAllByPlaceholderText(/^model id/);
  fireEvent.focus(inputs[index]!);
  const options = await screen.findAllByRole("option", {
    name: /GPT-5\.6 Sol/,
  });
  fireEvent.click(options[0]!);
}

describe("ComparisonEditPage", () => {
  it("splits the test picker by type and asks for neither an auth mode nor a global model", async () => {
    renderPage();
    await settle();
    expect(screen.getByLabelText("Test case type")).toBeInTheDocument();
    expect(screen.getByLabelText("Test case")).toBeInTheDocument();
    // Auth mode comes from the harness's own configuration, and the model is per
    // configuration — neither is a comparison-wide parameter.
    expect(screen.queryByLabelText("Auth mode")).toBeNull();
    expect(screen.queryByText("Auth mode")).toBeNull();
    // The only model fields on the page belong to the configuration rows.
    const labels = screen.getAllByText("Model");
    expect(labels).toHaveLength(1);
  });

  it("opens on one harness arm against one gg arm, each with its own model", async () => {
    renderPage();
    await settle();
    // Row one is a harness; row two is a gg configuration, seeded with the account's.
    expect(screen.getByLabelText("Harness")).toBeInTheDocument();
    const ggPicker = await screen.findByLabelText("gg configuration");
    expect(ggPicker).toHaveValue("saved:cfg-minimal");
  });

  it("saves a mixed comparison with a per-arm model and no global controls", async () => {
    const createComparison = vi
      .fn()
      .mockResolvedValue({ id: "cmp-1", config: {} });
    renderPage(createComparison);
    await screen.findByLabelText("gg configuration");

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Carom — gg vs Kilo" },
    });
    chooseOpenRouterHarness();
    // The harness row's model, then the gg row's primary slot.
    await pickModel(0);
    await pickModel(1);

    const save = screen.getByRole("button", { name: "Create comparison" });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    await waitFor(() => expect(createComparison).toHaveBeenCalledTimes(1));

    const input = createComparison.mock.calls[0]![0];
    expect(input.config.controls).toEqual({
      caseSlug: "carom",
      version: "v1.0.0",
      variant: "base",
      orchestratorSlug: "one-shot",
    });
    expect(input.config.arms).toHaveLength(2);
    const [harnessArm, ggArm] = input.config.arms;
    // The harness arm carries its own harness *and* its own model.
    expect(harnessArm.harnessSlug).toBeTruthy();
    expect(harnessArm.modelId).toBeTruthy();
    expect(harnessArm.ggConfigId).toBeUndefined();
    // The gg arm carries the configuration key plus a model per declared slot.
    expect(ggArm.ggConfigId).toBe("saved:cfg-minimal");
    expect(Object.values(ggArm.ggSlotModels)).toContain("openai/gpt-5.6-sol");
    expect(ggArm.harnessSlug).toBeUndefined();
    // Each arm's label distinguishes it by what it runs, model included.
    expect(harnessArm.label).toContain(harnessArm.modelId);
    expect(ggArm.label).toContain("minimal");
  });

  it("cannot be saved until every configuration has its model", async () => {
    renderPage();
    await screen.findByLabelText("gg configuration");
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Half-filled" },
    });
    chooseOpenRouterHarness();
    // Only the harness row's model is picked; the gg row's slot is still empty.
    await pickModel(0);
    expect(
      screen.getByRole("button", { name: "Create comparison" }),
    ).toBeDisabled();
  });

  it("adds a third configuration and refuses to drop below two", async () => {
    renderPage();
    await screen.findByLabelText("gg configuration");
    for (const button of screen.getAllByRole("button", {
      name: "Remove configuration",
    })) {
      expect(button).toBeDisabled();
    }

    fireEvent.click(
      screen.getByRole("button", { name: "+ Add configuration" }),
    );
    await waitFor(() =>
      expect(screen.getAllByLabelText("Kind")).toHaveLength(3),
    );
    for (const button of screen.getAllByRole("button", {
      name: "Remove configuration",
    })) {
      expect(button).toBeEnabled();
    }
  });
});
