//! `contract-codegen` — the generator for the Test Cabinet data contract.
//!
//! It emits **both** the TypeScript bindings (`packages/run-record/src/*.ts` and
//! `packages/asset-contract/src/index.ts`, via [`ts_rs`]) and their JSON Schemas
//! (under `apps/docs/public/schema/`, via [`schemars`]) from one set of Rust types —
//! the types in `crates/contracts` that derive `TS` + `JsonSchema` behind its
//! `contract` feature. Because both artifacts come from the same source in one pass,
//! the TS bindings and the JSON Schemas can never drift from each other or from Rust.
//! What it writes is listed in the library half of this crate
//! ([`contract_codegen::contract_modules`] and
//! [`contract_codegen::contract_schema_docs`]); the backend's API package and its
//! schemas are `api-codegen`'s.
//!
//! Run it with `cargo run -p contract-codegen` (or `npm run gen:contract`, which
//! runs both generators and normalizes the output with Prettier). A CI check
//! regenerates and fails on any diff, so the committed artifacts always match the
//! Rust source.

use anyhow::Result;

use contract_codegen::emit::{finalize_schemas, finalize_ts, ts_config};
use contract_codegen::{
    TS_HEADER, contract_appendix, contract_modules, contract_schema_docs, workspace_root,
    write_schema, write_ts,
};

fn main() -> Result<()> {
    let root = workspace_root()?;
    let cfg = ts_config();

    for (package, file, mut content) in finalize_ts(contract_modules(&cfg), &[], TS_HEADER) {
        content.push_str(&contract_appendix(package, file)?);
        write_ts(&root, package, file, &content)?;
    }

    for (rel_path, value) in finalize_schemas(contract_schema_docs(), &[])? {
        write_schema(&root, rel_path, &value)?;
    }

    Ok(())
}
