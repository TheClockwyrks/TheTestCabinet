FROM docker.io/library/ubuntu:26.04
USER root

# Auto-provided by the builder: "amd64" on x64, "arm64" on ARM.
ARG BUILDARCH

ARG USERNAME
ARG USER_UID
ARG USER_GID
ARG DOCKER_GID

ARG LAZYGIT_VERSION
ARG NODE_VERSION
ARG RUST_VERSION
ARG TZ

# Install apt packages, base OS configuration, and the container user.
COPY ./system/apt.sh ./system/system-config.sh ./system/init-user.sh /tmp/scripts/
RUN bash /tmp/scripts/apt.sh && \
	bash /tmp/scripts/system-config.sh && \
	bash /tmp/scripts/init-user.sh && \
	rm -rf /tmp/scripts
USER $USERNAME

# Make binaries installed in the next step available via the PATH.
ENV PATH="$PATH:/home/$USERNAME/.local/bin"

# Copy the install scripts and shell config.
COPY --chown=${USER_UID}:${USER_GID} \
	./ai/claude.sh \
	./ai/codex.sh \
	./tools/lazygit.sh \
	./tools/az.sh \
	./tools/gh.sh \
	./tools/wrangler.sh \
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
	./languages/rust/tauri.sh \
	/tmp/scripts/languages/rust/

RUN mkdir -p "$HOME/.local/bin" "/tmp/$USERNAME" && \
	bash /tmp/scripts/lazygit.sh && \
	bash /tmp/scripts/az.sh && \
	bash /tmp/scripts/gh.sh && \
	bash /tmp/scripts/languages/node/install.sh && \
	bash /tmp/scripts/wrangler.sh && \
	bash /tmp/scripts/languages/rust/install.sh && \
	bash /tmp/scripts/languages/rust/tauri.sh && \
	bash /tmp/scripts/claude.sh && \
	bash /tmp/scripts/codex.sh && \
	bash /tmp/scripts/post-install.sh && \
	rm -rf /tmp/scripts && \
	# Markdown linting for the docs.
	npm install -g markdownlint-cli2
