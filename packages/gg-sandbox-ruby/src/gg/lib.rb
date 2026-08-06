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
  # `fs.read_file` or `system.shell` like anything else.
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
  end
end
