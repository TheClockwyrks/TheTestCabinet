# The Rust track's CI image: what the gates in the `rust` job of
# azure-pipelines.yml reach for.
#
# This is not the devcontainer, which adds the coding agents, CUDA and a shell
# configured for a person to the same base, none of which a gate invokes. It is
# built on the toolchain image the template publishes, the one the
# devcontainer is built on, so the compiler, mold, cargo-nextest, uv and every
# system library a gate links against are the ones a developer's container
# holds, at the same paths. What is installed here is the project's own: the
# packages and the musl target its Rust track needs beyond the toolchain. See
# ci/images/README.md.
#
# The image reference comes from the `x-devcontainer-build-args` anchor in
# .devcontainer/docker-compose.yml, extracted by ci/images/build-args.sh and
# passed in as the build argument below. A global `ARG` is read by the `FROM`
# alone.
#
# Built for linux/amd64 only: Azure's hosted agents are amd64.
# scripts/ci/ci-image.sh builds and pushes this file.
ARG TOOLCHAIN_IMAGE
FROM ${TOOLCHAIN_IMAGE}

# A root build, taking root back from the toolchain image's account, and the
# steps do not run as root. Azure runs `useradd -m -u 1001 vsts_azpcontainer`
# against a container job and execs every step as that user, whatever the
# image's default user is and whatever `--user` the container resource asks
# for. HOME below is still this image's, so a step runs as uid 1001 with
# HOME=/root, and every tool keeping a cache under HOME writes there. That is
# why /root is widened at the end of this file.
USER root
ENV HOME=/root \
	USER=root \
	LANG=C.UTF-8

# Where the toolchain image installed Rust, named rather than left to HOME,
# which is not the account's here. A job that caches the crate registry
# repoints CARGO_HOME at its cache directory; that works because RUSTUP_HOME
# stays where the toolchain is, and cargo's subcommand lookup finds
# `cargo-nextest` on the PATH rather than under the CARGO_HOME of the moment.
ENV RUSTUP_HOME=/home/dev/.rustup \
	CARGO_HOME=/home/dev/.cargo

# Where uv keeps the tools it installed and the CPython it fetched for them,
# which the toolchain image put under the account's home: pre-commit, and the
# interpreter `uv run --project ci` resolves, so the gate runner's environment
# is built from what the image holds rather than downloaded on the first step
# of every run.
ENV UV_TOOL_DIR=/home/dev/.local/share/uv/tools \
	UV_PYTHON_INSTALL_DIR=/home/dev/.local/share/uv/python

# The PATH has to be complete here. A pipeline step reads no rc file, and
# nothing reconstructs a PATH on its way into the job container, so anything a
# gate calls is on this line or it does not exist. The toolchain's own bin
# directory comes first, ahead of ~/.local/bin, whose `cargo` is the
# devcontainer's wrapper: it runs the cargo under CARGO_HOME, which a job that
# repoints CARGO_HOME at its cache has none of. The linker variables the
# toolchain image sets, cc-mold for the two glibc targets, carry over as they
# are.
ENV PATH=/home/dev/.cargo/bin:/home/dev/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin

# The project's own packages, beyond the toolchain image's: what the project's
# tests and builds reach for on this track and the toolchain does not. The
# devcontainer installs a list of its own, .devcontainer/system/packages.sh,
# which this list leaves as it is.
#
#   - musl-tools: musl-gcc, the linker a static build against this
#     architecture's musl target links with, and the C compiler a crate that
#     compiles C of its own calls for that target. The target itself is added
#     by languages/rust/targets.sh below.
#   - cmake
#   - ffmpeg
#   - libicu-dev
#   - postgresql: the server binaries the backend's tests start a throwaway
#     PostgreSQL server with (crates/backend/src/test_postgres.rs). The server
#     refuses to run as root, which no step does: Azure runs each as uid 1001.
#   - ruby
#
# libstdc++6 is named rather than left to the toolchain image's build-essential,
# which happens to pull it in. Azure mounts its own Node into a container job
# and runs every `task:` of the job with it, and that build links against
# libstdc++, so a reader trimming build-essential would take the job's tasks
# down with it.
RUN apt-get update -y && \
	apt-get install -y --no-install-recommends \
		cmake \
		ffmpeg \
		libicu-dev \
		libstdc++6 \
		musl-tools \
		postgresql \
		ruby && \
	rm -rf /var/lib/apt/lists/*

# This architecture's musl standard library, so a static build compiles on this
# track as it does in the devcontainer, from the script the devcontainer runs.
# It reads CARGO_HOME, set above to the toolchain image's, for rustup.
COPY .devcontainer/languages/rust/targets.sh /tmp/scripts/rust/
RUN bash /tmp/scripts/rust/targets.sh && rm -rf /tmp/scripts

# A step reaches the toolchain's directories without a copy of them in a layer
# of this image. The account's home is opened to every user to enter and read,
# and only the directories of the cargo and rustup homes are made writable, so
# a step that runs as another user can still materialize a component, which
# a layer records without the files beneath them.
#
# clippy is added, which the devcontainer leaves to rust-toolchain.toml's
# `components` list on the first cargo run. A pipeline job starts from the
# image every time, so leaving it out would mean downloading clippy on every
# run of the lint gate.
RUN chmod o+rx /home/dev && \
	rustup component add clippy && \
	find "$CARGO_HOME" "$RUSTUP_HOME" -type d -exec chmod a+w {} +

# git refuses a repository owned by another uid, and running as root is not an
# exemption. Every gate reaches git — the runner shells out to
# `git rev-parse --show-toplevel` before any gate does anything else — and the
# checkout belongs to the agent, not to this image.
RUN git config --system --add safe.directory '*'

# HOME for every step, and not writable by the uid that runs them until this
# line. Recursive, because a directory the build created under it is one a
# step reaches for, and widening /root alone leaves that one root-owned, which
# is a permission error one directory deeper rather than none. `a+rwX` adds
# execute to the directories and not to the files in them, and it is a+ rather
# than an owner because the uid is Azure's to choose and this image holds
# nothing secret.
RUN chmod -R a+rwX /root
