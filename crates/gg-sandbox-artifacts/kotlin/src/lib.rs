//! Deliberately empty: this crate exists for its **build script** and for the `links` key in its
//! manifest, not for any Rust it contains.
//!
//! A package declaring `links` must have a library target — that is cargo's rule, not a choice made
//! here — and the library it wants is the one that publishes the `kotlin` arm's artifact directory to
//! `crates/gg`'s build script through `DEP_GG_ARTIFACT_KOTLIN_ROOT`. The bytes themselves never pass
//! through Rust at all: they are written into this build's `OUT_DIR` by
//! `packages/gg-sandbox-kotlin/build.sh` and `include_bytes!`d out of it by `crates/gg`.
