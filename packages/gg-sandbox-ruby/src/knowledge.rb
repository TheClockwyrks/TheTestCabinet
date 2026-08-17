# frozen_string_literal: true

# **`lib`** — the code half of every skill and memory this agent has read, as a file a program
# `require`s.
#
# `require "lib"` is the line, and it is the only way a program reaches its own loaded code: nothing
# below is bound until it runs. Requiring it evaluates each code module the agent read, in the order
# gg handed them over, and defines a top-level `lib` whose members are the binding keys gg named
# when it answered each read — so `lib.helpers.double(21)` calls a method the skill's own author
# wrote.
#
# **It names nothing of gg's surface, deliberately.** `require "lib"` must not be a second way to
# reach `GG::Files`: a program that calls gg writes `require "gg"` itself, and so does a code module
# whose own body calls gg. The one thing this file asks the guest for is the namespaces, over the
# same JavaScript interop `GG::Wire` uses for the membrane.
#
# A module whose body raised leaves an empty namespace rather than taking the program down: its
# author is whoever wrote the skill or the memory, not the model whose program merely has it in
# scope, and the guest reports the raise on its own channel.

# The namespaces, one per binding key, evaluated by the guest at the moment this file is required.
_bound = `globalThis.__ggBindModules()`

# The object `lib` answers with.
#
# A class of its own rather than a bare `Object.new` for what it says when a program reaches for a
# key that is not bound, and anonymous because it is not a name a program should be able to write:
# the only handle on it is `lib`.
_namespaces = Class.new do
  # @param modules [Hash{String => Module}] the namespaces bound this run, by binding key
  def initialize(modules)
    @modules = modules
    modules.each { |key, namespace| define_singleton_method(key) { namespace } }
  end

  # What a program gets for a key this run did not bind.
  #
  # @param name [Symbol] the key that was reached for
  # @param _args [Array] whatever it was called with
  # @raise [NoMethodError] always, naming the key and where the real ones came from
  def method_missing(name, *_args)
    raise NoMethodError,
          "`lib.#{name}` is not bound this run; the keys gg named when it answered the read " \
          "are the ones it has"
  end

  # @param name [Symbol] the key being asked about
  # @param include_private [Boolean] whether private methods count, as Ruby's contract requires
  # @return [Boolean] whether this run really bound `name`
  def respond_to_missing?(name, include_private = false)
    @modules.key?(name.to_s) || super
  end

  # @return [String] the keys bound this run
  def inspect
    "#<gg lib: #{@modules.keys.sort.join(", ")}>"
  end

  alias_method :to_s, :inspect
end.new(_bound)

Object.send(:define_method, :lib) { _namespaces }
