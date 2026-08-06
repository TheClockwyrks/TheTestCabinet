// `lib` is the guest's own object, bound only when this session has read a skill or a memory that
// carried code — so, like every API object, it is reached through `typeof` rather than by name.
export const libImpl = (key) => (name) => {
  if (typeof lib === "undefined") return null;
  const module_ = lib[key];
  if (module_ === undefined || module_ === null) return null;
  const value = module_[name];
  return value === undefined ? null : value;
};
