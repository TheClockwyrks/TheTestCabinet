# The web track's CI image: everything the `web` and `checks` jobs of
# azure-pipelines.yml execute, and nothing else. See ci/images/README.md for what
# is in it and why, and scripts/ci/ci-image.sh for how it is built, tagged and
# pushed.
#
# This is not the devcontainer, for the reasons ci/images/rust.Dockerfile gives,
# and it is not the Rust image either: nothing on this track compiles a crate, so
# it carries no compiler and none of gg's toolchains. It holds Node, the Chromium
# the front-end suites drive through Playwright, and the kubectl the manifest
# gate renders kustomizations with. Prettier, markdownlint, cspell, vitest and
# TypeScript are the workspace's own pinned copies, installed by the job's
# `npm ci`.
#
# The pins come from the `x-devcontainer-build-args` anchor in
# .devcontainer/docker-compose.yml, read by ci/images/build-args.sh and passed
# in as the build arguments below.
FROM docker.io/library/ubuntu:26.04

# apt must never stop for a prompt during the build. An ARG with a default, so
# build-args.sh does not treat it as a pin and it does not reach a gate.
ARG DEBIAN_FRONTEND=noninteractive

ARG NODE_VERSION
ARG PLAYWRIGHT_VERSION

# kubectl's pin is not in the compose anchor: the devcontainer installs it in
# .devcontainer/tools/k8s.sh, beside k3d and kubelogin, which no gate uses. Keep
# this equal to KUBECTL_VERSION there.
ARG KUBECTL_VERSION=1.35.6

# Root throughout, with no USER line and no HOME line. Azure runs a container
# job's steps as a user it adds to the container with the agent's own uid, and
# with HOME unset here that user's home is where npm's and Playwright's caches
# land. Everything this image installs lives under /usr/local and /opt, where
# every user reads it. The PATH is complete here because a pipeline step reads no
# rc file. Playwright reads PLAYWRIGHT_BROWSERS_PATH when it installs a browser
# and again when a test asks for one, so the engine installed below is the one
# the case-harness suite launches.
ENV LANG=C.UTF-8 \
	PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin \
	PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright

# The apt packages:
#
#   - ca-certificates, curl, wget, tar, gzip, unzip, xz-utils, zip: the downloads
#     below and the archives they arrive in.
#   - git: the frozen, build-context and submodule-pin gates read the checkout
#     through it, and the submodule gate fetches with it.
#   - jq: the shell scripts under scripts/ read JSON with it.
#   - build-essential, python3: node-gyp's needs, so an npm dependency without a
#     prebuilt binary for this platform still installs rather than failing the
#     track for the want of a compiler.
#   - libstdc++6: Azure mounts its own Node into a container job and runs every
#     `task:` of the job with it, and that build links against libstdc++.
#   - locales, tzdata: a UTF-8 locale and a timezone database.
RUN apt-get update -y && \
	apt-get install -y --no-install-recommends \
		build-essential \
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
		xz-utils \
		zip && \
	rm -rf /var/lib/apt/lists/*

# Node, from the official tarball, into /usr/local.
RUN case "$(uname -m)" in \
		x86_64) arch=x64 ;; \
		aarch64) arch=arm64 ;; \
		*) echo "no Node build for $(uname -m)" >&2; exit 1 ;; \
	esac && \
	curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${arch}.tar.xz" -o /tmp/node.tar.xz && \
	mkdir -p /usr/local/node && \
	tar -xJf /tmp/node.tar.xz -C /usr/local/node --strip-components=1 && \
	ln -s /usr/local/node/bin/node /usr/local/node/bin/npm /usr/local/node/bin/npx /usr/local/bin/ && \
	rm -f /tmp/node.tar.xz && \
	node --version && npm --version

# kubectl, for the one gate that needs it: scripts/ci/k8s-manifests.sh renders
# every overlay through kubectl's built-in kustomize and reaches no cluster, so
# there is no kubeconfig, kubelogin or helm here.
RUN case "$(uname -m)" in \
		x86_64) arch=amd64 ;; \
		aarch64) arch=arm64 ;; \
		*) echo "no kubectl build for $(uname -m)" >&2; exit 1 ;; \
	esac && \
	curl -fsSL "https://dl.k8s.io/release/v${KUBECTL_VERSION}/bin/linux/${arch}/kubectl" -o /usr/local/bin/kubectl && \
	chmod +x /usr/local/bin/kubectl && \
	kubectl version --client

# Chromium and the system libraries it links against, at the Playwright version
# packages/case-harness and packages/browser-driver pin, the way
# .devcontainer/system/browser-deps.sh and .devcontainer/tools/browsers.sh
# install them for a developer. The engine goes under /opt so every user reads
# it. The step ends by starting the browser headless and rendering a page, which
# is the only thing between a silently wrong download and a browser gate that
# fails later without naming a cause.
RUN apt-get update -y && \
	npx --yes "playwright@${PLAYWRIGHT_VERSION}" install-deps chromium && \
	npx --yes "playwright@${PLAYWRIGHT_VERSION}" install chromium && \
	npx --yes "playwright@${PLAYWRIGHT_VERSION}" screenshot --browser chromium about:blank /tmp/chromium.png && \
	rm -f /tmp/chromium.png && \
	chmod -R a+rX /opt/ms-playwright && \
	rm -rf /var/lib/apt/lists/* /root/.npm /root/.cache

# git refuses a repository owned by another uid, and the checkout belongs to the
# agent rather than to whichever uid a step runs as.
RUN git config --system --add safe.directory '*'
