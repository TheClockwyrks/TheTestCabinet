import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import type { GgConfigInput } from "@test-cabinet/run-record/gg";
import { useAuth } from "../../../client/auth";
import { useBackend } from "../../../client/context";
import type { Model } from "../../../client/types";
import { BackChevron } from "../../components/BackChevron";
import { LoadingState } from "../../components/LoadingState";
import { PageLayout } from "../../components/PageLayout";
import { UnsavedChangesDialog } from "./UnsavedChangesDialog";
import { routes } from "../../routes";
import { GgConfigEditor } from "../runs/gg/GgConfigEditor";
import {
  agentSourcesFromDraft,
  attachAgentSources,
  resolveCapabilitySet,
  savedAgentFromProfile,
} from "../runs/gg/ggAgentLibrary";
import { useGgAgents } from "../runs/gg/useGgAgents";
import {
  agentSaveError,
  capabilitySetFromDraft,
  draftFromCapabilitySet,
  draftSaveError,
  emptyDraft,
  resetAgentForMode,
  type GgConfigDraft,
} from "../runs/gg/ggConfigDraft";
import exec from "../runs/RunExec.module.scss";
import styles from "./Coverage.module.scss";

// What a configuration looked like when it was loaded (or last saved), as the one string
// the dirty check compares against. The capability set is serialized because that is the
// form the configuration is actually stored in — it ignores the editor's internal ids and
// the order the agents happen to sit in, so reopening and closing a configuration without
// touching it never counts as a change.
function snapshotOf(name: string, description: string, draft: GgConfigDraft) {
  return JSON.stringify({
    name: name.trim(),
    description: description.trim(),
    set: capabilitySetFromDraft(draft, null),
    // Which profiles follow a saved agent, and what each pins, is part of the
    // configuration: importing one and immediately detaching it is a change.
    sources: agentSourcesFromDraft(draft),
  });
}

// The gg configuration editor (`/account/gg/new` and `/account/gg/:configId/edit`):
// a configuration's name, its one-line purpose, and the capability set itself.
// Save creates or updates and returns to the gg tab.
//
// The page has two modes, because the editor does: on the **configuration** the header
// carries Save configuration, and while an **agent** is open it carries that agent's own
// Cancel / Save agent instead — an agent is saved (or cancelled) back onto the
// configuration first, and only the configuration itself is written to the account. That
// is also what keeps a configuration-level complaint ("the `reviewer` agent defers to no
// declared slot") off the screen while a different agent is being edited.
//
// A configuration is deliberately test-case-free and need not bind a model: the New
// run page supplies the case and binds the primary slot from its own model picker,
// so one configuration serves a whole sweep. Console-only; gated on a signed-in
// account.
export function GgConfigEditPage() {
  const { configId } = useParams();
  const editing = Boolean(configId);
  const [params] = useSearchParams();
  // `?from=saved:<id>` seeds a new configuration from an existing one — how the list
  // page's Duplicate action works.
  const from = params.get("from");
  const { token } = useAuth();
  const { client: backend } = useBackend();
  const navigate = useNavigate();
  // The account's agent library: what the Agents section imports from, and what an
  // already-imported profile is resolved against on the way in.
  const {
    agents: savedAgents,
    loading: agentsLoading,
    error: agentsError,
    reload: reloadAgents,
  } = useGgAgents();

  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [savingAgent, setSavingAgent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [draft, setDraft] = useState<GgConfigDraft>(() => emptyDraft());
  // What the form held when it was loaded — the baseline the unsaved-changes prompt
  // measures against.
  const [saved, setSaved] = useState<string | null>(null);
  // Which agent's view is open, and the whole draft as it was when it opened: cancelling
  // an agent restores that, which is what makes Cancel mean something on a form that
  // edits a single draft in place.
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [agentSnapshot, setAgentSnapshot] = useState<GgConfigDraft | null>(
    null,
  );
  // Which back control the "you have unsaved changes" prompt intercepted, or `null` when
  // it is not up. One piece of state rather than one per control, because the two are
  // mutually exclusive: the prompt asks about exactly the step being taken.
  const [leaving, setLeaving] = useState<"agent" | "config" | null>(null);

  useEffect(() => {
    if (!backend || !token) {
      setLoading(false);
      return;
    }
    // The library has to be in hand before a stored configuration is loaded: an
    // imported profile is the saved agent with this configuration's overrides on top,
    // and loading it against an empty library would open the editor on the last
    // resolved copy and then quietly re-save it as one.
    if (agentsLoading) return;
    let active = true;
    setLoading(true);
    setError(null);
    // Seed the form and take the baseline the unsaved-changes prompt measures against —
    // whatever the form opened on is, by definition, unedited.
    const seed = (
      nextName: string,
      nextDescription: string,
      nextDraft: GgConfigDraft,
    ) => {
      setName(nextName);
      setDescription(nextDescription);
      setDraft(nextDraft);
      setSaved(snapshotOf(nextName, nextDescription, nextDraft));
    };
    // A blank configuration needs no round-trip; everything else reads the account's
    // stored configurations (to load the one being edited, or the one duplicated).
    if (!editing && !from) {
      seed("", "", emptyDraft());
      setLoading(false);
    } else {
      Promise.resolve(backend.listGgConfigs?.(token) ?? [])
        .then((configs) => {
          if (!active) return;
          const wantedId = editing
            ? configId
            : from?.startsWith("saved:")
              ? from.slice("saved:".length)
              : undefined;
          const found = configs.find((c) => c.id === wantedId);
          if (!found) {
            setError("That configuration no longer exists.");
          } else {
            seed(
              editing ? found.name : `${found.name} (copy)`,
              found.description,
              attachAgentSources(
                draftFromCapabilitySet(
                  resolveCapabilitySet(found, savedAgents),
                ),
                found.agentSources,
                savedAgents,
              ),
            );
          }
          setLoading(false);
        })
        .catch((e) => {
          if (!active) return;
          setError(String(e));
          setLoading(false);
        });
    }
    backend
      .listModels()
      .then((ms) => active && setModels(ms))
      .catch(() => {
        // The model catalog is optional; the slot pickers stay free-text.
      });
    return () => {
      active = false;
    };
  }, [backend, token, editing, configId, from, agentsLoading, savedAgents]);

  // A library that failed to load leaves every imported profile looking inline, and
  // saving would then record it as inline for good. Refuse to save at all until the
  // library is in hand, and say why.
  const libraryError = agentsError
    ? "Your saved agents could not be loaded, so this configuration cannot be saved without losing which agents it follows. Reload the page."
    : null;
  const structuralError = draftSaveError(draft) ?? libraryError;
  const savable = name.trim().length > 0 && structuralError === null && !busy;
  // Only what is wrong with the open agent — a configuration-level complaint about some
  // other agent is not this view's business, and cannot be fixed from it.
  const agentError = editingAgentId
    ? agentSaveError(draft, editingAgentId)
    : null;

  const dirty = useMemo(
    () => saved !== null && snapshotOf(name, description, draft) !== saved,
    [saved, name, description, draft],
  );

  // Leaving with unsaved work needs a confirmation, whichever way the operator leaves:
  // the page's own back control (below) and a full-page navigation (here). A React Router
  // navigation triggered outside this page cannot be intercepted under a `BrowserRouter`
  // — there is no data router to block on — so the back control is deliberately the one
  // in-app exit, and it raises the same dialog an open agent's does. The browser's own
  // prompt is only for the case no component can cover: the tab going away.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // Whether the open agent has been edited since it was opened. Measured against the
  // banked draft rather than against the saved configuration, because this is the
  // question the agent's own Cancel and back control ask: "would leaving now throw
  // anything away?" — not "does this configuration differ from the stored one?".
  const agentDirty = useMemo(
    () =>
      agentSnapshot !== null &&
      JSON.stringify(agentSnapshot) !== JSON.stringify(draft),
    [agentSnapshot, draft],
  );

  // Opening an agent banks the draft so Cancel has something to restore; saving the agent
  // simply keeps the edits already applied and returns to the configuration.
  function onEditingAgentChange(
    agentId: string | null,
    snapshot?: GgConfigDraft,
  ) {
    // The editor supplies the snapshot when opening an agent it produced in the same
    // act, because this render's `draft` predates it.
    setAgentSnapshot(agentId ? (snapshot ?? draft) : null);
    setEditingAgentId(agentId);
  }
  function cancelAgent() {
    if (agentSnapshot) setDraft(agentSnapshot);
    setAgentSnapshot(null);
    setEditingAgentId(null);
    setLeaving(null);
  }
  // Saving an agent keeps the edits already applied and returns to the configuration —
  // and commits its **type**: what the other types were configured with was scratch
  // space the editor held so that switching type and back lost nothing, and an agent
  // that has been saved carries the configuration of the type it was saved under and no
  // other. Winding it back here is what makes reopening the agent and switching type
  // show that type's defaults, exactly as it would after a reload (the save path writes
  // no capability the agent's type does not read).
  function saveAgent() {
    if (agentError) return;
    setDraft((current) => ({
      ...current,
      agents: current.agents.map((a) =>
        a.id === editingAgentId ? resetAgentForMode(a) : a,
      ),
    }));
    setAgentSnapshot(null);
    setEditingAgentId(null);
    setLeaving(null);
  }

  // The back control beside the title, while an agent is open. Its parent is the
  // configuration the agent belongs to — the step the operator actually took to get here
  // — not the list of configurations, which is two steps up and would throw the whole
  // configuration away rather than just this agent's edits.
  //
  // It behaves like Cancel, except that it asks first when there is something to lose.
  // Cancel itself does not ask: it says what it does, and an operator who presses it has
  // already made the decision this dialog exists to collect.
  function backFromAgent() {
    if (agentDirty) setLeaving("agent");
    else cancelAgent();
  }

  // The back control beside the title on the configuration itself, one step up to the
  // list of configurations. It asks the same question the agent's does, through the same
  // dialog: two different prompts for one question made the form read as two forms.
  function backFromConfig() {
    if (dirty) setLeaving("config");
    else navigate(routes.accountGgConfigs());
  }

  // Write the open profile to the account's agent library and leave this configuration
  // following it. The profile is unchanged by this: what it saves is exactly what it
  // already is, so the import it becomes pins nothing.
  async function saveAgentToLibrary(agentId: string) {
    if (!token || !backend?.createGgAgent) return;
    const body = savedAgentFromProfile(draft, agentId);
    if (!body) return;
    setSavingAgent(true);
    setError(null);
    try {
      const created = await backend.createGgAgent(
        { description: "", agent: body.agent, modelSlots: body.modelSlots },
        token,
      );
      const linked = (current: GgConfigDraft): GgConfigDraft => ({
        ...current,
        agents: current.agents.map((a) =>
          a.id === agentId
            ? {
                ...a,
                source: {
                  agentId: created.id,
                  name: created.name,
                  base: created.agent,
                  modelSlots: created.modelSlots,
                },
              }
            : a,
        ),
      });
      setDraft(linked);
      // The link is not work the agent's Cancel should throw away: the library entry
      // exists either way, and undoing only the link would leave the two apart.
      setAgentSnapshot((current) => (current ? linked(current) : current));
      await reloadAgents();
    } catch (e) {
      setError(String(e));
    } finally {
      setSavingAgent(false);
    }
  }

  async function onSave() {
    if (!token || !savable) return;
    const input: GgConfigInput = {
      name: name.trim(),
      description: description.trim(),
      // A saved configuration records its own name as the `preset` facet, so every
      // run launched from it is sliceable by which configuration produced it.
      capabilitySet: capabilitySetFromDraft(draft, name.trim()),
      // Stored beside the resolved set: gg reads the set, and this is what says which
      // fields of which profile still follow a saved agent.
      agentSources: agentSourcesFromDraft(draft),
    };
    setBusy(true);
    setError(null);
    try {
      if (editing && configId && backend?.updateGgConfig) {
        await backend.updateGgConfig(configId, input, token);
      } else if (backend?.createGgConfig) {
        await backend.createGgConfig(input, token);
      }
      navigate(routes.accountGgConfigs());
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }

  const openAgent = draft.agents.find((a) => a.id === editingAgentId);

  // The open view's commit controls, sat opposite the title. They belong in the header
  // rather than under the form because the form is tabbed: an action parked below the
  // last tab's content moves as the operator changes tab, and on a long tab it is off
  // screen entirely. In the header it is in one place on every tab, and the view that
  // owns it — the configuration, or the agent open on top of it — is named right beside
  // it. Nothing is offered before the form exists: signed out or still loading, the
  // header is the title alone.
  const headerActions =
    !token || loading ? null : openAgent ? (
      <div className={styles.detailActions}>
        {agentError && <span className={exec.muted}>{agentError}</span>}
        <button type="button" className={exec.secondary} onClick={cancelAgent}>
          Cancel
        </button>
        <button
          type="button"
          className={exec.primary}
          onClick={saveAgent}
          disabled={agentError !== null}
        >
          Save agent
        </button>
      </div>
    ) : (
      <div className={styles.detailActions}>
        {structuralError && (
          <span className={exec.muted}>{structuralError}</span>
        )}
        <button
          type="button"
          className={exec.primary}
          onClick={onSave}
          disabled={!savable}
        >
          {busy
            ? "Saving…"
            : editing
              ? "Save configuration"
              : "Create configuration"}
        </button>
      </div>
    );

  const header = (
    <header className={styles.detailHeader}>
      <div className={styles.detailTitleRow}>
        {/* Back goes up exactly one step, which is a different place depending on what
            is open: an agent's parent is the configuration it belongs to (an in-page
            view), and the configuration's parent is the list of them (a route). Both
            take that step through `onBack` rather than as a link, because both must ask
            first when there is work to lose, and the dialog that asks answers long after
            the click a link would have to allow or cancel on the spot. */}
        <BackChevron
          label={
            openAgent
              ? `Back to ${name.trim() || "the configuration"}`
              : "All gg configurations"
          }
          onBack={openAgent ? backFromAgent : backFromConfig}
        />
        <h1 className={styles.detailTitle}>
          {openAgent
            ? `${openAgent.name.trim() || "Agent"} — agent`
            : editing
              ? name || "Configuration"
              : "New gg configuration"}
        </h1>
      </div>
      {headerActions}
    </header>
  );

  if (!token) {
    return (
      <PageLayout>
        {header}
        <p className={`${exec.notice} ${exec.warn}`}>
          Sign in to edit gg configurations — they are saved to your account.
        </p>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      {header}

      {error && <p className={`${exec.notice} ${exec.error}`}>{error}</p>}

      {loading ? (
        <LoadingState label="Loading…" />
      ) : (
        <>
          {/* The configuration's identity now lives on the editor's Configuration tab,
              beside the ceilings and the session hooks — the whole of what a
              configuration is, in one section. */}
          <GgConfigEditor
            value={draft}
            onChange={setDraft}
            name={name}
            onNameChange={setName}
            description={description}
            onDescriptionChange={setDescription}
            editingAgentId={editingAgentId}
            onEditingAgentChange={onEditingAgentChange}
            models={models}
            savedAgents={savedAgents}
            onSaveAgentToLibrary={
              backend?.createGgAgent ? saveAgentToLibrary : undefined
            }
            savingAgent={savingAgent}
          />

          {/* Raised by whichever back control was pressed with work to lose. One
              component asks the question in both places: saving from here is exactly
              what the header's own button does — including its refusal to commit
              something that is not well-formed, which is why the reason is repeated in
              the dialog rather than left on a button the operator can no longer see. */}
          {leaving === "agent" && openAgent && (
            <UnsavedChangesDialog
              title={`Unsaved changes to ${openAgent.name.trim() || "this agent"}`}
              body="Going back to the configuration will leave this agent as it was when you opened it."
              saveLabel="Save agent"
              saveDisabled={agentError !== null}
              saveBlockedReason={agentError}
              onSave={saveAgent}
              onDiscard={cancelAgent}
              onCancel={() => setLeaving(null)}
            />
          )}
          {leaving === "config" && (
            <UnsavedChangesDialog
              title="Unsaved changes to this configuration"
              body="Going back to the list of configurations will leave it as it was last saved."
              saveLabel={
                editing ? "Save configuration" : "Create configuration"
              }
              saveDisabled={!savable}
              saveBlockedReason={structuralError}
              // The dialog closes on the decision, not on the outcome: saving navigates
              // to the list itself when it succeeds, and when it fails the page is left
              // showing the error it reports rather than a modal sat on top of it.
              onSave={() => {
                setLeaving(null);
                void onSave();
              }}
              onDiscard={() => navigate(routes.accountGgConfigs())}
              onCancel={() => setLeaving(null)}
            />
          )}
        </>
      )}
    </PageLayout>
  );
}
