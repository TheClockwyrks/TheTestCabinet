import { useCallback, useState } from "react";
import { Link } from "react-router";
import type { GgSavedAgent } from "@test-cabinet/run-record/gg";
import { useAuth } from "../../../client/auth";
import { useBackend } from "../../../client/context";
import { useConfirm } from "../../components/ConfirmDialog";
import { LoadingState } from "../../components/LoadingState";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { routes } from "../../routes";
import { AccountTabs } from "./AccountTabs";
import { useGgAgents } from "../runs/gg/useGgAgents";
import { agentModeLabel } from "../runs/gg/ggAgentLibrary";
import { SubmitNotice } from "../../components/SubmitNotice";
import exec from "../runs/RunExec.module.scss";
import styles from "./Coverage.module.scss";

// The gg Agents tab (`/account/gg/agents`): the operator's saved agent profiles.
//
// A profile saved here is authored once and imported by any number of
// configurations, which then follow it in every field they do not override. It is an
// authoring surface only: a saved agent owns no memories, no skills and no other
// per-agent store, so importing one into two configurations shares nothing at run time.
export function GgAgentsPage() {
  const { token } = useAuth();
  const { client: backend } = useBackend();
  const { agents, loading, error, reload } = useGgAgents();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const { confirm } = useConfirm();

  const deleteAgent = useCallback(
    async (agent: GgSavedAgent) => {
      if (!backend?.deleteGgAgent || !token) return;
      if (
        !(await confirm({
          title: "Delete gg agent",
          message: `Delete “${agent.name}”? Configurations that imported it keep their own copy and stop following this one. This cannot be undone.`,
          confirmLabel: "Delete",
        }))
      ) {
        return;
      }
      setBusy(true);
      setActionError(null);
      try {
        await backend.deleteGgAgent(agent.id, token);
        await reload();
      } catch (e) {
        setActionError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [backend, token, reload, confirm],
  );

  const renderAgent = (agent: GgSavedAgent) => {
    const on = (agent.agent.capabilities ?? []).filter((c) => c.enabled).length;
    return (
      <div key={agent.id} className={styles.rowCard}>
        <div className={styles.rowMain}>
          <Link
            className={styles.rowTitleLink}
            to={routes.accountGgAgentEdit(agent.id)}
          >
            {agent.name}
          </Link>
          <span className={styles.rowSub}>
            {agent.description ? `${agent.description} · ` : ""}
            {agentModeLabel(agent.agent)} · {on} capabilities on
          </span>
        </div>
        <span className={styles.rowActions}>
          <Link
            className={exec.secondary}
            to={routes.accountGgAgentEdit(agent.id)}
          >
            Edit
          </Link>
          <Link
            className={exec.secondary}
            to={routes.accountGgAgentNew(agent.id)}
          >
            Duplicate
          </Link>
          <button
            type="button"
            className={exec.danger}
            disabled={busy}
            onClick={() => deleteAgent(agent)}
          >
            Delete
          </button>
        </span>
      </div>
    );
  };

  return (
    <PageLayout>
      <PromptHeader
        command="--gg-agents"
        comment={<>// agent profiles configurations import</>}
        titleActions={
          token ? (
            <Link className={exec.primary} to={routes.accountGgAgentNew()}>
              + New agent
            </Link>
          ) : undefined
        }
      />
      <AccountTabs active="ggAgents" />

      <SubmitNotice message={error ?? actionError} />

      {!token ? (
        <p className={`${exec.notice} ${exec.warn}`}>
          Sign in to save your own gg agents — they are saved to your account.
        </p>
      ) : loading ? (
        <LoadingState size="section" label="Loading agents…" />
      ) : agents.length === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.empty}>
            You have no saved gg agents yet. Save one here to import it into any
            of your configurations, which then follow it wherever they have not
            overridden it.
          </p>
          <Link className={exec.primary} to={routes.accountGgAgentNew()}>
            Create your first agent
          </Link>
        </div>
      ) : (
        <div className={styles.list}>{agents.map(renderAgent)}</div>
      )}
    </PageLayout>
  );
}
