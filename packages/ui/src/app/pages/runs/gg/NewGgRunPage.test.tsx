import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import {
  BackendProvider,
  WorkersProvider,
  type BackendContextValue,
  type WorkersContextValue,
} from "../../../../client/context";
import type { WorkerClient } from "../../../../client/clients";
import { NewGgRunPage } from "./NewGgRunPage";

// The page's app chrome reads contexts (gallery data, backdrop settings) that are
// irrelevant to the config/launch logic under test. Stub it, mirroring the run
// monitor's page test, so the test exercises only the form.
vi.mock("../../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../../components/PromptHeader", () => ({
  PromptHeader: () => null,
}));
// Auth is only read for the bearer token; a local worker needs none, so a
// signed-out stub keeps the gating logic on the primary-slot binding, not auth.
vi.mock("../../../../client/auth", () => ({
  useAuth: () => ({ token: null }),
}));
// The catalog + case-name hooks pull from the backend/gallery data source; stub
// them with a single already-selected case so the only remaining launch gate is
// the primary-model slot (the thing this test asserts on).
vi.mock("../../../runtime/useCatalog", () => ({
  useCatalog: () => ({
    cases: [{ slug: "carom", versions: ["v1.0.0"] }],
    slug: "carom",
    version: "v1.0.0",
    variant: "base",
    versionInfo: {
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
vi.mock("../../../data/useTestCases", () => ({
  useTestCases: () => ({ testCases: [], status: "ready" }),
}));
vi.mock("../../../data/useTestCaseName", () => ({
  useTestCaseName: () => (slug: string) => slug,
}));

// A backend context with no client — the page's `listModels` effect early-returns
// and the ModelCombobox falls back to accepting free-text ids.
const backendValue: BackendContextValue = {
  client: null,
  identity: null,
  status: "unconfigured",
  error: null,
  url: null,
  setUrl: () => {},
};

// A single local worker: `local: true` means no sign-in is required, so launch
// gating comes down to the primary-slot binding.
function workersValue(
  launch: WorkerClient["launchGgRun"] = vi.fn(),
): WorkersContextValue {
  const client = {
    launchGgRun: launch,
  } as unknown as WorkerClient;
  return {
    workers: [],
    activeId: "local",
    active: {
      id: "local",
      label: "Local",
      url: null,
      local: true,
      client,
      identity: null,
      backendMatch: "unknown",
    },
    setActive: () => {},
    addWorker: () => {},
    removeWorker: () => {},
  } as unknown as WorkersContextValue;
}

function renderPage(launch?: WorkerClient["launchGgRun"]) {
  return render(
    <MemoryRouter initialEntries={["/runs/gg/new"]}>
      <BackendProvider value={backendValue}>
        <WorkersProvider value={workersValue(launch)}>
          <Routes>
            <Route path="/runs/gg/new" element={<NewGgRunPage />} />
          </Routes>
        </WorkersProvider>
      </BackendProvider>
    </MemoryRouter>,
  );
}

describe("NewGgRunPage", () => {
  it("renders gg's full capability-set config surface", () => {
    renderPage();
    // The first-class config sections are present.
    expect(screen.getByText("Capability set")).toBeInTheDocument();
    expect(screen.getByText("Model slots")).toBeInTheDocument();
    expect(screen.getByText("Toolset ablation")).toBeInTheDocument();
    // The concern groups fold the full catalog; the always-on base tools are on the
    // (expanded) "Models & tools" group.
    expect(screen.getByText("Models & tools")).toBeInTheDocument();
    expect(screen.getByText("Delegation")).toBeInTheDocument();
    // Shell/Filesystem show as both a capability row and a toolset-ablation group.
    expect(screen.getAllByText("Shell").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Filesystem").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "Launch gg run" }),
    ).toBeInTheDocument();
  });

  it("reveals a collapsed group's capabilities when expanded", () => {
    renderPage();
    // "Multi-model" lives in the Delegation group, which starts collapsed (and it
    // offers no tools, so it never appears in the always-shown ablation surface).
    expect(screen.queryByText("Multi-model")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Delegation/i }));
    expect(screen.getByText("Multi-model")).toBeInTheDocument();
  });

  it("blocks launch until a model is bound to the primary slot", () => {
    renderPage();
    const launch = screen.getByRole("button", { name: "Launch gg run" });
    // A case is selected but no model is bound, so launch is disabled and the
    // blocking reason names the primary-slot binding.
    expect(launch).toBeDisabled();
    expect(
      screen.getByText(/Bind a model to the primary slot/i),
    ).toBeInTheDocument();

    // Binding the offline mock model to the primary slot satisfies the gate; launch
    // enables.
    fireEvent.click(screen.getByRole("checkbox", { name: /Mock/i }));
    expect(launch).toBeEnabled();
  });

  it("applies a built-in preset, which drives the launched capability set", async () => {
    const launch = vi.fn().mockResolvedValue({ jobId: "job-1" });
    renderPage(launch);

    // The form opens on "minimal"; switch to "full" (everything on). Applying a preset
    // re-seeds the whole capability set + slots.
    const presetSelect = screen.getByLabelText("Preset") as HTMLSelectElement;
    fireEvent.change(presetSelect, { target: { value: "full" } });
    expect(presetSelect.value).toBe("full");

    // Bind the offline mock model to the primary slot so the run is launchable, then
    // launch.
    fireEvent.click(screen.getByRole("checkbox", { name: /Mock/i }));
    const launchBtn = screen.getByRole("button", { name: "Launch gg run" });
    expect(launchBtn).toBeEnabled();
    fireEvent.click(launchBtn);

    await waitFor(() => expect(launch).toHaveBeenCalledTimes(1));
    const set = launch.mock.calls[0]![0].capabilitySet;
    // The primary slot is bound to the offline mock model (no key needed).
    expect(set.slots[0]).toMatchObject({
      slot: "primary",
      modelId: "mock/scripted-builder",
      provider: "mock",
    });
    // "full" turned on capabilities the default "minimal" set leaves off, e.g.
    // responses-as-code and code-reviews — proof the preset drove the config.
    const enabled = new Set(
      set.capabilities
        .filter((c: { enabled: boolean }) => c.enabled)
        .map((c: { id: string }) => c.id),
    );
    expect(enabled.has("responses-as-code")).toBe(true);
    expect(enabled.has("code-reviews")).toBe(true);
    // The full catalog is always serialized (on or off) so ablation arms stay
    // symmetric — base tools included.
    const ids = set.capabilities.map((c: { id: string }) => c.id);
    expect(ids).toContain("shell");
    expect(ids).toContain("filesystem");
  });
});
