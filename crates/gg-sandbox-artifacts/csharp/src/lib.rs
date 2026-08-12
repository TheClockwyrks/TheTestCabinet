//! Deliberately empty: this crate exists for its **build script** and for the `links` key in its
//! manifest, not for any Rust it contains.
//!
//! A package declaring `links` must have a library target — that is cargo's rule, not a choice made
//! here — and the library it wants is the one that publishes the `csharp` arm's artifact directory
//! to `crates/gg`'s build script through `DEP_GG_ARTIFACT_CSHARP_ROOT`. The bytes themselves never
//! pass through Rust at all: they are written into this build's `OUT_DIR` by
//! `packages/gg-sandbox-csharp/build.sh` and `include_bytes!`d out of it by `crates/gg`.
//!
//! # The one arm that asks for a toolchain no gg run installs
//!
//! Every other arm crate here builds with something `scripts/ci/install-gg-toolchains.sh` already
//! put on the machine, because every other arm's build toolchain is also a toolchain some gg RUN
//! needs. This one is not. Relinking Mono's IL interpreter wants a whole .NET SDK with the
//! `wasi-experimental` workload's build tasks, and an UNPRUNED wasi-sdk carrying the `wasm32-wasip2`
//! sysroot and its `noeh` libc++ — roughly 1.4 GB that no turn of any run ever touches, because
//! nothing about a C# *program* is compiled to wasm. A run needs only the small host toolchain
//! (a runtime, Roslyn, reference assemblies) that `scripts/ci/install-dotnet.sh` installs.
//!
//! So they are a SECOND, separately-prefixed tree, installed by
//! `scripts/ci/install-gg-build-toolchains.sh` into `~/.local/share/tcab/gg-build/` and resolved by
//! `gg_dotnet_build_sdk_home` / `gg_wasi_sdk_build_home` in
//! `packages/gg-sandbox-csharp/csharp-version.sh`. The full argument for two prefixes rather than
//! one wider one is beside those two functions; the short version is that the run installers prune
//! hard and their idempotence checks are what keep re-running the eleven-arm list cheap on every
//! surface, so anything appearing inside their prefixes that they did not write leaves the tree
//! unequal to what they produce.
//!
//! **WHAT THAT MEANS FOR A MACHINE WITHOUT IT, AND IT IS THE COST OF THIS CRATE EXISTING.** This
//! crate's build script runs on every `cargo build --workspace`, so `cargo build -p test-cabinet-gg`
//! now fails on a checkout that has neither the build prefix nor this package's own `.build/`
//! fallback populated — with the message `gg_artifact_build::arm` prints, which names the
//! installer. That is the same bargain every other arm already struck (building gg has required
//! eleven documentation toolchains since the signature catalogues stopped being committed, and
//! every arm's build toolchain since the artifacts did), and it is the same answer: a
//! toolchain that is required is a toolchain that is INSTALLED, by a pinned idempotent script every
//! surface runs, rather than worked around by committing 35 MB whose currency nobody can see.
//! `containers/gg-ci/Dockerfile`'s `build-toolchains` stage is where CI gets it.
