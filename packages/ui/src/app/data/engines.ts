// The engines a run can select — the runtime the produced game is built on. An
// engine is a run dimension chosen alongside the test case, variant, harness, and
// model, and a case declares only which engines it supports, so the picker's
// options are the intersection of this catalog and the resolved case version's
// `engines` list.
//
// The catalog is closed: it mirrors core's built-in engines (`engines/<slug>/`) in
// catalog order, leading with the default, so the console never offers a slug a
// run would be rejected for naming.

/** The default engine: no runtime, so the build supplies every surface itself. */
export const DEFAULT_ENGINE_SLUG = "none";
