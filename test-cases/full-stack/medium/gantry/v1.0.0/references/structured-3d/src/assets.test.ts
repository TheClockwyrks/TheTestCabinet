import { describe, expect, it } from "vitest";
import type { Model } from "@clockwyrks/structured-3d";
import {
  loadModels,
  MODEL_NAMES,
  modelPath,
  models,
  modelsLoaded,
  setModels,
  type Models,
} from "./assets";

const stub = (name: string): Model =>
  ({ scene: { name }, animations: [], nodes: [] }) as unknown as Model;

describe("the produced models", () => {
  it("names the eight `specs/assets.md` lists", () => {
    expect([...MODEL_NAMES]).toEqual([
      "ring",
      "trolley",
      "hook",
      "counterweight",
      "mount",
      "crate",
      "container",
      "drum",
    ]);
  });

  it("commits each under its own name below the asset root", () => {
    expect(modelPath("hook")).toBe("models/hook.glb");
  });

  it("loads every one through the engine's loader, in one pass", async () => {
    const asked: string[] = [];
    const loaded = await loadModels({
      loadModel: (path: string) => {
        asked.push(path);
        return Promise.resolve(stub(path));
      },
    } as unknown as Parameters<typeof loadModels>[0]);
    expect(asked).toEqual(MODEL_NAMES.map(modelPath));
    expect(Object.keys(loaded)).toHaveLength(MODEL_NAMES.length);
  });

  it("throws before the load has resolved, and hands them back after", () => {
    expect(modelsLoaded()).toBe(false);
    expect(() => models()).toThrow(/not loaded/);
    const all = Object.fromEntries(
      MODEL_NAMES.map((name) => [name, stub(name)]),
    ) as Models;
    setModels(all);
    expect(modelsLoaded()).toBe(true);
    expect(models().hook).toBe(all.hook);
  });
});
