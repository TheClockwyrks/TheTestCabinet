import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ModelSpec } from "@test-cabinet/run-record";
import { describe, expect, it, vi } from "vitest";
import type { VoxelResultView } from "../../../data/galleryContext";

// A WebGL-capable, motion-OK browser so the section mounts its 3D viewer rather
// than the static PNG fallback.
vi.mock("../../../components/webgl", () => ({
  supportsWebGL: () => true,
  prefersReducedMotion: () => false,
}));

// The mesh geometry would otherwise be fetched from the artifact service; hand the
// viewer a ready part map so it mounts immediately.
vi.mock("../../../data/galleryContext", () => ({
  useVoxelArtifacts: () => ({
    meshesByPart: {
      chassis: {
        positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
        normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
        colors: [1, 1, 1, 1, 1, 1, 1, 1, 1],
        indices: [0, 1, 2],
      },
    },
    loading: false,
    error: null,
  }),
  // Referenced by the GIF-export button's encode closure (only on click, which
  // these tests don't trigger); present so the named import resolves.
  fetchMeshesByPart: vi.fn(),
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

// An animated rig with two caller joints, two `auto` joints (driven only by
// animations), and two model-authored animations — an `autoPlay` idle plus a named
// playable. The section funnels the whole rig through one shared WebGL canvas.
const RIG: ModelSpec = {
  parts: [
    { name: "chassis", pivot: [0, 0, 0] },
    { name: "turret", parent: "chassis", pivot: [0, 0, 0] },
  ],
  joints: [
    {
      name: "turret_yaw",
      part: "turret",
      kind: "rotation",
      axis: "y",
      pivot: [0, 0, 0],
      min: -1,
      max: 1,
      rest: 0,
      drive: "caller",
    },
    {
      name: "gun_pitch",
      part: "turret",
      kind: "rotation",
      axis: "x",
      pivot: [0, 0, 0],
      min: -1,
      max: 1,
      rest: 0,
      drive: "caller",
    },
    {
      name: "radar_spin",
      part: "turret",
      kind: "rotation",
      axis: "y",
      pivot: [0, 0, 0],
      min: 0,
      max: 6,
      rest: 0,
      drive: "auto",
    },
    {
      name: "tread_l",
      part: "chassis",
      kind: "translation",
      axis: "x",
      pivot: [0, 0, 0],
      min: 0,
      max: 1,
      rest: 0,
      drive: "auto",
    },
  ],
  animations: [
    {
      name: "idle",
      periodMs: 2000,
      looping: true,
      autoPlay: true,
      joints: ["radar_spin"],
      tracks: [
        {
          joint: "radar_spin",
          keyframes: [
            { tMs: 0, value: 0, interp: "linear" },
            { tMs: 2000, value: 6, interp: "linear" },
          ],
        },
      ],
    },
    {
      name: "bombardment",
      periodMs: 4000,
      looping: true,
      autoPlay: false,
      joints: ["turret_yaw", "tread_l"],
      tracks: [
        {
          joint: "turret_yaw",
          keyframes: [
            { tMs: 0, value: -1, interp: "ease-in-out" },
            { tMs: 4000, value: 1, interp: "linear" },
          ],
        },
      ],
    },
  ],
};

function part(name: string): VoxelResultView["parts"][number] {
  return {
    name,
    meshUrl: `meshes/${name}.glb`,
    previewUrl: `parts/${name}.png`,
    actionsUrl: `parts/${name}.actions.json`,
    operationCount: 10,
    voxelCount: 100,
    detail: null,
  };
}

const VIEW: VoxelResultView = {
  animated: true,
  skinned: false,
  skinnedMeshUrl: null,
  rig: RIG,
  model: RIG,
  parts: [part("chassis"), part("turret")],
  detail: null,
};

describe("VoxelResultSection (animated)", () => {
  it("mounts exactly one shared 3D viewer for a multi-joint rig", async () => {
    // Regression guard: the section used to render a 3D canvas per animation and
    // joint — each its own WebGL context, exhausting the browser's active-context
    // budget so the views blanked. The whole rig must now play through a single
    // shared viewer.
    await act(async () => {
      render(<VoxelResultSection view={VIEW} />);
    });

    expect(screen.getAllByTestId("voxel-viewer")).toHaveLength(1);
  });

  it("exposes the rig's animations, caller joints, and meshes across modes", async () => {
    await act(async () => {
      render(<VoxelResultSection view={VIEW} />);
    });

    // Animations mode (default): every animation is selectable; caller joints are not
    // shown here.
    expect(screen.getByRole("button", { name: /idle/ })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /bombardment/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: /turret_yaw/ })).toBeNull();

    // Joints mode: each caller joint gets a slider. `auto` joints (driven only by the
    // animations) are not posable on their own.
    fireEvent.click(screen.getByRole("radio", { name: "Joints" }));
    expect(
      screen.getByRole("slider", { name: /turret_yaw/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: /gun_pitch/ })).toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: /radar_spin/ })).toBeNull();
    expect(screen.queryByRole("slider", { name: /tread_l/ })).toBeNull();

    // Meshes mode: every part is listed for isolation, alongside an "All parts" entry.
    fireEvent.click(screen.getByRole("radio", { name: "Meshes" }));
    expect(
      screen.getByRole("button", { name: /All parts/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /chassis/ })).toBeInTheDocument();
  });

  it("counts the joints an animation actually drives, from its tracks", async () => {
    await act(async () => {
      render(<VoxelResultSection view={VIEW} />);
    });

    // `bombardment` declares two joints but its produced tracks drive only one, so the
    // summary reflects the one it actually animates — not "0 joints" (the bug this
    // guards, from reading the empty declared list) and not the declared two.
    expect(
      screen.getByRole("button", { name: /bombardment/ }),
    ).toHaveTextContent("1 joint ·");
  });

  it("shows the model's geometry stats (bounding box, vertices, triangles)", async () => {
    await act(async () => {
      render(<VoxelResultSection view={VIEW} />);
    });

    // The mock chassis mesh is a single triangle: 3 vertices, 1 triangle.
    expect(screen.getByText(/3 verts/)).toBeInTheDocument();
    expect(screen.getByText(/1 tris/)).toBeInTheDocument();
  });

  it("offers a GIF download for an animation, not for posed joints", async () => {
    await act(async () => {
      render(<VoxelResultSection view={VIEW} />);
    });

    // The `idle` animation is selected by default; it loops over a period, so it can
    // be baked to a GIF.
    expect(
      screen.getByRole("button", { name: "Download GIF" }),
    ).toBeInTheDocument();

    // Joints mode poses with a slider, not time — nothing to capture.
    fireEvent.click(screen.getByRole("radio", { name: "Joints" }));
    expect(screen.queryByRole("button", { name: "Download GIF" })).toBeNull();

    // Back in Animations, a named playable loops over its period, so it returns.
    fireEvent.click(screen.getByRole("radio", { name: "Animations" }));
    fireEvent.click(screen.getByRole("button", { name: /bombardment/ }));
    expect(
      screen.getByRole("button", { name: "Download GIF" }),
    ).toBeInTheDocument();
  });
});
