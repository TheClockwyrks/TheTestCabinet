import { useCallback, useState } from "react";
import { Link } from "react-router";
import type { GgConfig } from "@test-cabinet/run-record/gg";
import { useAuth } from "../../../client/auth";
import { useBackend } from "../../../client/context";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { routes } from "../../routes";
import { AccountTabs } from "./AccountTabs";
import { GgSectionTabs } from "./GgSectionTabs";
import { savedKey, useGgConfigs } from "../runs/gg/useGgConfigs";
import exec from "../runs/RunExec.module.scss";
import styles from "./Coverage.module.scss";

// The gg tab (`/account/gg`): the operator's registered gg configurations — named
// capability sets.
//
// gg is its own run mode: a run is configured by a capability set rather than a
// harness/model/orchestrator tuple, so the *configuration* is the reusable thing
// worth naming. Register one here and the New run page offers it in the harness
// slot once `gg` is chosen as the orchestrator. Console-only, and every
// configuration listed is the signed-in operator's own — there are no shared
// read-only built-ins to duplicate before you can change anything.
export function GgConfigsPage() {
  const { token } = useAuth();
  const { client: backend } = useBackend();
  // Both halves: the stored configurations, and the same ones with every imported agent
  // resolved. The row's summary is of what a run would carry, which is the resolved
  // form — a configuration following a saved agent that has since changed would
  // otherwise describe itself by the copy it was last saved with.
  const { saved, options, loading, error, reload } = useGgConfigs();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const deleteConfig = useCallback(
    async (config: GgConfig) => {
      if (!backend?.deleteGgConfig || !token) return;
      if (
        !window.confirm(
          `Delete the gg configuration “${config.name}”? Runs already launched ` +
            `from it keep their own recorded capability set. This cannot be undone.`,
        )
      ) {
        return;
      }
      setBusy(true);
      setActionError(null);
      try {
        await backend.deleteGgConfig(config.id, token);
        await reload();
      } catch (e) {
        setActionError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [backend, token, reload],
  );

  const renderSaved = (config: GgConfig) => {
    const resolved =
      options.find((option) => option.key === savedKey(config.id))
        ?.capabilitySet ?? config.capabilitySet;
    const on = (resolved.agents?.[0]?.capabilities ?? []).filter(
      (c) => c.enabled,
    ).length;
    // Distinct saved agents, not profiles: importing one agent twice is still one
    // agent this configuration follows.
    const shared = new Set(config.agentSources.map((s) => s.agentId)).size;
    return (
      <div key={config.id} className={styles.rowCard}>
        <div className={styles.rowMain}>
          <Link
            className={styles.rowTitleLink}
            to={routes.accountGgConfigEdit(config.id)}
          >
            {config.name}
          </Link>
          <span className={styles.rowSub}>
            {config.description ? `${config.description} · ` : ""}
            {on} capabilities on
            {shared
              ? ` · follows ${shared} saved ${shared === 1 ? "agent" : "agents"}`
              : ""}
          </span>
        </div>
        <span className={styles.rowActions}>
          <Link
            className={exec.secondary}
            to={routes.accountGgConfigEdit(config.id)}
          >
            Edit
          </Link>
          <Link
            className={exec.secondary}
            to={routes.accountGgConfigNew(savedKey(config.id))}
          >
            Duplicate
          </Link>
          <button
            type="button"
            className={exec.danger}
            disabled={busy}
            onClick={() => deleteConfig(config)}
          >
            Delete
          </button>
        </span>
      </div>
    );
  };

  return (
    <PageLayout>
      <div className={exec.runsHeader}>
        <PromptHeader
          command="--gg-configs"
          comment={<>// named capability sets to run gg with</>}
        />
        {token && (
          <Link className={exec.primary} to={routes.accountGgConfigNew()}>
            New configuration
          </Link>
        )}
      </div>
      <AccountTabs active="gg" />
      <GgSectionTabs active="configs" />

      {(error || actionError) && (
        <p className={`${exec.notice} ${exec.error}`}>{error ?? actionError}</p>
      )}

      {/* No section heading: every configuration on this page is the operator's own,
          so "Your configurations" would be labelling the only thing there is. */}
      {!token ? (
        <p className={`${exec.notice} ${exec.warn}`}>
          Sign in to register your own gg configurations — they are saved to
          your account.
        </p>
      ) : loading ? (
        <p className={styles.empty}>Loading configurations…</p>
      ) : saved.length === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.empty}>
            You have no gg configurations yet. Create one, then pick it on the
            New run page after choosing <code>gg</code> as the orchestrator.
          </p>
          <Link className={exec.primary} to={routes.accountGgConfigNew()}>
            Create your first configuration
          </Link>
        </div>
      ) : (
        <div className={styles.list}>{saved.map(renderSaved)}</div>
      )}
    </PageLayout>
  );
}
