import type { ReactNode } from "react";
import { Link, NavLink, useParams } from "react-router";
import { PageLayout } from "../../components/PageLayout";
import { AddModelFromRunControl } from "../../components/AddModelFromRunControl";
import { BackChevron } from "../../components/BackChevron";
import { ModelProviderMark } from "../../components/ModelProviderMark";
import type { ModelSummary } from "../../data/models";
import { useModelConfig } from "../../data/useModelConfig";
import { useModels } from "../../data/useModels";
import { routes } from "../../routes";
import styles from "./ModelDetailLayout.module.scss";

// The model detail page's tabs. Each is a distinct route; this drives which tab
// link reads as active.
export type ModelDetailTab = "about" | "stats" | "pricing" | "runs";

interface ModelDetailLayoutProps {
  /** Which tab the rendering page represents. */
  tab: ModelDetailTab;
  /** The tab body, given the resolved model. */
  children: (ctx: { model: ModelSummary }) => ReactNode;
}

// Shared chrome for every model detail tab: the provider mark and model name,
// the OpenRouter link, the provider line, and the tab navigation. It resolves
// the model from the URL — by catalog slug or by a covered model id, so both
// `/models/<slug>` and `/models/<modelId>` land here — then hands it to the
// active tab's body. Resolving (and the unknown-model state) lives here so the
// tab pages stay thin and never duplicate it.
export function ModelDetailLayout({ tab, children }: ModelDetailLayoutProps) {
  const { modelId } = useParams<{ modelId: string }>();
  const { models } = useModels();
  // The edit affordance shows only where curating models is possible; null (and
  // thus hidden) on a read-only or logged-out host.
  const config = useModelConfig();
  const model = models.find(
    (entry) => entry.slug === modelId || entry.modelIds.includes(modelId ?? ""),
  );

  if (!model) {
    return (
      <PageLayout>
        <p className={styles.empty}>Unknown model: {modelId}</p>
        <p className={styles.line}>
          <Link to={routes.models()}>&larr; All models</Link>
        </p>
      </PageLayout>
    );
  }

  const tabs: { key: ModelDetailTab; label: string; to: string }[] = [
    { key: "about", label: "About", to: routes.modelDetail(model.slug) },
    { key: "stats", label: "Stats", to: routes.modelStats(model.slug) },
    { key: "pricing", label: "Pricing", to: routes.modelPricing(model.slug) },
    { key: "runs", label: "Runs", to: routes.modelRuns(model.slug) },
  ];

  return (
    <PageLayout>
      <header className={styles.identity}>
        <div className={styles.titleRow}>
          {/* The back chevron and provider mark hugging the model name, then the
              OpenRouter link pushed to the right edge. */}
          <span className={styles.nameGroup}>
            <BackChevron to={routes.models()} label="All models" />
            <ModelProviderMark
              logoSvg={model.logoSvg}
              provider={model.provider}
              className={styles.logo}
            />
            <h1 className={styles.title}>{model.name}</h1>
            {/* A model the catalog only knows from its runs (no curated config)
                reads with a subtle tag so it's distinct from a curated entry. */}
            {!model.isConfigured && (
              <span className={styles.derivedTag} title="Derived from runs — not yet curated">
                derived
              </span>
            )}
          </span>
          {model.openrouterUrl && (
            <a
              className={styles.openrouter}
              href={model.openrouterUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="View on OpenRouter"
              title="View on OpenRouter"
            >
              <span className={styles.openrouterIcon} aria-hidden="true" />
            </a>
          )}
        </div>
        <p className={styles.provider}>{model.provider}</p>
      </header>

      <div className={styles.controls}>
        <nav className={styles.tabs} aria-label="Model sections">
          {tabs.map((entry) => (
            <NavLink
              key={entry.key}
              to={entry.to}
              className={
                entry.key === tab
                  ? `${styles.tab} ${styles.tabActive}`
                  : styles.tab
              }
            >
              {entry.label}
            </NavLink>
          ))}
        </nav>
        {/* A curated model offers a gated Edit link; a derived one offers the
            "Add this model" affordance to promote it to a curated config. Both are
            hidden where configuring models isn't possible. */}
        {model.isConfigured
          ? config && (
              <Link
                className={styles.editLink}
                to={routes.modelEdit(model.slug)}
              >
                Edit
              </Link>
            )
          : (
              <AddModelFromRunControl
                alias={model.modelIds[0] ?? model.slug}
                className={styles.headerAction}
              />
            )}
      </div>

      {children({ model })}
    </PageLayout>
  );
}
