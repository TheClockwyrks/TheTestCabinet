import { act, render, screen } from "@testing-library/react";
import type { ModelSpec } from "@test-cabinet/run-record";
import { describe, expect, it, vi } from "vitest";
import type { VoxelResultView } from "../../../data/galleryContext";

// A WebGL-capable, motion-OK browser so the section mounts its 3D viewer rather
// than the static PNG fallback.
vi.mock("../../../components/webgl", () => ({
  supportsWebGL: () => true,
  prefersReducedMotion: () => false,
}));

// The voxel data would otherwise be fetched from the artifact service; hand the
// viewer a ready part map so it mounts immediately.
vi.mock("../../../data/galleryContext", () => ({
  useVoxelArtifacts: () => ({
    voxelsByPart: { chassis: { dims: { width: 1, height: 1, depth: 1 }, voxels: [] } },
    loading: false,
    error: null,
  }),
}));

// Stand in for the real (WebGL) viewer with a counter marker, so the test can
// assert how many 3D contexts the section mounts without touching three.
vi.mock("./GuardedVoxelViewer", () => ({
  GuardedVoxelViewer: ({ label }: { label: string }) => (
    <div data-testid="voxel-viewer" data-label={label} />
  ),
}));

// The layout section imports the SCSS module; vitest runs with `css: false`, so it
// resolves to an empty object. Nothing to do.
import { VoxelResultSection } from "./VoxelResultSection";

// An animated rig with several caller and auto joints plus a predetermined
// animation — the shape that used to mount one WebGL canvas per row.
const RIG: ModelSpec = {
  parts: [
    { name: "chassis", pivot: [0, 0, 0] },
    { name: "turret", parent: "chassis", pivot: [0, 0, 0] },
  ],
  joints: [
    { name: "turret_yaw", part: "turret", kind: "rotation", axis: "y", pivot: [0, 0, 0], min: -1, max: 1, rest: 0, drive: "caller" },
    { name: "gun_pitch", part: "turret", kind: "rotation", axis: "x", pivot: [0, 0, 0], min: -1, max: 1, rest: 0, drive: "caller" },
    { name: "radar_spin", part: "turret", kind: "rotation", axis: "y", pivot: [0, 0, 0], min: 0, max: 6, rest: 0, drive: "auto", auto: { periodMs: 2000, looping: true, keyframes: [{ tMs: 0, value: 0 }, { tMs: 2000, value: 6 }] } },
    { name: "tread_l", part: "chassis", kind: "translation", axis: "x", pivot: [0, 0, 0], min: 0, max: 1, rest: 0, drive: "auto", auto: { periodMs: 1000, looping: true, keyframes: [{ tMs: 0, value: 0 }, { tMs: 1000, value: 1 }] } },
  ],
  animations: [
    { name: "bombardment", periodMs: 4000, looping: true, tracks: [{ joint: "turret_yaw", keyframes: [{ tMs: 0, value: -1 }, { tMs: 4000, value: 1 }] }] },
  ],
};

function part(name: string): VoxelResultView["parts"][number] {
  return {
    name,
    voxelsUrl: `voxels/${name}.json`,
    regeneratedUrl: `regenerated/${name}.png`,
    previewUrl: `parts/${name}.png`,
    actionsUrl: `parts/${name}.actions.json`,
    cheatDivergence: 0,
    operationCount: 10,
    voxelCount: 100,
    detail: null,
  };
}

const VIEW: VoxelResultView = {
  animated: true,
  rig: RIG,
  model: RIG,
  parts: [part("chassis"), part("turret")],
  detail: null,
};

describe("VoxelResultSection (animated)", () => {
  it("mounts exactly one shared 3D viewer for a multi-joint rig", async () => {
    // Regression guard: the section used to render a 3D canvas per animation, caller
    // joint, and auto joint — five here — each its own WebGL context, exhausting the
    // browser's active-context budget so the views blanked. The whole rig must now
    // play through a single shared viewer.
    await act(async () => {
      render(<VoxelResultSection view={VIEW} />);
    });

    expect(screen.getAllByTestId("voxel-viewer")).toHaveLength(1);
  });

  it("still lets a reviewer select every joint and animation of the rig", async () => {
    await act(async () => {
      render(<VoxelResultSection view={VIEW} />);
    });

    // Each animation/joint remains individually selectable; only the render surface
    // is shared.
    for (const name of ["bombardment", "turret_yaw", "gun_pitch", "radar_spin", "tread_l"]) {
      expect(screen.getByRole("button", { name: new RegExp(name) })).toBeInTheDocument();
    }
  });
});
