//! `tcab validate` — run validation over a produced implementation.

use crate::cli::ValidateArgs;

/// Run the core validation pass (load check plus any reference comparisons) over
/// an already-produced implementation, summarizing the result.
///
/// Validation is a cheap first pass, not a pass/fail gate; the core's
/// `Validator` trait owns the actual work, sequenced by `Orchestrator::validate`.
pub async fn execute(args: ValidateArgs) -> anyhow::Result<()> {
    println!(
        "tcab validate: {} against {}@{}",
        args.implementation.display(),
        args.test_case,
        args.version,
    );

    // TODO: resolve the test case version via the core catalog, collect the
    // implementation as artifacts, and run a `Validator` over them, printing the
    // resulting `ValidationSummary`.
    todo!("run core validation over the produced implementation");
}
