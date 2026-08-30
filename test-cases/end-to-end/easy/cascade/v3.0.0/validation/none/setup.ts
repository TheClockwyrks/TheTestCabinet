// SCAFFOLD PLACEHOLDER — validation/none/setup.ts
//
// `validation/none/vitest.config.ts` names this module in `setupFiles`, so it
// runs once in every suite worker. The validator stage of the v3.0.0 rework
// writes it: it gives each worker the teardown that returns its page to the
// shared browser when a suite file is done.
//
// It THROWS, deliberately, for the same reason `globalSetup.ts` does.

throw new Error("Cascade v3.0.0: validation/none/setup.ts is a scaffold stub");
