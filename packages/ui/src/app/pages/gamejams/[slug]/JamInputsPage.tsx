import { VariantInputsView } from "../../../components/VariantViews";
import { JamDetailLayout } from "../../../layouts/gamejams/JamDetailLayout";

// The Inputs tab (`/game-jams/:slug/inputs`): everything a run of the selected
// variant is given — the theme prompt the harness hands the model, the workspace
// it is seeded with, and the runtime packages it ships. A jam declares no specs
// and no reference mockups, so those sections of the shared `VariantInputsView`
// are simply empty; the rendering is otherwise identical to the test-case Inputs
// tab.
export function JamInputsPage() {
  return (
    <JamDetailLayout tab="inputs">
      {({ variant }) => <VariantInputsView variant={variant} />}
    </JamDetailLayout>
  );
}
