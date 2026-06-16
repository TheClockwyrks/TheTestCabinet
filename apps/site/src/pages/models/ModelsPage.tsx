import { Link } from "react-router";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { useModels } from "../../data/useModels";
import { providerLogo } from "../../data/providerLogo";
import { routes } from "../../routes";
import styles from "./ModelsPage.module.scss";

// Models: the curated catalog as a grid of neon-outlined cards, one per model,
// each showing its name and provider and linking to the model's detail page.
// This is a browse view, not a leaderboard — models are listed in catalog
// order with no ranking or score.
export function ModelsPage() {
  const { models } = useModels();

  return (
    <PageLayout>
      <section className={styles.section}>
        <PromptHeader
          command="--models"
          comment={<>// the models we put through the cabinet</>}
        />

        {models.length === 0 ? (
          <p className={styles.empty}>No models are in the catalog yet.</p>
        ) : (
          <div className={styles.grid}>
            {models.map((model) => {
              const logo = providerLogo(model.provider);
              return (
                <Link
                  key={model.slug}
                  to={routes.modelDetail(model.slug)}
                  className={styles.card}
                >
                  <span className={styles.identity}>
                    {logo && (
                      <span
                        className={styles.logo}
                        style={{
                          maskImage: `url(${logo})`,
                          WebkitMaskImage: `url(${logo})`,
                        }}
                        aria-hidden="true"
                      />
                    )}
                    <span className={styles.name}>{model.name}</span>
                  </span>
                  <span className={styles.provider}>{model.provider}</span>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </PageLayout>
  );
}
