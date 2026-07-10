import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ModelSpec } from "@test-cabinet/run-record";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VoxelResultView } from "../../../data/galleryContext";

// A mutable WebGL capability the tests flip: on to mount the 3D viewer, off to fall
// back to the static PNG. `vi.hoisted` so the mock factory below can close over it.
const caps = vi.hoisted(() => ({ webgl: true }));
vi.mock("../../../components/webgl", () => ({
  supportsWebGL: () => caps.webgl,
  prefersReducedMotion: () => false,
}));

// Stand in for the real (WebGL/glTF) viewer with a marker that echoes the props the
// section drives it with, so the test can assert what animation is played without
// touching three or fetching a `.glb`.
vi.mock("./BlenderCharacterViewer", () => ({
  default: ({
    url,
    animationName,
    loop,
  }: {
    url: string;
    animationName: string | null;
    loop: boolean;
  }) => (
    <div
      data-testid="blender-viewer"
      data-url={url}
      data-animation={animationName ?? ""}
      data-loop={String(loop)}
    />
  ),
}));

import { BlenderResultSection } from "./BlenderResultSection";

// The required `[model]` animations a `blender-character` case declares: an `autoPlay`
// idle plus named one-shot playables. A Blender character carries no F-curve tracks
// (its clips are baked into the glTF), so these are bare name/loop/autoPlay records.
const MODEL: ModelSpec = {
  parts: [],
  joints: [],
  animations: [
    { name: "idle", periodMs: 0, looping: true, autoPlay: true, joints: [] },
    { name: "run", periodMs: 0, looping: true, autoPlay: false, joints: [] },
    { name: "fire", periodMs: 0, looping: false, autoPlay: false, joints: [] },
  ],
};

function view(overrides: Partial<VoxelResultView> = {}): VoxelResultView {
  return {
    animated: true,
    skinned: true,
    blender: true,
    skinnedMeshUrl: "asset/mesh-0.glb",
    rig: null,
    model: MODEL,
    parts: [
      {
        name: "character",
        meshUrl: "asset/mesh-0.glb",
        previewUrl: "asset/preview-0.png",
        actionsUrl: "asset/actions-0.json",
        operationCount: 0,
        voxelCount: 0,
        detail: null,
      },
    ],
    detail: null,
    ...overrides,
  };
}

describe("BlenderResultSection", () => {
  beforeEach(() => {
    caps.webgl = true;
  });

  it("plays the idle by default and mounts the native glTF viewer", async () => {
    await act(async () => {
      render(<BlenderResultSection view={view()} />);
    });

    // Every required animation is offered in the picker.
    for (const name of ["idle", "run", "fire"]) {
      expect(screen.getByRole("button", { name: new RegExp("^" + name) })).toBeTruthy();
    }

    // The auto-play idle drives the viewer on mount, playing the emitted glTF, looping.
    const viewer = screen.getByTestId("blender-viewer");
    expect(viewer.getAttribute("data-url")).toBe("asset/mesh-0.glb");
    expect(viewer.getAttribute("data-animation")).toBe("idle");
    expect(viewer.getAttribute("data-loop")).toBe("true");
  });

  it("switches the played clip when another animation is picked", async () => {
    await act(async () => {
      render(<BlenderResultSection view={view()} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^fire/ }));
    });

    // `fire` plays once (not looping), so the viewer is driven with loop=false.
    const viewer = screen.getByTestId("blender-viewer");
    expect(viewer.getAttribute("data-animation")).toBe("fire");
    expect(viewer.getAttribute("data-loop")).toBe("false");
  });

  it("falls back to the preview PNG without WebGL", async () => {
    caps.webgl = false;
    await act(async () => {
      render(<BlenderResultSection view={view()} />);
    });

    // No 3D viewer; the model's rendered preview stands in, and the picker still lists
    // the animations so the case stays reviewable.
    expect(screen.queryByTestId("blender-viewer")).toBeNull();
    const img = screen.getByRole("img");
    expect(img.getAttribute("src")).toBe("asset/preview-0.png");
    expect(screen.getByRole("button", { name: /^idle/ })).toBeTruthy();
  });
});
