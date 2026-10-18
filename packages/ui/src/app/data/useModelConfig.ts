import { useMemo } from "react";
import { useOptionalBackend } from "../../client/context";
import type {
  ListPriceRefresh,
  Model,
  ModelInput,
  ModelListing,
  ModelSeed,
} from "../../client/types";
import { useGalleryData } from "./galleryContext";

// The model-configuration capability, bound to the active backend client. Present
// only where curating models is actually possible — a console that can execute
// (`canExecute`) and a backend whose transport exposes the config mutations (the
// static site's snapshot transport omits them). The backend decides who may curate
// from the identity the edge asserts. When either is missing the
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
  /** What OpenRouter publishes about a slug, to fill the form in with. The
   * prices are the given developer provider's while it lists a complete rate. */
  lookupOpenrouter(
    slug: string,
    providerPin?: string | null,
  ): Promise<ModelListing>;
  /** Re-read every curated entry's list price from OpenRouter. */
  refreshListPrices(): Promise<ListPriceRefresh>;
}

/**
 * The model-configuration capability, or `null` when configuring models is not
 * possible here (a read-only host or a transport without the mutations).
 * Bind the returned methods to the backend client so callers never juggle the
 * optional-method checks themselves.
 */
export function useModelConfig(): ModelConfigApi | null {
  const { canExecute } = useGalleryData();
  // The static site mounts no `BackendProvider`; treat its absence like an
  // unconfigured backend so the model-config affordance simply hides there
  // rather than crashing the page.
  const client = useOptionalBackend()?.client ?? null;

  return useMemo<ModelConfigApi | null>(() => {
    // Every condition curating a model needs; any one missing hides the
    // affordance. `createModel` standing in for the whole config surface — a
    // transport that exposes one exposes them all (they share the mutation gate).
    if (
      !canExecute ||
      !client?.createModel ||
      !client.updateModel ||
      !client.deleteModel ||
      !client.fetchModelLogo ||
      !client.seedModelFromRun ||
      !client.lookupOpenrouterModel ||
      !client.refreshListPrices
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
      lookupOpenrouterModel,
    } = client;
    const refreshListPrices = client.refreshListPrices.bind(client);
    return {
      createModel: (input) => createModel(input),
      updateModel: (slug, input) => updateModel(slug, input),
      deleteModel: (slug) => deleteModel(slug),
      fetchLogo: async (url) => (await fetchModelLogo(url)).logoSvg,
      seedFromRun: (runId) => seedModelFromRun(runId),
      lookupOpenrouter: (slug, providerPin) =>
        lookupOpenrouterModel(slug, providerPin),
      refreshListPrices: () => refreshListPrices(),
    };
  }, [canExecute, client]);
}
