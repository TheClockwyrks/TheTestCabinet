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

        // TODO: load the run record plus its collected artifacts into a
        // `PublishRequest` and publish via `Publisher::publish` (or
        // `publish_batch` for the whole set). The core call is idempotent, so
        // re-publishing is a no-op unless `--force` is given.
        todo!("publish run record through the core Publisher");
    }

    Ok(())
}
