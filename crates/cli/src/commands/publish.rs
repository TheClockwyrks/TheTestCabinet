//! `tcab publish` — publish one or more finished runs.

use crate::cli::PublishArgs;

/// Publish finished runs: release their generated code, make their playable
/// builds embeddable, and add their run records to the site dataset.
///
/// Publishing is idempotent and batch-capable, so a sweep producing many runs can
/// be published in a single invocation without manual handling of each one. The
/// actual release work lives in the core's publishing layer.
pub async fn execute(args: PublishArgs) -> anyhow::Result<()> {
    println!(
        "tcab publish: {} run(s){}",
        args.run_records.len(),
        if args.force { " (forced)" } else { "" },
    );

    for record in &args.run_records {
        println!("  - {}", record.display());
    }

    // Publishing releases generated code to public repositories and is a
    // separate concern from running test cases; it is not implemented yet. The
    // core `Publisher` seam exists (see `NoopPublisher`) for when it is wired up.
    anyhow::bail!("publishing is not implemented yet");
}
