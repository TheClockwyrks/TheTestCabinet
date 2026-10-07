# The web track's CI image: everything the gates in the `web` job of
# azure-pipelines.yml reach for, and nothing else.
#
# This is not the devcontainer. The devcontainer is a place to work — it carries
# coding agents, the Azure CLI, gh, k3d, kubelogin, lazygit and a shell
# configured for a person, none of which a gate invokes. Pulling and unpacking
# that on every run of every track costs more than the checks themselves take.
# So CI gets its own image per track, built from the same install scripts and
# the same version pins, holding only what the checks execute.
#
# The pins come from the `x-devcontainer-build-args` anchor in
# .devcontainer/docker-compose.yml, extracted by ci/images/build-args.sh and
# passed in as the build arguments below. There is no second place a version is
# decided, which is what keeps a browser engine in this image the same build as
# the one in a developer's container. See ci/images/README.md.
#
# Built for linux/amd64 only: Azure's hosted agents are amd64, and the
# devcontainer stays multi-architecture by being built on the machine that runs
# it. scripts/ci/ci-image.sh builds and pushes this file.
FROM docker.io/library/ubuntu:26.04

# apt must never stop for a prompt during the build — tzdata asks for a region
# otherwise. This is an ARG rather than an ENV so it holds for the build and
# does not leak into the environment a gate runs in. It carries its own default,
# which is what keeps ci/images/build-args.sh from treating it as a version pin.
ARG DEBIAN_FRONTEND=noninteractive

ARG NODE_VERSION
ARG PLAYWRIGHT_VERSION

# Built as root, with no USER line, and the steps do not run as root. Azure runs
# `useradd -m -u 1001 vsts_azpcontainer` against a container job and execs every
# step as that user, whatever the image's default user is and whatever `--user`
# the container resource asks for. HOME below is still this image's, so a step
# runs as uid 1001 with HOME=/root, and every tool keeping a cache under HOME
# writes there. That is why /root is handed to that uid at the end of this file. The
# UID/GID-matching apparatus in .devcontainer/system/init-user.sh exists to make
# a developer's edits land with the right ownership on a bind mount, which buys
# a CI image nothing, so it is neither copied nor run here.
ENV HOME=/root \
	USER=root \
	LANG=C.UTF-8

# The PATH has to be complete here. In the devcontainer the interactive shell's
# rc file fills it in; a pipeline step reads no rc file, and nothing
# reconstructs a PATH on its way into the job container. Anything a gate calls
# is on this line or it does not exist.
ENV PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin

# Where the install scripts below put what they install. /usr/local rather than
# a home directory, because which user Azure runs a step as is the agent's
# decision and a tool under /root would be one user's alone.
ENV NODE_INSTALL_DIR=/usr/local/node \
	NODE_BIN_DIR=/usr/local/bin \
	KUBECTL_BIN_DIR=/usr/local/bin \
	UV_INSTALL_DIR=/usr/local/bin \
	UV_TOOL_DIR=/usr/local/share/uv/tools \
	UV_PYTHON_INSTALL_DIR=/usr/local/share/uv/python

# The browser engines go somewhere every user can read, the way Playwright's own
# images place them, rather than into root's cache. Playwright reads this
# variable when it installs an engine and again when a test asks for one, so
# ci/gates/web-browser-test.py resolves them through `executablePath()`
# unchanged.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright

# The apt packages, written here rather than by splitting
# .devcontainer/system/apt.sh. That script installs one list for a machine that
# is both toolchains plus a developer's ergonomics — ripgrep, tmux, vim, tree,
# ssh, sudo — and splitting it would risk the devcontainer to save nothing. This
# list is short enough to state with its reasons in place.
#
#   - ca-certificates, curl, wget: every download below.
#   - git: the gate runner shells out to `git rev-parse` before any gate does
#     anything else, `no-nul-bytes` asks git for the files to read, and
#     pre-commit is a git tool throughout.
#   - jq: the shell scripts under scripts/ read JSON with it.
#   - python3: `shell-tests` runs every `*.test.sh` under scripts/, and
#     scripts/check-devcontainer.test.sh drives a Python script with the
#     interpreter it finds on the PATH. uv's own CPython is not on it, and is no
#     substitute: it is an implementation detail of how the gates run.
#   - tar, gzip, unzip, xz-utils: the Node tarball is a .tar.xz, the hook
#     environments pre-commit builds unpack archives of their own.
#   - locales, tzdata: a UTF-8 locale and a timezone database, so a test that
#     formats a date agrees with one run in the devcontainer.
#   - libstdc++6: Azure mounts its own Node into a container job and runs every
#     `task:` of the job with it, and that build links against libstdc++.
#
# Deliberately absent: shellcheck, because the pre-commit hook runs the binary
# bundled in shellcheck-py's wheel rather than apt's, and build-essential,
# because nothing this track installs compiles: every native npm dependency in
# package-lock.json ships a prebuilt linux-x64 binary as an optional dependency.
RUN apt-get update -y && \
	apt-get install -y --no-install-recommends \
		ca-certificates \
		curl \
		git \
		gzip \
		jq \
		libstdc++6 \
		locales \
		python3 \
		tar \
		tzdata \
		unzip \
		wget \
		xz-utils && \
	rm -rf /var/lib/apt/lists/*

# Each install script is copied in immediately before the step that runs it, so
# an edit to one of them rebuilds that step and the ones after it rather than
# every step from the first COPY down.
COPY .devcontainer/languages/node/ /tmp/scripts/node/

# Node first, because the two browser steps at the bottom of this file both run
# `npx` and neither can move above it.
#
# languages/node/install.sh is safe to reuse now that it takes its install and
# link directories from the environment: it resolves the architecture out of the
# image, and runs `node --version` once before it finishes, which is what
# catches a tarball for the wrong architecture here rather than four layers
# later. The C++ headers it unpacks go straight back out in the same layer —
# they exist for node-gyp, and nothing on this track compiles a native addon.
RUN bash /tmp/scripts/node/install.sh && \
	rm -rf "$NODE_INSTALL_DIR/include" /root/.npm

# uv, and on top of it pre-commit. Every gate is invoked as
# `uv run --quiet --project ci gate run <id>`, so uv is the one command the
# pipeline calls directly.
#
# tools/uv.sh is safe to reuse: it installs a static binary and takes its
# destination from UV_INSTALL_DIR. The CPython it fetches to run pre-commit
# under lands wherever UV_PYTHON_INSTALL_DIR points, which is why that is set
# above rather than left to default under a home directory. That interpreter is
# also the one `uv run --project ci` resolves, so the gate runner's environment
# is built here rather than downloaded on the first step of every run.
COPY .devcontainer/tools/uv.sh /tmp/scripts/
RUN bash /tmp/scripts/uv.sh

# kubectl, for the one gate that needs it. `k8s-manifests` renders the overlays
# under deployments/ through kubectl's built-in kustomize and never reaches a
# cluster, so there is no kubeconfig here, no kubelogin and no helm. k3d is
# absent for the same reason: nothing in CI stands a cluster up.
#
# tools/kubectl.sh is the kubectl half of tools/k8s.sh, split out so this image
# installs one binary rather than the three they come to. It is safe to reuse
# for the same reasons node's installer is: architecture out of the image,
# destination from the environment, and it runs `kubectl version --client` once
# before it finishes.
COPY .devcontainer/tools/kubectl.sh /tmp/scripts/
RUN bash /tmp/scripts/kubectl.sh

COPY .devcontainer/system/browser-deps.sh .devcontainer/tools/browsers.sh /tmp/scripts/

# The browser engines and the system libraries they link against, in that order,
# both from the scripts the devcontainer uses. The devcontainer flips user twice
# around this pair because the libraries are apt's and the engines belong in a
# person's cache; this image is built as root and puts the engines somewhere
# shared, so it runs them back to back.
#
# system/browser-deps.sh needed one change to be safe here: it required a
# container user to find `npx` under, and now prepends that user's bin directory
# only when there is one and insists on `npx` resolving rather than on who owns
# it. tools/browsers.sh needed none — Playwright reads PLAYWRIGHT_BROWSERS_PATH
# itself.
#
# browsers.sh ends by starting each engine headless and rendering a page in it.
# That verification is kept, and is the reason this step is worth its minutes: a
# download for the wrong architecture and a missing system library both install
# perfectly quietly, and this is the only thing between either one and a browser
# gate that fails days later without naming a cause.
RUN bash /tmp/scripts/browser-deps.sh && \
	bash /tmp/scripts/browsers.sh && \
	rm -rf /var/lib/apt/lists/* /root/.npm /tmp/scripts

# git refuses a repository owned by another uid, and running as root is not an
# exemption. Every gate reaches git — the runner shells out to
# `git rev-parse --show-toplevel` before any gate does anything else — and the
# checkout belongs to the agent, not to this image.
RUN git config --system --add safe.directory '*'

# HOME for every step, and not writable by the uid that runs them until this
# line. Recursive, because the directories the build already created under it
# are the ones a step reaches for: `uv` made /root/.cache, and pre-commit's
# store goes inside it. Widening /root alone leaves that one root-owned, which
# is a permission error one directory deeper rather than none. `a+rwX` adds
# execute to the directories and not to the files in them, and it is a+ rather
# than an owner because the uid is Azure's to choose and this image holds
# nothing secret.
RUN chmod -R a+rwX /root
