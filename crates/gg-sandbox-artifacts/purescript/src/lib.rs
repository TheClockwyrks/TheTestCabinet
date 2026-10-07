//! Deliberately empty: this crate exists for its **build script** and for the `links` key in its
//! manifest, not for any Rust it contains.
//!
//! A package declaring `links` must have a library target — that is cargo's rule, not a choice made
//! here — and the library it wants is the one that publishes the `purescript` arm's artifact directory to
//! `crates/gg`'s build script through `DEP_GG_ARTIFACT_PURESCRIPT_ROOT`. The bytes themselves never pass
//! through Rust at all: they are written into this build's `OUT_DIR` by
//! `packages/gg-sandbox-purescript/build.sh` and `include_bytes!`d out of it by `crates/gg`.
//!
//! # This is the arm the dependency edge was worth having for
//!
//! Nine of the ten artifact crates publish bytes that only `include_bytes!` ever reads. This one
//! publishes bytes that `crates/gg`'s **signature reflection** reads as well: the PureScript
//! catalogue is produced by compiling this package's `src/` against the very library tree this
//! crate builds, because `purs` cannot type-check a module without the sources *and* the externs of
//! everything it imports, and compiling the registry set from scratch on every reflection would be
//! ~16 s an arm. So `packages/gg-sandbox-purescript/signatures.sh` unpacks the tarball, stages the
//! working tree's `src/` over the copy inside it, and reflects the result.
//!
//! That is an ordering constraint — the tree must exist before the catalogue can be reflected — and
//! under this arrangement it is a **type** rather than a convention. `test-cabinet-gg` depends on
//! `gg-artifact-purescript`, so cargo runs this crate's build script strictly before
//! `crates/gg`'s, and `crates/gg/build.rs` hands the reflection the path it published through
//! `GG_PURESCRIPT_LIBRARIES`. Before this crate existed, the same requirement was met by naming a
//! *committed* tarball in a signature rerun set and hoping nobody moved it.
