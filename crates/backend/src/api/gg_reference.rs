//! `GET /gg/reference` — gg's model-facing surface, served as data.
//!
//! Every tool gg can offer a model (its description and parameter schema, exactly as
//! they go on the wire) and every
//! [responses-as-code](https://docs.testcabinet.ai/gg/responses-as-code/) function the
//! sandbox exports, grouped into gg's own families. The console's gg **Reference**
//! section is rendered entirely from this one document.
//!
//! # Why a committed artifact rather than a call into gg
//!
//! The honest way to answer "what was the model told `read_file` does?" is to ask a
//! live [`ToolRegistry`] — and that is what happens, just not here. `test-cabinet-gg`
//! pulls `wasmtime`, `oxc` and `tiktoken-rs`; the backend is built portable and static
//! under musl and must not grow that dependency for a static page. So the projection
//! runs at *generation* time (`gg reference`, driven by `scripts/gen-contract.mjs`),
//! lands in `crates/backend/src/gg_reference.json`, and is embedded here with
//! [`include_str!`]. `scripts/ci/contract-drift.sh` regenerates and diffs it, so a
//! reworded tool description that was not regenerated turns CI red instead of leaving
//! the console showing prose no model was ever sent — the same regenerate-commit-gate
//! shape gg's own `sandbox/signatures.json` already uses.
//!
//! # Why it is ungated
//!
//! Everything under `/gg` so far is auth-gated, so this is the exception and it is a
//! deliberate one: the document is static, identical for every caller, and contains no
//! account, run or deployment data — it is documentation of the harness, in the same
//! class as `/test-cases` and `/config`. Requiring a token would buy nothing and would
//! stop the public docs and a signed-out console from linking to it. `/gg/reference` is
//! a static path, so it collides with nothing else mounted under `/gg` (all of which is
//! either static or a child of a static segment).
//!
//! [`ToolRegistry`]: https://docs.testcabinet.ai/gg/toolset-ablation/

#[cfg(test)]
#[path = "gg_reference.test.rs"]
mod tests;

use std::sync::OnceLock;

use axum::Json;

use test_cabinet_core::gg_reference::GgReference;

/// The generated reference, embedded at compile time.
///
/// Produced by `npm run gen:contract` (step 1) from `gg reference` and committed. Never
/// hand-edited: the drift gate would reject it.
const GG_REFERENCE_JSON: &str = include_str!("../gg_reference.json");

/// The parsed reference, decoded once on first read.
///
/// Parsed rather than served as bytes so the endpoint's response is the
/// [contract type](GgReference) and not "whatever is in the file": if the artifact ever
/// stops matching the DTOs — a field renamed on one side of the generator only — this is
/// where that shows up. It shows up in `gg_reference.test.rs` first, which decodes the
/// same constant, so a mismatch cannot reach a deployment and surprise a reader.
fn reference() -> &'static GgReference {
    static REFERENCE: OnceLock<GgReference> = OnceLock::new();
    REFERENCE.get_or_init(|| {
        serde_json::from_str(GG_REFERENCE_JSON).expect(
            "the embedded gg reference must parse as GgReference (see gg_reference.test.rs)",
        )
    })
}

/// `GET /gg/reference`
///
/// gg's whole tool + responses-as-code reference, verbatim. No auth, no state, no
/// database read — the body is the embedded artifact, decoded once for the process's
/// lifetime and borrowed thereafter.
pub async fn gg_reference() -> Json<&'static GgReference> {
    Json(reference())
}
