import { Markdown } from "../../../components/Markdown";
import { Panel } from "../../../components/Panel";
import { ModelDetailLayout } from "../../../layouts/models/ModelDetailLayout";
import styles from "./ModelDetailPages.module.scss";

// The About tab (`/models/:modelId`): the model's site-facing description prose,
// rendered through the shared Markdown component and wrapped so it stays legible
// over the backdrop.
export function ModelAboutPage() {
  return (
    <ModelDetailLayout tab="about">
      {({ model }) => (
        <Panel>
          {model.description ? (
            <Markdown>{model.description}</Markdown>
          ) : (
            <p className={styles.empty}>
              No description has been written for {model.name} yet.
            </p>
          )}
        </Panel>
      )}
    </ModelDetailLayout>
  );
}
