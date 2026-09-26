# shellcheck shell=bash
# Write the TeaVM plugin descriptor into a JVM arm's SDK classes directory, so the compiler installs
# `gg.internal.ThrowableNames` on every build.
#
# WHY A FILE AND NOT A DRIVER SETTING. `BuildStrategy` has `setTransformers` — which is how
# `gg.internal.MathImports` is named — and it has nothing for a dependency listener. TeaVM finds
# those the one way it finds any plugin: `TeaVMPluginLoader` reads
# `META-INF/services/org.teavm.vm.spi.TeaVMPlugin` off the build's own class loader, which
# `InProcessBuildStrategy` builds over the classpath entries it was given — and each arm's SDK jar is
# one of them. So the descriptor rides in the jar beside the class it names.
#
# WHY IT IS SHARED. Both arms compile `packages/gg-sandbox-jvm/src` into their own jar and both need
# the descriptor; an arm that lost it would still build, still run, and print a blank header for
# every failure whose class is not one of the three the runtime raises itself — silently, which is
# the failure `ThrowableNames` exists to end. One file, sourced by both, is one fewer place for that
# to happen.
#
# Usage: `gg_jvm_plugin_descriptor <classes-directory>`.

# The service file TeaVM reads, and the one plugin gg registers through it.
gg_jvm_plugin_descriptor() {
	local classes="$1"
	mkdir -p "$classes/META-INF/services"
	echo "gg.internal.ThrowableNames" >"$classes/META-INF/services/org.teavm.vm.spi.TeaVMPlugin"
}
