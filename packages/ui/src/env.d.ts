// Ambient declarations so the package typechecks standalone (without Vite's
// `vite/client` types). Each consuming app's bundler resolves these imports for
// real; here we only need the shapes.

declare module "*.module.scss" {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module "*.css";
