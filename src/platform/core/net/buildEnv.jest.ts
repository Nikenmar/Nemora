/**
 * Jest stand-in for `buildEnv.ts`, wired up by `moduleNameMapper` in
 * jest.config.mjs.
 *
 * The real module reads `import.meta.env`, which Vite replaces statically at
 * build time. Under ts-jest's CommonJS transform `import.meta` is a SYNTAX
 * error, not a runtime one, so no guard inside the real module can save it -
 * the file cannot be parsed at all. Any suite that reached it transitively
 * failed to run, which happened twice: once through the network tests and
 * again through the runtime tests once secrets started importing it.
 *
 * Mapping it here keeps the real module honest for the Vite build while giving
 * tests a source of build variables they can actually set: process.env, plus
 * the same explicit override hook the real module exposes.
 */

let envOverride: Record<string, string | undefined> | undefined;

export const setBuildEnvOverrideForTests = (
  env: Record<string, string | undefined> | undefined
): void => {
  envOverride = env;
};

export const getBuildEnvVariable = (name: string): string | undefined => {
  if (envOverride) return envOverride[name];
  return process.env[name];
};
