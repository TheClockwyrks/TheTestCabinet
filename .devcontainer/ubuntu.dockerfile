# The image a workspace of this project is developed in.
#
# docker-compose.yml builds it and passes every argument below; the versions
# are pinned there, in the anchor its dev service merges.
#
# Every script reads the architecture from `dpkg --print-architecture` rather
# than from a build argument, because Podman supplies none.
FROM docker.io/library/ubuntu:26.04
USER root

ARG USERNAME
ARG USER_UID
ARG USER_GID
# Whether system/cuda.sh installs the CUDA toolkit. Off unless something in
# this checkout compiles CUDA sources and the host has an NVIDIA GPU behind its
# container runtime.
ARG INSTALL_CUDA

ARG CLAUDE_CODE_VERSION
ARG CODEX_VERSION
ARG LAZYGIT_VERSION
ARG NODE_VERSION
ARG PLAYWRIGHT_VERSION
ARG NEXTEST_VERSION
ARG RUST_VERSION

# Install apt packages, base OS configuration, and the container user.
COPY ./system/apt.sh ./system/cuda.sh ./system/system-config.sh ./system/init-user.sh /tmp/scripts/
RUN bash /tmp/scripts/apt.sh && \
	bash /tmp/scripts/cuda.sh && \
	bash /tmp/scripts/system-config.sh && \
	bash /tmp/scripts/init-user.sh && \
	rm -rf /tmp/scripts

# Claude Code's managed settings. Every session in the image runs unattended,
# and the managed file is the one source Claude Code takes a default of bypass
# permissions mode from whichever configuration directory a session points it
# at: it ignores the mode in a checkout's own .claude/settings.json, which a
# repository could write, and reads a user's file only from the directory
# CLAUDE_CONFIG_DIR names. See ai/claude-managed-settings.json.
COPY ./ai/claude-managed-settings.json /etc/claude-code/managed-settings.json
USER $USERNAME

# Make binaries installed in the next step available via the PATH.
ENV PATH="$PATH:/home/$USERNAME/.local/bin:/home/$USERNAME/.cargo/bin"

# Copy the install scripts and shell config.
COPY --chown=${USER_UID}:${USER_GID} \
	./ai/claude.sh \
	./ai/codex.sh \
	./tools/lazygit.sh \
	./tools/az.sh \
	./tools/gh.sh \
	./tools/k8s.sh \
	./tools/kubectl.sh \
	./tools/container.sh \
	./tools/uv.sh \
	./tools/browsers.sh \
	./system/browser-deps.sh \
	./post-install.sh \
	./system/.bashrc \
	./system/.tmux.conf \
	/tmp/scripts/
COPY --chown=${USER_UID}:${USER_GID} \
	./languages/node/install.sh \
	/tmp/scripts/languages/node/
COPY --chown=${USER_UID}:${USER_GID} \
	./languages/rust/install.sh \
	./languages/rust/rustup.sh \
	./languages/rust/targets.sh \
	./languages/rust/cargo-nextest.sh \
	/tmp/scripts/languages/rust/

RUN mkdir -p "$HOME/.local/bin" "/tmp/$USERNAME" && \
	bash /tmp/scripts/lazygit.sh && \
	bash /tmp/scripts/az.sh && \
	bash /tmp/scripts/gh.sh && \
	bash /tmp/scripts/k8s.sh && \
	bash /tmp/scripts/container.sh && \
	bash /tmp/scripts/uv.sh && \
	bash /tmp/scripts/languages/node/install.sh && \
	bash /tmp/scripts/languages/rust/install.sh && \
	bash /tmp/scripts/claude.sh && \
	bash /tmp/scripts/codex.sh && \
	bash /tmp/scripts/post-install.sh

# The browser engines' system libraries. They are apt's, so they need root, and
# Playwright resolves which ones they are by running `npx`, so this sits after
# the Node install above rather than beside the rest of the apt work at the top
# of this file. The build takes root back for the one step, and each half drops
# the package index and the package cache it downloaded to run. See the header
# of system/browser-deps.sh.
USER root
RUN bash /tmp/scripts/browser-deps.sh && \
	rm -rf /var/lib/apt/lists/* /root/.npm
USER $USERNAME

# The engines themselves, which land in the container user's own cache and are
# therefore downloaded as that user.
RUN bash /tmp/scripts/browsers.sh && \
	rm -rf "$HOME/.npm" /tmp/scripts
