import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BackendProvider,
  type BackendContextValue,
} from "../../../client/context";
import { GgConfigEditPage } from "./GgConfigEditPage";

// The page's app chrome reads contexts (gallery data, backdrop settings) that are
// irrelevant to the editor under test. Stub it, mirroring the other page tests, so
// only the configuration form is exercised.
vi.mock("../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/PromptHeader", () => ({
  PromptHeader: () => null,
}));
// A signed-in operator: saving a configuration is account-scoped, so the token is
// what unlocks the form.
vi.mock("../../../client/auth", () => ({
  useAuth: () => ({ token: "t0" }),
}));

const createGgConfig = vi.fn().mockResolvedValue({ id: "c1" });

function backendValue(): BackendContextValue {
  return {
    client: {
      listModels: vi.fn().mockResolvedValue([]),
      listGgConfigs: vi.fn().mockResolvedValue([]),
      createGgConfig,
    },
    identity: null,
    status: "ready",
    error: null,
    url: null,
    setUrl: () => {},
  } as unknown as BackendContextValue;
}

function renderPage(path = "/account/gg/new") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <BackendProvider value={backendValue()}>
        <Routes>
          <Route path="/account/gg/new" element={<GgConfigEditPage />} />
        </Routes>
      </BackendProvider>
    </MemoryRouter>,
  );
}

describe("GgConfigEditPage", () => {
  // The save spy is module-scoped, so its call log accumulates across tests unless
  // cleared — every "called once" assertion counts from a fresh slate.
  beforeEach(() => createGgConfig.mockClear());

  it("renders gg's full capability-set editing surface", async () => {
    renderPage();
    // The first-class config sections are present — a configuration is the whole
    // capability set, not just a capability list.
    expect(await screen.findByText("Capabilities")).toBeInTheDocument();
    expect(screen.getByText("Model slots")).toBeInTheDocument();
    expect(screen.getByText("Role bindings")).toBeInTheDocument();
    // Per-tool ablation folded into the capabilities; there is no standalone
    // "Toolset ablation" section any more.
    expect(screen.queryByText("Toolset ablation")).not.toBeInTheDocument();
    // The concern groups fold the full catalog; the always-on base tools are on the
    // (expanded) "Models & tools" group.
    expect(screen.getByText("Models & tools")).toBeInTheDocument();
    expect(screen.getByText("Delegation")).toBeInTheDocument();
    // Shell is a capability row in the Models & tools group; Filesystem is a group.
    expect(screen.getByText("Shell")).toBeInTheDocument();
    expect(screen.getByText("Filesystem")).toBeInTheDocument();
  });

  it("reveals a collapsed group's capabilities when expanded", async () => {
    renderPage();
    // "Multi-model" lives in the Delegation group, which starts collapsed.
    await screen.findByText("Capabilities");
    expect(screen.queryByText("Multi-model")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Delegation/i }));
    expect(screen.getByText("Multi-model")).toBeInTheDocument();
  });

  it("requires a name, then saves the capability set under it", async () => {
    renderPage();
    const save = await screen.findByRole("button", {
      name: "Create configuration",
    });
    // A configuration is picked by name on the new-run page, so a nameless one is
    // not savable.
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText("e.g. no-compaction"), {
      target: { value: "shell-heavy" },
    });
    // Turn a capability on so the saved set is distinguishable from an empty one.
    fireEvent.click(screen.getAllByRole("checkbox", { name: /Shell/i })[0]!);
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(createGgConfig).toHaveBeenCalledTimes(1));
    const input = createGgConfig.mock.calls[0]![0];
    expect(input.name).toBe("shell-heavy");
    // The configuration records its own name as the `preset` facet, so every run
    // launched from it is sliceable by which configuration produced it.
    expect(input.capabilitySet.preset).toBe("shell-heavy");
    // The full catalog is always serialized (on or off) so ablation arms stay
    // symmetric.
    const ids = input.capabilitySet.capabilities.map(
      (c: { id: string }) => c.id,
    );
    expect(ids).toContain("shell");
    expect(ids).toContain("read-file");
    // The primary role defers to a declared `primary` model slot rather than pinning
    // a model, which is what keeps one configuration reusable across models: the
    // binding names the slot, and the New run page supplies the model per run.
    expect(input.capabilitySet.slots).toEqual([
      { slot: "primary", modelId: "", modelSlot: "primary" },
    ]);
    expect(input.capabilitySet.modelSlots).toEqual([{ name: "primary" }]);
  });

  it("withholds a capability's sub-feature from inside its config, not a separate section", async () => {
    renderPage();
    fireEvent.change(await screen.findByPlaceholderText("e.g. no-compaction"), {
      target: { value: "no-revise" },
    });
    // Turning the Memories capability on expands its config, where its per-feature
    // "Revise memories" slider (covering update_memory + delete_memory) lives — there
    // is no standalone ablation surface, the granularity is inside the capability.
    fireEvent.click(screen.getByRole("checkbox", { name: /^Memories/i }));
    const revise = screen.getByRole("checkbox", { name: /Revise memories/i });
    expect(revise).toBeChecked();
    fireEvent.click(revise);

    fireEvent.click(
      screen.getByRole("button", { name: "Create configuration" }),
    );
    await waitFor(() => expect(createGgConfig).toHaveBeenCalledTimes(1));
    // Turning the bundle off withholds every tool it names at once — the wire format
    // stays per-tool, so a slider can never leave a bundle half-withheld.
    const { disabledTools } = createGgConfig.mock.calls[0]![0].capabilitySet;
    expect(new Set(disabledTools)).toEqual(
      new Set(["update_memory", "delete_memory"]),
    );
  });
});
