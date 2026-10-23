# The CI image of a `shell` repository: the Rust CI image of the same commit,
# plus the Android toolchain, which its Rust job and its Linux and Android
# bundle jobs run in.
#
# A shell is a Tauri workspace (client-tauri, the operator client), and its
# Rust gates compile the WebView it links, which the toolchain image the Rust
# image is built on already holds on amd64: WebKitGTK and the GTK stack around
# it, patchelf and file for the AppImage bundler, Node, and the four Android
# Rust targets. What no other track has is the JDK, the Android SDK and the
# NDK, a couple of gigabytes no other repository's gate reads, so they are a
# track of their own rather than a heavier Rust image for every job.
#
# The workspace template renders an android track of its own only beside a
# Tauri application in the superrepo, which this superrepo does not hold, so
# the track is the project's, as rust-browser is. It is built the template's
# way all the same: nothing is installed, and the toolchain is the template's
# published android image, the one a rendered devcontainer copies, so the
# paths below are the ones a template's Android build reads.
#
# Built on top of the Rust image rather than beside it, so the two cannot
# drift: everything ci/images/rust.Dockerfile states (the toolchain under
# /home/dev, HOME=/root, the safe.directory setting) holds here unchanged. The
# image pipeline builds the Rust image first and hands its reference to this
# build as RUST_CI_IMAGE, at the same commit. The empty default makes a build
# without it fail at once rather than pull some other image. ANDROID_IMAGE
# comes from the `x-devcontainer-build-args` anchor in
# .devcontainer/docker-compose.yml, extracted by ci/images/build-args.sh like
# every CI image's argument.
#
# Built for linux/amd64 only, which here is not only Azure's hosted agents:
# Google publishes the command-line tools, build-tools and NDK for x86_64 Linux
# alone. scripts/ci/ci-image.sh builds and pushes this file. See
# ci/images/README.md.
ARG RUST_CI_IMAGE=
ARG ANDROID_IMAGE
FROM ${ANDROID_IMAGE} AS android
FROM ${RUST_CI_IMAGE}

# The JDK with its configuration and certificates, and the SDK and the NDK
# under the account's home, as a template devcontainer holds them.
COPY --from=android / /

# Where the android image's toolchain sits, and the names the build reads it
# back by. `NDK_HOME` is the name the Tauri CLI reads and `ANDROID_NDK_HOME`
# the one the Gradle plugin reads, for the one path. The versions are the
# android image's tag's, and move with it.
ENV JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 \
	ANDROID_HOME=/home/dev/android/sdk \
	ANDROID_NDK_HOME=/home/dev/android/sdk/ndk/29.0.14206865 \
	NDK_HOME=/home/dev/android/sdk/ndk/29.0.14206865

# The Rust image's PATH with the SDK's tools and the JDK's bin directory added.
# A pipeline step reads no rc file, so it has to be complete here. The JDK's
# bin directory is on it because apksigner and keytool exec `java` by name,
# and the copy links no `java` into /usr/bin.
ENV PATH=/home/dev/.cargo/bin:/home/dev/.local/bin:/home/dev/android/sdk/platform-tools:/home/dev/android/sdk/cmdline-tools/latest/bin:/usr/lib/jvm/java-21-openjdk-amd64/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin

# The copy carries the account's home with the android image's own owner and
# mode, and so undoes the `chmod o+rx /home/dev` the Rust image applies; it is
# opened again, and ANDROID_HOME's directories are made writable, so Gradle
# can fetch into it a package the build asks for that the image does not hold.
# A chmod of the files themselves would copy every one into this layer, and
# the NDK alone is gigabytes.
#
# Azure execs every step as uid 1001, so the layer ends by running java, adb
# and the NDK's clang as that uid, and an SDK only its owner can execute fails
# the image build here rather than a pipeline run later. The three run with a
# scratch HOME the uid can write, because adb aborts where it cannot create
# `~/.android`. The last line checks the WebView's headers are what the Rust
# image was built on, since the shell's Rust gates compile against them.
RUN chmod o+rx /home/dev && \
	find "$ANDROID_HOME" -type d -exec chmod a+w {} + && \
	mkdir -m 1777 /tmp/step-home && \
	setpriv --reuid=1001 --regid=1001 --clear-groups -- env HOME=/tmp/step-home \
		"$JAVA_HOME/bin/java" -version && \
	setpriv --reuid=1001 --regid=1001 --clear-groups -- env HOME=/tmp/step-home \
		"$ANDROID_HOME/platform-tools/adb" --version && \
	setpriv --reuid=1001 --regid=1001 --clear-groups -- env HOME=/tmp/step-home \
		"$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin/clang" --version && \
	rm -rf /tmp/step-home && \
	pkg-config --exists webkit2gtk-4.1 gtk+-3.0 libsoup-3.0

# HOME for every step, widened again after the copy, since Gradle's and npm's
# caches go inside it.
RUN chmod -R a+rwX /root
