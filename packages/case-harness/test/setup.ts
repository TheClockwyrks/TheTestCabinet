// The per-worker teardown, registered the way a case's `validation/<engine>/setup.ts`
// registers it — which is also the only thing that exercises `src/setup.ts`.

import { registerWorkerTeardown } from "../src/setup";

registerWorkerTeardown();
