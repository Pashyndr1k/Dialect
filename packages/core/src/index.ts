/**
 * @dialect/core — the compiler.
 *
 * Portable by design: no filesystem, no network, no platform APIs. The desktop
 * app, the CLI and the local HTTP API all drive this same package, so a prompt
 * composed in one is byte-identical in the others.
 */

export * from './ir/types.ts';
export * from './registry/types.ts';
export * from './registry/load.ts';
export * from './renderers/index.ts';
export * from './rules/index.ts';
export * from './compile.ts';
export * from './providers/index.ts';
export * from './extract/index.ts';
