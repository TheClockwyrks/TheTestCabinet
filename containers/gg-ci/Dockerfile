# syntax=docker/dockerfile:1
# The gg language-toolchain **CI** image: a machine that can already build `test-cabinet-gg`,
# published so a CI job does not have to become one from scratch every time it runs.
#
# What this is, and the four things it is NOT
# -------------------------------------------
# It is a RUNNABLE Ubuntu image whose unprivileged user's home directory already contains all
# eleven of gg's program-language toolchains, at the pinned versions, in the exact places the
# installers put them. A consumer copies that home directory onto its own machine and is done.
#
#   * NOT a run image. No test case executes in it, nothing resolves it, and it is deliberately
#     absent from `containers/image-names.sh` — that file lists the images a RUN resolves, and
#     `containers/build.sh` dispatches on it by name, so an entry there would make `make
#     run-images` try to build this as an asset image. (`every_resolvable_image_is_one_the_build_publishes`
#     in `crates/core/src/harness.test.rs` would not object: it keeps a `NOT_A_RUN_IMAGE`
#     exception list for published non-run images, holding `base` today.)
#   * NOT built by `containers/build.sh`. `make run-images` must not start a 1.9 GB build of
#     something no run container will ever pull; this image has its own workflow
#     (`.github/workflows/build-gg-ci-image.yml`) with its own trigger.
#   * NOT a `COPY --from` source for a run image. That is `containers/gg-toolchains`'s job, and
#     the next section is why the two cannot be one image.
#   * NOT a base image for a GitHub Actions `container:` job. It would work, but a container job
#     remaps `HOME` to `/github/home` — a bind mount of the runner's own scratch — which shadows
#     precisely the directory this image exists to carry. The consumer therefore copies out of
#     it rather than running inside it; see `scripts/ci/hydrate-gg-toolchains.sh`.
#
# Why this is a second image rather than a `--target` of containers/gg-toolchains
# ------------------------------------------------------------------------------
# Because the two need the toolchains in different places, and *where* is not a cosmetic
# difference — for three of the eleven arms it is not even configurable.
#
# `containers/gg-toolchains` assembles everything under `/opt/gg/toolchains`, because that tree
# is copied into a run container where it must sit at one absolute path on both the
# Debian-derived run images and `blender-gg`'s Ubuntu, and because gg's own resolution
# (`crates/gg/src/sandbox/language/jvm.rs`, `find_toolchain`) probes that path first. It reaches
# the shared installers with `*_INSTALL_DIR` overrides, and it only installs the arms a RUN needs
# — seven of them: PureScript, Java, Kotlin, Rust, Swift, C++ and C#.
#
# This image is for the BUILD path, which is a different question with a different answer. What
# `crates/gg/build.rs` runs is `scripts/gg-signatures.sh` and the eleven per-arm reflectors, and
# those resolve their toolchains from `$HOME`:
#
#   * `packages/gg-sandbox-{swift,cpp,csharp}/signatures.sh` probe `/opt/gg/toolchains/...` before
#     falling back to `$HOME` — those three would be happy either way;
#   * `packages/gg-sandbox-{java,kotlin}/signatures.sh` resolve ONLY
#     `${JAVA_INSTALL_DIR:-$HOME/.local/share/gg-java}` and `${KOTLIN_INSTALL_DIR:-…}`, with no
#     `/opt` probe at all, so an `/opt` tree needs two environment variables exported by every
#     consumer for ever; and
#   * three arms cannot be redirected at all. `scripts/ci/install-uv.sh` *overwrites* any
#     inherited `UV_INSTALL_DIR` with `$HOME/.local/bin`; YARD is installed with
#     `gem install --user-install`, which by design ignores `GEM_HOME` and lands in `Gem.user_dir`;
#     and the `wasm32-unknown-unknown` standard library is a rustup COMPONENT, which lives wherever
#     `RUSTUP_HOME` is and nowhere else.
#
# So an `/opt` CI image would mean permanently exported environment variables for two arms, three
# arms that cannot go there at all, and — to fix those three — an edit to the one pinned list this
# whole arrangement exists to keep single. `$HOME` costs zero environment variables and blocks zero
# arms. That is the whole argument, and it is why this image runs
# `scripts/ci/install-gg-toolchains.sh` with NO overrides whatsoever: the defaults are the point.
#
# The staged home directory is `/gg-home` rather than `/home/<user>` so that a consumer's copy
# source is a fixed literal and never depends on what this file happened to call its user.
#
# The one pinned list, run unmodified
# -----------------------------------
# `scripts/ci/install-gg-toolchains.sh` is the single script that makes a machine able to build gg:
# the devcontainer image runs it, `scripts/ci/rust-test.sh` runs it, `scripts/ci/contract-drift.sh`
# runs it, the Azure pipeline runs it, the release workflow runs it, and the driver service image's
# gg stage runs it. This image runs the same script, from the repository, with no arguments and no
# overrides. Nothing in the INSTALL half names a version, an installer or an arm — the closure it
# copies in is expressed as directories, so a twelfth language arrives here for free.
#
# The one enumeration in this file is the block of `test -x` assertions after that install, and it
# is not free: it names eight arms and eight paths. An assertion cannot be derived from the thing it
# is asserting — a check that computed each path the way the installer does would agree with the
# installer by construction and catch nothing — so a twelfth arm DOES want one more line there. That
# block says so itself, above where it starts.
#
# That is also what makes the consumer's story simple. The copy is not the end of it: after
# hydrating, a consumer still runs the same installer, which then finds every pin already satisfied
# and exits in a fraction of a second. The image supplies the bytes; the pinned list verifies them.
# An image built before a pin moved repairs exactly the one arm that moved, rather than being wrong
# in a way that surfaces four minutes later as `rustc` refusing an `.rlib` with E0514.
#
# Why a Rust toolchain is installed here and then deliberately not copied out
# --------------------------------------------------------------------------
# `install-gg-toolchains.sh` runs `install-rust-wasm.sh`, which is `rustup target add` — and it
# fails loudly rather than skipping when there is no rustup, because on every machine that runs it
# for real, a missing wasm32 standard library is a defect and not a choice. Running the list
# unmodified therefore means this image has rustup. It is the right trade: the alternative is to
# call ten of the eleven installers by name here, which is the second source of truth this file's
# header spends four paragraphs refusing to create.
#
# What a consumer must NOT copy is `~/.rustup` and `~/.cargo`. A CI agent already has a Rust
# toolchain — the one `rust-toolchain.toml` selects — and overwriting its rustup home with this
# image's would replace the compiler that is about to build the workspace. It is also the one arm
# where that costs nothing: `rustup target add` over an already-present toolchain is seconds, which
# is why the hydration script skips it by name and says so.
#
# The second, build-capable prefix — and the two tags this file publishes
# -----------------------------------------------------------------------
# Every toolchain the `run-toolchains` stage installs is the RUN set — pruned to what a gg run and
# gg's reflectors actually execute. `scripts/ci/install-wasi-sdk.sh` keeps one sysroot target
# (`wasm32-wasip1`) and deletes four; `scripts/ci/install-dotnet.sh` keeps a runtime, Roslyn and the
# reference assemblies and deletes MSBuild, NuGet and every workload. That is correct and must stay
# correct: those two prefixes have to remain byte-equivalent to what their installers write, because
# the installers' idempotence checks are what make the reconciler above safe. A `wasm32-wasip2`
# sysroot appearing under `~/.local/share/tcab/gg-wasi-sdk` would leave the tree no longer equal to
# what `install-wasi-sdk.sh` produces, and the next reconcile would either fail to notice or
# `rm -rf` it.
#
# `packages/gg-sandbox-csharp/build.sh` — which builds that arm's guest — needs the UNPRUNED versions
# of both, and it is the one arm whose artifact build does. So there is a SECOND, separately-prefixed
# tree rather than a widening of these, in the `build-toolchains` stage at the foot of this file:
#
#     ~/.local/share/tcab/gg-build/dotnet-sdk-<version>      (a whole SDK, `wasi-experimental` installed)
#     ~/.local/share/tcab/gg-build/wasi-sdk-<version>-full   (every sysroot target)
#     ~/.local/share/tcab/gg-build/<runtime-pack>.<version>  (Mono for wasi-wasm)
#
# mirroring `build.sh`'s own `.build/` names, populated by
# `scripts/ci/install-gg-build-toolchains.sh`, and reached by `gg_dotnet_build_sdk_home` /
# `gg_wasi_sdk_build_home` / `gg_dotnet_runtime_pack_home` in
# `packages/gg-sandbox-csharp/csharp-version.sh`, which `build.sh` consults before falling back to
# `$HERE/.build`. The consumer half lives in `packages/`, so the two landed together.
#
# TWO TAGS — AND THE REASON THE BIG ONE IS NOT THE DEFAULT IS NOT THE REASON IT WAS WRITTEN FOR.
# `run-toolchains` is ~1.9 GB; `build-toolchains` adds roughly 1.5 GB on top of it — a ~770 MB
# unpruned SDK plus its workload, a ~650 MB unpacked wasi-sdk, and the Mono runtime pack — for a
# total near 3.4 GB. `.github/workflows/build-gg-ci-image.yml` publishes both stages under their own
# tags (`:latest` and `:build-latest`) and a consumer pulls the one it needs.
#
# WHEN THIS WAS WRITTEN, the split was an economy: almost every consumer of this image built and
# tested gg, which needed the eleven RUN toolchains and nothing here, and only a job that re-cut the
# C# guest BY HAND needed the rest. THAT PREMISE IS DEAD. Nothing gg embeds is committed any more —
# every arm has a crate under `crates/gg-sandbox-artifacts/` whose build script runs that arm's
# `build.sh` on every build whose inputs moved — so BUILDING gg re-cuts the C# guest, and every
# consumer that compiles `test-cabinet-gg` wants `:build-latest`. Both jobs in `ci.yml` do.
#
# The two tags are kept anyway, and the argument is now the other one: this image is also hydrated by
# things that only RUN gg or read its pins, and `install-wasi-sdk.sh` / `install-dotnet.sh` prune
# precisely so a run image does not carry 1.5 GB it never opens. A single fused tag would push that
# weight onto them to save a `:build-` prefix on two lines of YAML. A consumer that pulls the smaller
# tag and then builds gg is not broken, only slower: `packages/gg-sandbox-csharp/build.sh` falls back
# to fetching both toolchains into its own `.build/`, which is the same bytes down a worse path.
#
# The stage is the last one in the file so that a build with no `--target` still produces the
# smaller image — a default that now serves the minority, and stays because an accidental 3.4 GB
# publish is the more expensive mistake of the two.

# Ubuntu 24.04 deliberately, and it is a coupling rather than a preference: the consumer of this
# image is `ubuntu-24.04` (and `ubuntu-24.04-arm`) GitHub Actions runners, and what gets copied out
# is a home directory full of dynamically linked compilers. The toolchains are portable by
# construction — each installer vendors what its published binaries link that a distribution may not
# ship (see `install-swift.sh`'s ELF-closure walk and `install-wasi-sdk.sh`'s two GCC-runtime
# sonames) — but matching the consumer's distribution and release makes that portability a
# safety-net instead of a load-bearing assumption. When the runners move to a new LTS, this moves
# with them.
FROM ubuntu:24.04 AS base

# The prerequisites the eleven installers assume rather than install, each named with the arm that
# needs it, because "some install broke four minutes in" is the failure this list prevents:
#   ca-certificates, curl  every arm downloads over TLS
#   tar, gzip, xz-utils    the Java, Kotlin, PureScript, Swift, wasi-sdk and .NET archives
#   unzip                  the extractor a `.nupkg` needs — the Mono WASI runtime pack the C# arm's
#                          guest is relinked from. Every installer on the ELEVEN-ARM list fetches a
#                          tarball instead, so this entry serves only the `build-toolchains` stage
#                          at the foot of this file and the arm build it enables. It was put here
#                          before that stage existed, precisely so the stage would be a stage and
#                          not also an apt change; it is read now. ~400 KB.
#   binutils               `readelf` and `ar`, which `install-swift.sh` uses to walk the Swift
#                          binaries' shared-library closure and to unpack the Debian .debs it
#                          vendors libxml2/libicu out of. Without it that installer exits with a
#                          message naming this package.
#   ruby                   the ONE prerequisite `install-gg-toolchains.sh` can only check: YARD (the
#                          Ruby arm's reflector) is a gem, and installing an interpreter takes root,
#                          which that script deliberately will not do.
#   libicu74, libstdc++6   .NET refuses to start without ICU, and wasi-sdk's `clang` links Debian's
#                          libstdc++ — the installer vendors its own copy beside the binary, and
#                          this is the host-side one the *verification* compile in that installer
#                          runs against.
#   zlib1g                 linked by the JDK and by `purs`.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
	--mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
	apt-get update && apt-get install -y --no-install-recommends \
	ca-certificates curl tar gzip xz-utils unzip binutils ruby libicu74 libstdc++6 zlib1g

# Node and npm, which are a PREREQUISITE OF THE ELEVEN-ARM LIST rather than of one arm, and were the
# one thing on it this image did not have. `install-gg-toolchains.sh` ends by calling
# `install-gg-build-tools.sh`, which warms the four build tools that are published on npm and nowhere
# else — `@bytecodealliance/componentize-js` for the TypeScript and Ruby guests, `opal-compiler` for
# the Ruby arm, `spago` for the PureScript package set — into the version-stamped prefix
# `scripts/gg-npm-tools.sh` resolves. Every one of those is an `npm install --prefix`, so without a
# node here the installer's first line dies with `npm: command not found` under `set -eux`.
#
# From the official node image rather than from Ubuntu's archive, which is two majors behind, and
# exactly the two paths `deployments/images/services.Dockerfile` copies for the same reason — only
# the interpreter and npm itself, because copying all of `/usr/local` would bury this image's own
# toolchain trees. bookworm's glibc is older than this base's, so the binary runs here; the reverse
# would not.
COPY --from=docker.io/library/node:24-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=docker.io/library/node:24-bookworm-slim /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && npm --version

# An unprivileged user, because everything below writes into a home directory and a consumer copies
# it out onto a machine where it will be owned by whoever ran the copy. Installing as root would
# leave a tree of root-owned files that a `docker cp` as an ordinary user has to re-own file by
# file — and, worse, would let an installer that "works" here fail on a real agent for a permission
# reason this image had papered over.
#
# `/gg-home` rather than `/home/gg` so the copy source in
# `scripts/ci/hydrate-gg-toolchains.sh` is a fixed literal that does not encode a user name.
# `HOME` is set explicitly rather than left to `USER`: the installers branch on it constantly and
# it is the single most important fact about this image.
#
# `userdel --remove ubuntu` first, and it is not defensive tidying: Ubuntu's official images
# have shipped a default `ubuntu` account on uid 1000 since 24.04, so creating an account
# there fails the build outright with `groupadd: GID '1000' already exists`. This is the same
# line, for the same reason, as `containers/blender/Dockerfile`'s — that image is the other
# Ubuntu-based one here, and it hit this first.
ARG USERNAME=gg
ARG USER_UID=1000
ARG USER_GID=1000
RUN userdel --remove ubuntu 2>/dev/null || true; \
	groupadd --gid "${USER_GID}" "${USERNAME}"; \
	useradd --uid "${USER_UID}" --gid "${USER_GID}" --home-dir /gg-home --create-home --shell /bin/bash "${USERNAME}"
ENV HOME=/gg-home
USER ${USERNAME}
WORKDIR /gg-home

FROM base AS run-toolchains

# Re-declared because an `ARG` does not survive a `FROM`, and the `COPY --chown` lines below need
# them. The values must match the block above; they are the only two of the three that are used
# here, `USERNAME` having done its work in the layer that created the account.
ARG USER_UID=1000
ARG USER_GID=1000

# Rust first, and in its own layer above the repository slice, because it is the part of this image
# that changes least: `rust-toolchain.toml` moves once a release, while an arm's pin can move any
# week. Splitting it means a pin bump re-runs the installer layer and re-uses this one.
#
# `--default-toolchain none` and `--profile minimal` mean rustup installs NO compiler here; the
# `rustc --version` below is a shim invocation from inside the slice, so the release that gets
# materialised is the one `rust-toolchain.toml` names and nothing else has to restate it. `rustup
# show` is run first for the same reason the Azure pipeline runs it — when this goes wrong, the
# useful thing to read in the build log is what resolved.
ENV RUSTUP_HOME=/gg-home/.rustup \
	CARGO_HOME=/gg-home/.cargo \
	PATH=/gg-home/.cargo/bin:/gg-home/.local/bin:$PATH
COPY --chown=${USER_UID}:${USER_GID} rust-toolchain.toml /gg-repo/rust-toolchain.toml
RUN set -eux; \
	curl -sSfL https://sh.rustup.rs \
	| sh -s -- -y --no-modify-path --profile minimal --default-toolchain none; \
	cd /gg-repo; \
	rustup show; \
	rustc --version

# The repository slice the installers read their pins out of. `scripts/ci/lib.sh` derives
# `REPO_ROOT` from its own `${BASH_SOURCE[0]}` rather than from git, which is what makes a partial
# tree work at all — the same trick `containers/gg-toolchains/Dockerfile` already uses for five of
# these installers.
#
# Both sources are copied as DIRECTORIES on purpose. `scripts/ci` is the installer family, which
# grows by one file every time an arm is added; `packages` carries the per-arm `*-version.sh` pins,
# and the repo-root `.dockerignore` allowlist is what narrows it (nothing under `packages/` is in
# the context except the ten guest packages and the console's npm slice — a few megabytes). Naming
# either as a file list would be the second source of truth this image exists to avoid, and it is a
# trap this repository has fallen into twice already: see `.dockerignore`'s own notes on the Blender
# helpers and on the Java arm's installer, the second of which broke the `-gg` variant of every
# language rather than only Java's.
COPY --chown=${USER_UID}:${USER_GID} scripts/ci /gg-repo/scripts/ci
COPY --chown=${USER_UID}:${USER_GID} scripts/gg-*.sh /gg-repo/scripts/
COPY --chown=${USER_UID}:${USER_GID} packages /gg-repo/packages

# The whole point of the image, in one command with no arguments and no overrides.
#
# The `test`s afterwards are not decoration. Each installer verifies its own work (several of them
# compile something with the pruned copy before exiting), but what they cannot check is that they
# all landed in the ONE place a consumer is going to copy: `$HOME`. An arm that quietly installed
# somewhere else would produce an image that pulls, hydrates, and then re-downloads a gigabyte on
# every CI job with nothing in the log to say why. These paths are the defaults in
# `install-*.sh`/`*-version.sh`, and this is the assertion that they still are.
#
# WHICH MAKES THIS THE ONE PLACE IN THIS FILE THAT A NEW ARM HAS TO EDIT, and the header says so
# rather than pretending otherwise. The paths are written out rather than sourced from the version
# files that export three of them (`GG_SWIFT_DEFAULT_HOME`, `GG_WASI_SDK_DEFAULT_HOME`,
# `GG_DOTNET_DEFAULT_HOME`) on purpose: an assertion that computes its expectation from the same
# definition the installer used passes whatever the installer does, which is not an assertion. The
# cost of that choice is exactly this — a default path that MOVES leaves a line here checking
# somewhere nothing writes, and the build goes red rather than quiet, which is the right way round.
# An eleventh line for a twelfth arm is the price of the block working at all.
#
# THE LAST TWO LINES ARE NOT AN ARM'S COMPILER, and they are here because they are the ones most
# likely to be silently absent. `install-gg-build-tools.sh` warms what the artifact builds resolve
# instead of downloading: the npm-delivered tools under `gg-npm` (which four arms reached with
# `npx --yes`, i.e. the registry), and the Swift arm's three vendored source packages under
# `gg-swift-libraries` (which lived in that package's own gitignored `.build/`, a cache that looks
# provisioned on a developer's machine and is three GitHub fetches inside `cargo build` on a fresh
# checkout). If either is missing from this image, every consumer of it goes back to fetching them
# per job — with nothing in the log to say so, which is the failure this whole block exists to
# convert into a red build.
RUN set -eux; \
	/gg-repo/scripts/ci/install-gg-toolchains.sh; \
	test -x "$HOME/.local/bin/uv"; \
	test -x "$HOME/.local/bin/purs"; \
	test -x "$HOME/.local/bin/esbuild"; \
	test -x "$HOME/.local/share/gg-java/jdk/bin/javac"; \
	test -f "$HOME/.local/share/gg-kotlin/kotlin-home/lib/kotlin-scripting-compiler.jar"; \
	test -x "$HOME/.local/share/tcab/gg-swift/toolchain/usr/bin/swiftc"; \
	test -x "$HOME/.local/share/tcab/gg-wasi-sdk/bin/clang++"; \
	test -x "$HOME/.local/share/tcab/gg-dotnet/dotnet/dotnet"; \
	test -d "$HOME/.local/share/tcab/gg-swift-libraries"; \
	test -d "$HOME/.local/share/tcab/gg-npm"; \
	ruby -e 'gem "yard"'; \
	du -sh "$HOME/.local"

# Drop the slice, so nothing ships a stale half-copy of the repository for someone to read a pin
# out of by mistake. It is a whiteout rather than a saving — the COPY layers above already carry
# those bytes and a later delete cannot take them back — which is why it is worth exactly this
# much effort and no more.
#
# As root, and in its own step, because it cannot be done any other way: removing `/gg-repo`
# unlinks an entry from `/`, which needs write permission on `/` and not on the directory being
# removed, so the unprivileged step above fails with `rm: cannot remove '/gg-repo': Permission
# denied` however the slice itself is owned. (Measured, not predicted — it is what the first real
# build of this file did, after every one of the eleven assertions above had passed.) `USER` is
# handed straight back, so the image a consumer creates a container from is the unprivileged one.
ARG USERNAME=gg
USER root
RUN rm -rf /gg-repo
USER ${USERNAME}

# A shell, so this image can be `docker run` for debugging and so `docker create` — which is how a
# consumer gets a filesystem to copy out of — has a command to record without being given one.
CMD ["/bin/bash"]

# ---------------------------------------------------------------------------------------------
# The build-capable stage: `run-toolchains` plus the second, unpruned prefix the C# arm's ARTIFACT
# build needs. See "The second, build-capable prefix" in this file's header for why it is a second
# tree rather than a widening, and for why it is a second TAG rather than the default.
#
# It is last in the file so a `docker build` with no `--target` produces the smaller image, and it
# builds `FROM run-toolchains` rather than `FROM base` so the two tags share every layer up to this
# point — a consumer that has pulled one has most of the other.
# ---------------------------------------------------------------------------------------------
FROM run-toolchains AS build-toolchains

ARG USERNAME=gg
ARG USER_UID=1000
ARG USER_GID=1000

# The repository slice again, because the stage above deleted its copy — see that `rm -rf`. The same
# two directories, for the same reason: `scripts/ci` is the installer family and `packages` carries
# the per-arm pins this one reads (`csharp-version.sh`, which sources `cpp-version.sh` for the
# wasi-sdk release, so the unpruned tree and the pruned one can never name different releases).
COPY --chown=${USER_UID}:${USER_GID} scripts/ci /gg-repo/scripts/ci
COPY --chown=${USER_UID}:${USER_GID} scripts/gg-*.sh /gg-repo/scripts/
COPY --chown=${USER_UID}:${USER_GID} packages /gg-repo/packages

# One command with no arguments, exactly as the run half is. The assertions afterwards are the same
# kind and are here for the same reason: what an installer cannot check is that it landed in the ONE
# place a consumer will copy. Each is a path the C# arm's `build.sh` names directly — the workload's
# build tasks, the `noeh` libc++ the link line reaches for under `wasm32-wasip2` (which is precisely
# what the pruned run tree deletes, and therefore the assertion that says this stage did something),
# and the runtime pack's native archives.
RUN set -eux; \
	/gg-repo/scripts/ci/install-gg-build-toolchains.sh; \
	. /gg-repo/packages/gg-sandbox-csharp/csharp-version.sh; \
	test -x "$HOME/.local/share/tcab/gg-build/dotnet-sdk-${GG_DOTNET_SDK_VERSION}/dotnet"; \
	test -f "$HOME/.local/share/tcab/gg-build/dotnet-sdk-${GG_DOTNET_SDK_VERSION}/packs/Microsoft.NET.Runtime.WebAssembly.Wasi.Sdk/${GG_DOTNET_RUNTIME_VERSION}/tasks/${GG_DOTNET_TFM}/WasmAppBuilder.dll"; \
	test -d "$HOME/.local/share/tcab/gg-build/wasi-sdk-${GG_WASI_SDK_VERSION}-full/share/wasi-sysroot/lib/${GG_CSHARP_TARGET}/noeh"; \
	test -d "$HOME/.local/share/tcab/gg-build/${GG_DOTNET_MONO_WASI_PACK}.${GG_DOTNET_RUNTIME_VERSION}/runtimes/wasi-wasm/native"; \
	du -sh "$HOME/.local"

# The slice goes again, for the reason the stage above gives: nothing should ship a stale half-copy
# of the repository for someone to read a pin out of by mistake. As root, in its own step, because
# unlinking an entry from `/` needs write permission on `/`.
USER root
RUN rm -rf /gg-repo
USER ${USERNAME}

CMD ["/bin/bash"]
