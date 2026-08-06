# frozen_string_literal: true

module GG
  # One of the API objects a program calls gg through: `fs`, `project`, `view`, `harness`, ….
  #
  # A bare `Object.new` would have done, and this exists for what it says when a program reaches
  # for a function that is **not** on it. `fs.read_file` in a run with reading withheld is the
  # single most likely mistake a model makes against this surface, and the difference between
  # `undefined method 'read_file' for #<Object>` and a sentence naming the object and pointing at
  # its directory is a turn.
  #
  # @api private
  class ApiObject
    # @param object [String] the object's model-facing name (`fs`)
    # @param members [Hash{String => Method, Proc}] the callables this run bound onto it
    # @param hint [String] what to point a program at when it reaches for something else
    def initialize(object, members, hint = nil)
      @object = object
      @members = members
      @hint = hint || "`#{object}.list` shows the ones it does"
      # Forwarded explicitly rather than bound with `define_singleton_method(name, &callable)`,
      # which reads better and silently drops the caller's block — so `fs.write_file(path) { … }`
      # would arrive with no body and fail on an argument the program did supply.
      members.each do |name, callable|
        define_singleton_method(name) do |*args, **kwargs, &block|
          kwargs.empty? ? callable.call(*args, &block) : callable.call(*args, **kwargs, &block)
        end
      end
    end

    # What a program gets for a function this run did not bind.
    #
    # @param name [Symbol] the method that was reached for
    # @param _args [Array] whatever it was called with
    # @raise [NoMethodError] always, naming the object and its directory
    def method_missing(name, *_args)
      raise NoMethodError, "`#{@object}.#{name}` is not one of the names this run offers; #{@hint}"
    end

    # @param name [Symbol] the method being asked about
    # @param include_private [Boolean] whether private methods count, as Ruby's contract requires
    # @return [Boolean] whether this object really binds `name`
    def respond_to_missing?(name, include_private = false)
      @members.key?(name.to_s) || super
    end

    # @return [String] the object's name and the functions on it
    def inspect
      "#<gg #{@object}: #{@members.keys.sort.join(", ")}>"
    end

    alias to_s inspect
  end

  # The names a program is given: the API objects, and the types they speak in.
  #
  # Two things are built here, and the difference between them is the whole of gg's capability
  # model as this guest sees it.
  #
  # **The API objects are built from the run.** One per `Catalogue::OBJECT_FOR_MODULE` namespace
  # with at least one function this run offers, each carrying the functions it offers and the
  # `list` directory every object has, installed as a method on `Object` — which is exactly what a
  # top-level `def` in Ruby produces, so `fs.read_file("main.rb")` works in a program with no
  # `require` line and no receiver.
  #
  # **It is not the enforcement.** A program can reach `GG::Files.read_file` directly and gg is
  # built for that: the **host** refuses a call outside the run's enabled set, whichever name the
  # program used to make it. What is built here is the *surface*, and the surface is what a model
  # reads.
  #
  # **The types are built from the SDK.** Every declaration `Catalogue::TYPES` names is bound
  # unconditionally, because a type is not a capability: `ToolError` is what a `rescue` clause
  # catches and `TaskStatus::DONE` is what a status argument is, and a program that could not name
  # them would have to reach for a string.
  #
  # @api private
  module Scope
    # The SDK modules, keyed by the name `Catalogue` files each function under.
    MODULES = {
      "Shell" => Shell,
      "Files" => Files,
      "Skills" => Skills,
      "Memories" => Memories,
      "Tasks" => Tasks,
      "Board" => Board,
      "Context" => Context,
      "Delegation" => Delegation,
      "Views" => Views,
      "Programs" => Programs,
      "Session" => Session,
      "Helpers" => Helpers
    }.freeze

    # The object names installed by the last `install`, so a second run does not leave the first
    # run's surface behind.
    @installed = []

    class << self
      # @return [Array<String>] the object names currently installed on `Object`
      attr_reader :installed
    end

    # The method `name` on `mod`, or nil when the module does not define one.
    #
    # A catalogue entry naming something a module does not define is then a missing name in
    # `bound_tools` — which gg compares against its own vocabulary — rather than a `nil` a program
    # would discover by calling it.
    #
    # @param mod [Module] the SDK module
    # @param name [String] the method name the catalogue gives
    # @return [Method, nil] the bound method, or nil
    def self.exported(mod, name)
      mod.respond_to?(name) ? mod.method(name) : nil
    end

    # The gg tool names this component can bind.
    #
    # gg calls this export in a unit test and asserts set-equality with its own `ALL_TOOL_NAMES`.
    # It is the one drift gate that inspects the **committed artifact** rather than a source file,
    # so it catches the failure no compiler can: a tool added, renamed or removed in gg, with a
    # stale `.wasm` still checked in.
    #
    # @return [Array<String>] every gg tool this SDK really defines a method for
    def self.bound_tools
      Catalogue::TOOLS.select { |(_tool, method, mod)| exported(MODULES[mod], method) }
                      .map { |(tool, _method, _mod)| tool }
    end

    # The API objects a program is given, each carrying the functions this run offers on it.
    #
    # An object with nothing on it is not built at all, so a run with no board tools has no
    # `project` name rather than an empty one.
    #
    # @param enabled [Array<String>] the run's enabled gg tool names
    # @param ending [String] the role whose ending group this program is given; `none` binds no
    #   ending at all, which is what an on-use script runs under
    # @param library [Boolean] whether this agent keeps a program library
    # @return [Hash{String => ApiObject}] the objects, keyed by the name a program calls
    def self.build_objects(enabled, ending, library)
      on = enabled.to_a
      objects = {}
      # Fetch (creating on first use) one object's members, seeded with the directory every object
      # shares.
      object_for = lambda do |name|
        objects[name] ||= Catalogue::META.each_with_object({}) do |(_key, method), members|
          members[method] = Docs.bind_list(name)
        end
      end

      Catalogue::TOOLS.each do |(tool, method, mod)|
        next unless on.include?(tool)

        callable = exported(MODULES[mod], method)
        object_for.call(Catalogue::OBJECT_FOR_MODULE[mod])[method] = callable if callable
      end

      # A helper lives on the object of the tool it is built on, and is bound exactly when that
      # tool is.
      Catalogue::HELPERS.each do |(_key, method, requires)|
        next unless on.include?(requires)

        callable = exported(Helpers, method)
        object_for.call(Catalogue::OBJECT_FOR_MODULE["Helpers"])[method] = callable if callable
      end

      # `view`: always present, on the same carve-out `harness` has — a run that enables no tools
      # at all must still be able to show its model something, and a view is the only channel that
      # reaches it. `open_file` is the one exception: it is a read, so it is offered exactly when
      # `read_file` is.
      view = object_for.call(Catalogue::OBJECT_FOR_MODULE["Views"])
      Catalogue::VIEWS.each do |(_key, method, requires)|
        next if !requires.nil? && !on.include?(requires)

        callable = exported(Views, method)
        view[method] = callable if callable
      end

      # `programs`: the whole object, or no object at all. It is the one family a *capability*
      # gates rather than a tool or a role, so the host says so with a flag instead of a name.
      if library
        object = object_for.call(Catalogue::OBJECT_FOR_MODULE["Programs"])
        Catalogue::PROGRAMS.each do |(_key, method)|
          callable = exported(Programs, method)
          object[method] = callable if callable
        end
      end

      # The one ending group this role produces: what is not this role's ending is not a name.
      Catalogue::SESSION.each do |(_key, method, object_name, role)|
        next unless role == ending

        callable = exported(Session, method)
        object_for.call(object_name)[method] = callable if callable
      end

      objects.each_with_object({}) do |(name, members), out|
        out[name] = ApiObject.new(name, members)
      end
    end

    # Bind every name a program starts with: the API objects this run offers, and the SDK's types.
    #
    # The objects become methods on `Object`, which is what a top-level `def` in Ruby produces, and
    # the types become top-level constants. Both are re-installed on every run and the previous
    # run's objects are removed first, so one instantiation serving two programs never leaves a
    # name behind that this run did not offer.
    #
    # @param enabled [Array<String>] the run's enabled gg tool names
    # @param ending [String] the role whose ending group this program is given
    # @param library [Boolean] whether this agent keeps a program library
    # @return [Array<String>] the API object names a program may reach, in presentation order
    def self.install(enabled, ending, library)
      objects = build_objects(enabled, ending, library)

      @installed.each { |name| Object.send(:remove_method, name) if Object.method_defined?(name) }
      objects.each do |name, api|
        Object.send(:define_method, name) { api }
      end
      @installed = objects.keys

      Catalogue::TYPES.each do |name|
        Object.const_set(name, GG.const_get(name)) unless Object.const_defined?(name)
      end
      Object.const_set(:UNCHANGED, UNCHANGED) unless Object.const_defined?(:UNCHANGED)

      Catalogue::OBJECT_ORDER.select { |name| objects.key?(name) }
    end

    # Bind the code modules `GG::Lib` collected at `lib.<key>`, or remove `lib` when there are
    # none.
    #
    # @return [Boolean] whether a `lib` name was installed
    def self.install_lib
      name = Catalogue::LIB_OBJECT
      Object.send(:remove_method, name) if Object.method_defined?(name)
      modules = Lib.registry
      return false if modules.empty?

      members = modules.each_with_object({}) do |(key, namespace), out|
        out[key] = -> { namespace }
      end
      lib = ApiObject.new(name, members,
                          "the keys gg named when it answered the read are the ones it has")
      Object.send(:define_method, name) { lib }
      true
    end
  end
end
