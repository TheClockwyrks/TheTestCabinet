import { StrictMode } from "react";
import { act, render } from "@testing-library/react";
import type { ModelSpec } from "@test-cabinet/run-record";
import type { PartMesh } from "@test-cabinet/voxel-runtime";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A stand-in for the three.js `VoxelRig` that records every instance built and
// whether it was disposed, so a test can assert the rig the viewer actually renders
// with is still alive. The real rig owns GPU resources jsdom can't provide.
const rigMock = vi.hoisted(() => {
  const instances: { disposed: boolean; usedAfterDispose: boolean }[] = [];
  class FakeVoxelRig {
    root = { name: "voxel-rig" };
    disposed = false;
    usedAfterDispose = false;
    constructor() {
      instances.push(this);
    }
    // Any posing call after disposal means the viewer is driving a rig whose GPU
    // geometry was freed and whose part groups were detached — i.e. a blank canvas.
    private use() {
      if (this.disposed) this.usedAfterDispose = true;
    }
    playAnimation() {
      this.use();
    }
    pose() {
      this.use();
    }
    update() {
      this.use();
    }
    dispose() {
      this.disposed = true;
    }
  }
  return { instances, FakeVoxelRig };
});

// The R3F canvas and drei controls need a real WebGL context; render their children
// straight into the DOM so the rig-lifecycle logic under test runs without one.
vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="canvas">{children}</div>
  ),
  useFrame: () => {},
}));
vi.mock("@react-three/drei", () => ({ OrbitControls: () => null }));
vi.mock("@test-cabinet/voxel-runtime/three", () => ({
  VoxelRig: rigMock.FakeVoxelRig,
}));

// Imported after the mocks are registered.
import VoxelViewer from "./VoxelViewer";

// A single-triangle {@link PartMesh} — enough geometry for the viewer to build a
// rig and frame the camera without a real mesher.
const MESH: PartMesh = {
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
  colors: [1, 1, 1, 1, 1, 1, 1, 1, 1],
  indices: [0, 1, 2],
};
const RIG: ModelSpec = { parts: [{ name: "model", pivot: [0, 0, 0] }], joints: [] };

describe("VoxelViewer", () => {
  beforeEach(() => {
    rigMock.instances.length = 0;
  });

  it("never poses a rig after disposing it under StrictMode's double-invoke", async () => {
    // Regression guard for the "model appears then vanishes" bug: the rig was built
    // in `useMemo` and disposed in an effect cleanup. StrictMode's setup → cleanup →
    // setup then disposed the rig the viewer kept posing — geometry freed, part groups
    // detached — so the canvas went blank a frame after the model appeared. Building
    // the rig in the effect means a disposed rig is always one a fresh setup replaced,
    // never one the viewer still drives.
    await act(async () => {
      render(
        <StrictMode>
          <VoxelViewer meshes={MESH} rig={RIG} mode="orbit" label="test" />
        </StrictMode>,
      );
    });

    expect(rigMock.instances.length).toBeGreaterThan(0);
    for (const rig of rigMock.instances) {
      expect(rig.usedAfterDispose).toBe(false);
    }
  });

  it("disposes every rig it built once unmounted", async () => {
    let unmount = () => {};
    await act(async () => {
      const result = render(
        <StrictMode>
          <VoxelViewer meshes={MESH} rig={RIG} mode="auto-rotate" label="test" />
        </StrictMode>,
      );
      unmount = result.unmount;
    });
    await act(async () => {
      unmount();
    });

    // No GPU geometry is leaked: unmounting disposes whatever rigs were built.
    expect(rigMock.instances.length).toBeGreaterThan(0);
    for (const rig of rigMock.instances) expect(rig.disposed).toBe(true);
  });
});
