# frozen_string_literal: true

module GG
  # The code modules a program reaches at `lib.<key>` — the code half of a skill or a memory the
  # agent has read.
  #
  # A module's namespace in Ruby is a `Module`, so that is what one becomes here: the host wraps
  # the author's source in a call to `define`, the block is evaluated against a fresh anonymous
  # module, and the module extends itself so the `def`s inside it are reachable as
  # `lib.helpers.double(21)`. There is no export protocol for an author to remember — what the
  # module defines is what the namespace offers, which is what `require` gives a Ruby file.
  #
  # Modules are evaluated **before** the program and against the same surface, so a module may call
  # `GG::Files.read_file` or `GG::Shell.run` like anything else.
  #
  # @api private
  module Lib
    # Every module bound this run, keyed by the binding key the host gave it.
    @registry = {}

    # The namespace the most recently evaluated module left behind, waiting to be named.
    @pending = nil

    class << self
      # @return [Hash{String => Module}] the modules bound this run
      attr_reader :registry
    end

    # Forget the previous run's modules, so one instantiation serving two programs never leaves a
    # namespace behind that this run was not given.
    #
    # @return [nil] nothing
    def self.reset
      @registry = {}
      @pending = nil
      nil
    end

    # Evaluate one code module's body against a fresh namespace.
    #
    # This is the call the host wraps an author's source in, and it takes no key because the
    # preparation step that wraps it has not been told one — a module's binding key is assigned
    # when the agent reads the skill or the memory, which is after its code was compiled. The guest
    # names the namespace with `bind` immediately afterwards.
    #
    # @return [Module] the namespace the body left behind
    def self.define(&block)
      @pending = Module.new
      @pending.module_eval(&block)
      @pending.extend(@pending)
    end

    # Name the namespace the last `define` produced, and clear the slot.
    #
    # A module that raised leaves no namespace, and gets an empty one: a program that then calls
    # into it gets an ordinary `NoMethodError` naming the member it wanted, rather than a turn that
    # died over somebody else's code.
    #
    # @param key [String] the binding key the module is reached at (`lib.<key>`)
    # @return [Module] the namespace now bound
    def self.bind(key)
      namespace = @pending || Module.new
      @pending = nil
      @registry[key] = namespace
    end

    # The `lib` a program reaches its loaded code modules through.
    #
    # It is not a capability module: nothing on it is a gg function, its
    # members are whatever each module's body left behind, and the host already told the model which
    # key each one got and what it offers when it answered the read. It exists as a class of its own
    # rather than as a bare `Object.new` for what it says when a program reaches for a key that is
    # not bound.
    #
    # @api private
    class Namespaces
      # @param modules [Hash{String => Module}] the namespaces bound this run, by binding key
      def initialize(modules)
        @modules = modules
        modules.each do |key, namespace|
          define_singleton_method(key) { namespace }
        end
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

      alias to_s inspect
    end
  end
end
