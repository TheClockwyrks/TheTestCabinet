import { Link } from "react-router";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { RunsTabs } from "../runs/RunsTabs";
import { useAuth } from "../../../client/auth";
import { useGalleryData } from "../../data/galleryContext";
import { routes } from "../../routes";
import { ComparisonsList } from "./ComparisonsList";
import exec from "../runs/RunExec.module.scss";

// The Runs section's **Comparisons** tab (`/runs/comparisons`): the harness
// comparisons list, beside the default **Tests** tab. Rendered on every host —
// the console shows the signed-in account's comparisons with a "New comparison"
// action, the read-only static site shows the published set off the snapshot
// (mutations gate on `canExecute`). Mirrors `RunsPage`/`UnreviewedPage`: the
// PageLayout + prompt header + shared `RunsTabs`, then the list body.
export function ComparisonsIndexPage() {
  const { canExecute } = useGalleryData();
  const { token } = useAuth();

  return (
    <PageLayout>
      {/* The action sits in the title row, beside the prompt header — the same
          shape the Runs tab gives "+ New run". Creating a comparison is
          console-only (it is saved to an account); the read-only static site
          renders the published list without it. */}
      <div className={exec.runsHeader}>
        <PromptHeader
          command="--runs/comparisons"
          comment={
            <>
              // the same benchmark under several configurations, side by side
            </>
          }
        />
        {canExecute && token && (
          <div className={exec.headerActions}>
            <Link className={exec.primary} to={routes.comparisonNew()}>
              + New comparison
            </Link>
          </div>
        )}
      </div>

      <RunsTabs active="comparisons" />

      <ComparisonsList />
    </PageLayout>
  );
}
