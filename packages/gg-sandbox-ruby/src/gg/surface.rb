# frozen_string_literal: true

module GG
  # The declaration a capability module writes under each of its model-facing methods, and the
  # registry those declarations build.
  #
  # Two readers need to know which of a module's methods are gg's and which gg operation each one
  # binds, and there is exactly one place either of them learns it: the `operation` line written
  # under the method's own `end`.
  #
  # 1. `GG::Scope`, which binds every one of them onto the modules a program calls, at load time.
  # 2. `tools/signatures.rb`, which requires this SDK, reads {registry} and reflects each entry's
  #    YARD documentation into `crates/gg/src/sandbox/guests/ruby.signatures.json`.
  #
  # ## Why the declaration sits below the method rather than above it
  #
  # Because YARD attaches a doc comment to the statement that follows it, and a statement between
  # the comment and the `def` takes the documentation with it — the method then arrives at a model
  # with no description at all. So the declaration goes where Ruby already writes `private`,
  # `module_function` and `alias_method`: immediately after the `end` it is about, naming the method
  # it is about.
  #
  # ## Why an entry still names a gg tool, and nothing else about gating
  #
  # It does not carry a gate. Which capability buys an operation is gg's to state, once, in its own
  # operations table, and the **host** refuses a call this agent was not granted — the SDK is
  # static, every declaration below is bound onto its module at load time, and no run's enabled set
  # is read anywhere in this package. The `tool:` that survives is a different claim: it says which
  # gg tool this SDK implements a method *for*, which is what `GG::Scope.bound_tools` answers the
  # component's drift export with.
  #
  # @api private
  module Surface
    # One model-facing declaration: what it is called, where it lives, which gg operation it binds,
    # and what this run must offer for it to be bound.
    #
    # @api private
    class Entry
      # @return [Module] the module or class the method is declared on
      attr_reader :owner

      # @return [Symbol] the method's own name
      attr_reader :name

      # @return [String] gg's operation id, `namespace.key`
      attr_reader :operation

      # @return [Boolean] whether this is a second way to reach {operation} rather than the first
      attr_reader :aliased

      # @return [String, nil] the gg tool this SDK implements it for, or nil when no tool dispatches
      #   it
      attr_reader :tool

      # @param owner [Module] the module or class the method is declared on
      # @param name [Symbol] the method's own name
      # @param operation [String] gg's operation id
      # @param aliased [Boolean] whether it is a second way to reach that operation
      # @param tool [String, nil] the gg tool this SDK implements it for
      def initialize(owner:, name:, operation:, aliased:, tool:)
        @owner = owner
        @name = name
        @operation = operation
        @aliased = aliased
        @tool = tool
        freeze
      end

      # Whether the method is a module function rather than a member of a value.
      #
      # @return [Boolean] true for a module function
      def module_function?
        @owner.is_a?(Module) && !@owner.is_a?(Class)
      end

      # The fully-qualified name a documentation view of this method is opened by.
      #
      # A module function is reached through the module (`GG::Files.read_file`) and a member through
      # a value (`GG::Views::OpenView#close`), which is the separator Ruby and YARD both use for the
      # two.
      #
      # @return [String] the name
      def fqn
        "#{@owner.name}#{module_function? ? "." : "#"}#{@name}"
      end
    end

    # The capability modules the surface is divided into, **in the order a reader meets them**.
    #
    # It runs from the modules almost every run has to the ones a particular shape of agent has,
    # because a model reads a list from the top. `Docs` is first because it is the one module no run
    # can withhold and the one a session begins in: the prompt names modules and no function, so
    # finding a name is the first thing a program does and every other module is reached through it.
    # `Core` is last and declares no function at all: it holds the failure every call may raise and
    # the summary every directory is made of.
    #
    # Constant names rather than the modules themselves, so this file stays pure data that the
    # reflector can require before anything that touches the membrane is loaded. Each module's gg
    # id is its name in lower case, and the reflector asserts that of every one of them.
    MODULES = %w[
      Docs
      Files
      Shell
      Board
      Tasks
      Memories
      Views
      Context
      Delegation
      Skills
      Programs
      Session
      Core
    ].freeze

    # Every declaration made so far, in the order the source declares them.
    @registry = []

    class << self
      # @return [Array<Entry>] every model-facing declaration this SDK makes
      attr_reader :registry
    end

    # Record one declaration. Called by {Operations#operation} and {Operations#member_operation}.
    #
    # @param entry [Entry] the declaration
    # @return [Entry] the same declaration
    def self.declare(entry)
      @registry << entry
      entry
    end

    # Every entry declared on `owner`, in declaration order.
    #
    # @param owner [Module] the module or class to look under
    # @return [Array<Entry>] its declarations
    def self.declared_on(owner)
      @registry.select { |entry| entry.owner.equal?(owner) }
    end

    # The gg tool names this SDK really defines a method for.
    #
    # `GG::Scope.bound_tools` answers the component's `bound-tools` export with this, and gg
    # compares it against its own vocabulary on the **committed artifact** — the one drift check
    # that catches a stale `.wasm` rather than a stale source file.
    #
    # @return [Array<String>] every gg tool a canonical declaration binds, in declaration order
    def self.tools
      @registry.reject(&:aliased).filter_map(&:tool).uniq
    end

    # The declaration syntax a capability module extends itself with.
    #
    # @api private
    module Operations
      # Declare that the module function `name` binds the gg operation `id`.
      #
      # @param name [Symbol] the method this module declares
      # @param id [String] gg's operation id, `namespace.key`
      # @param tool [String, nil] the gg tool this SDK implements it for
      # @return [Entry] the recorded declaration
      def operation(name, id, tool: nil)
        Surface.declare(Entry.new(owner: self, name: name, operation: id, aliased: false,
                                  tool: tool))
      end

      # Declare that the instance method `name` is a **second** way to reach the operation `id`.
      #
      # A member function is a second way into a capability the module function already carries, so
      # it names the same operation and the same tool.
      #
      # @param name [Symbol] the method this class declares
      # @param id [String] gg's operation id, `namespace.key`
      # @param tool [String, nil] the gg tool this SDK implements it for
      # @return [Entry] the recorded declaration
      def member_operation(name, id, tool: nil)
        Surface.declare(Entry.new(owner: self, name: name, operation: id, aliased: true,
                                  tool: tool))
      end
    end
  end
end
