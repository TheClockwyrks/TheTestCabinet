import { useMemo } from "react";
import { useAuth } from "../../client/auth";
import { useBackend } from "../../client/context";
import type { Model, ModelInput, ModelSeed } from "../../client/types";
import { useGalleryData } from "./galleryContext";

// The model-configuration capability, bound to the active backend client and the
// signed-in token. Present only where curating models is actually possible — a
// console that can execute (`canExecute`), a backend whose transport exposes the
// config mutations (the static site's snapshot transport omits them), and a
// signed-in account whose token authorizes them. When any of those is missing the
// hook returns `null`, and the caller hides the affordance entirely rather than
// showing a disabled, unexplained control — the same conjunction
// `RunDeleteControl` uses for run deletion.
export interface ModelConfigApi {
  /** Create a curated model config. */
  createModel(input: ModelInput): Promise<Model>;
  /** Update an existing curated model config. */
  updateModel(slug: string, input: ModelInput): Promise<Model>;
  /** Delete a curated model config. */
  deleteModel(slug: string): Promise<void>;
  /** Fetch + sanitize a provider logo from an svgl.app URL. */
  fetchLogo(url: string): Promise<string>;
  /** Seed a blank draft from a run of an unknown model. */
  seedFromRun(runId: string): Promise<ModelSeed>;
  /** The bearer token the mutations are authorized with. */
  token: string;
}

/**
 * The model-configuration capability, or `null` when configuring models is not
 * possible here (a read-only host, a transport without the mutations, or a
 * logged-out session). Bind the returned methods to the backend client + token so
 * callers never juggle the token or the optional-method checks themselves.
 */
export function useModelConfig(): ModelConfigApi | null {
  const { canExecute } = useGalleryData();
  const { client } = useBackend();
  const { token } = useAuth();

  return useMemo<ModelConfigApi | null>(() => {
    // Every condition curating a model needs; any one missing hides the
    // affordance. `createModel` standing in for the whole config surface — a
    // transport that exposes one exposes them all (they share the mutation gate).
    if (
      !canExecute ||
      !token ||
      !client?.createModel ||
      !client.updateModel ||
      !client.deleteModel ||
      !client.fetchModelLogo ||
      !client.seedModelFromRun
    ) {
      return null;
    }
    // Capture the resolved methods so the closures don't re-check the optionals.
    const {
      createModel,
      updateModel,
      deleteModel,
      fetchModelLogo,
      seedModelFromRun,
    } = client;
    return {
      createModel: (input) => createModel(input, token),
      updateModel: (slug, input) => updateModel(slug, input, token),
      deleteModel: (slug) => deleteModel(slug, token),
      fetchLogo: async (url) => (await fetchModelLogo(url, token)).logoSvg,
      seedFromRun: (runId) => seedModelFromRun(runId),
      token,
    };
  }, [canExecute, client, token]);
}
