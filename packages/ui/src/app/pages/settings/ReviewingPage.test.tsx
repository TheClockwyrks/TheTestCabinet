import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type {
  CoverageSettings,
  CoverageSettingsInput,
} from "@clockwyrks/run-record/coverage";
import type { BackendClient } from "../../../client/clients";
import { BackendProvider } from "../../../client/context";
import { ReviewingPage } from "./ReviewingPage";

vi.mock("../../../client/auth", () => ({
  useAuth: () => ({ token: "t0" }),
}));

vi.mock("../../layouts/settings/SettingsLayout", () => ({
  SettingsLayout: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

// The account-wide review buffer as the settings tab edits it. The one thing this
// surface has to get right is that the two shapes of the target — a bound and no
// limit — are different instructions with different controls, and that what is
// saved is the shape and not a number standing in for it.
function renderPage(stored: CoverageSettings) {
  let saved: CoverageSettingsInput | null = null;
  const client = {
    getCoverageSettings: async () => stored,
    setCoverageSettings: async (input: CoverageSettingsInput) => {
      saved = input;
      return { bufferTarget: input.bufferTarget, isDefault: false };
    },
  } as unknown as BackendClient;
  render(
    <MemoryRouter>
      <BackendProvider
        value={{
          client,
          identity: null,
          status: "ready",
          error: null,
          url: null,
          setUrl: () => {},
        }}
      >
        <ReviewingPage />
      </BackendProvider>
    </MemoryRouter>,
  );
  return { saved: () => saved };
}

const bounded = (runs: number): CoverageSettings => ({
  bufferTarget: { kind: "bounded", runs },
  isDefault: false,
});

describe("ReviewingPage", () => {
  it("shows a bound in the number field with no limit off", async () => {
    renderPage(bounded(10));
    await act(async () => {});
    const input = screen.getByRole("spinbutton", {
      name: "Review buffer",
    }) as HTMLInputElement;
    const toggle = screen.getByRole("switch", {
      name: "No limit",
    }) as HTMLInputElement;
    expect(input.value).toBe("10");
    expect(input.disabled).toBe(false);
    expect(toggle.checked).toBe(false);
    expect(
      (screen.getByRole("button", { name: "Saved" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("saves no limit as the unbounded shape", async () => {
    const page = renderPage(bounded(10));
    await act(async () => {});
    fireEvent.click(screen.getByRole("switch", { name: "No limit" }));
    expect(
      (
        screen.getByRole("spinbutton", {
          name: "Review buffer",
        }) as HTMLInputElement
      ).disabled,
    ).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save buffer" }));
    });
    expect(page.saved()).toEqual({ bufferTarget: { kind: "unbounded" } });
  });

  it("loads no limit as the switch and restores the bound typed beneath it", async () => {
    const page = renderPage({
      bufferTarget: { kind: "unbounded" },
      isDefault: false,
    });
    await act(async () => {});
    const toggle = screen.getByRole("switch", {
      name: "No limit",
    }) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    const input = screen.getByRole("spinbutton", { name: "Review buffer" });
    fireEvent.change(input, { target: { value: "4" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save buffer" }));
    });
    expect(page.saved()).toEqual({
      bufferTarget: { kind: "bounded", runs: 4 },
    });
  });

  it("asks for a bound rather than claiming a blank one is saved", async () => {
    renderPage({ bufferTarget: { kind: "unbounded" }, isDefault: false });
    await act(async () => {});
    fireEvent.click(screen.getByRole("switch", { name: "No limit" }));
    const button = screen.getByRole("button", {
      name: "Save buffer",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Saved" })).toBeNull();
  });

  it("keeps zero as a bound rather than reading it as no limit", async () => {
    const page = renderPage(bounded(10));
    await act(async () => {});
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Review buffer" }),
      {
        target: { value: "0" },
      },
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save buffer" }));
    });
    expect(page.saved()).toEqual({
      bufferTarget: { kind: "bounded", runs: 0 },
    });
  });
});
