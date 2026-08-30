/**
 * Model profiles are data, never code.
 *
 * Dialects change every few months — a new version, another flag, a different
 * limit. Anything that would otherwise force a release to change one string
 * belongs in a YAML card under `models/`, shipped over the signed registry
 * channel. Only the *shape* of a dialect lives in a renderer.
 */

import type { Modality } from '../ir/types.ts';
import type { FieldSpec } from '../renderers/resolve.ts';

export type ProfileFamily = Modality | 'pipeline';

/** The overall form of a dialect. Renderers are written per form, not per model. */
export type Syntax =
  /** Labelled fields in a mandatory order, e.g. Kling. */
  | 'field-list'
  /** A director's shot description in prose, e.g. Seedance. */
  | 'shot-description'
  /** Plain conversational description, e.g. the Gemini image line. */
  | 'natural'
  /** Comma-separated phrases plus flags. */
  | 'comma-phrases'
  /** Tag soup, for the older diffusion line. */
  | 'tag-list'
  /** A workflow graph rather than a string, e.g. ComfyUI. */
  | 'graph';

export interface ProfileLimits {
  /** Longest clip the model will generate. */
  durationS?: number;
  maxChars?: number;
  /** How many references may be attached at once. */
  references?: number;
  maxRes?: string;
}

export interface ProfileSupports {
  /** A dedicated negative field. When false, `constraints.avoid` goes elsewhere or nowhere. */
  negativePrompt?: boolean;
  /** Picture and sound generated together in one pass. */
  nativeAudio?: boolean;
  lipSync?: boolean;
  startEndFrame?: boolean;
  tokenWeights?: boolean;
  /**
   * Whether focal lengths and apertures are worth emitting. False for almost
   * everything: models barely differentiate them, so the visible effect carries
   * the meaning instead.
   */
  emitsGearNumbers?: boolean;
  /** Template for reference labels, e.g. `@image{n}`. */
  refSyntax?: string;
}

export interface ModelProfile {
  id: string;
  label: string;
  family: ProfileFamily;
  vendor?: string;
  syntax: Syntax;
  /** Renderer id. Several models share one renderer when they share a form. */
  renderer: string;
  /** Job labels this model is the right pick for. Drives target routing. */
  bestFor?: string[];
  /** One line explaining the routing choice to the user. */
  routingNote?: string;
  /**
   * Title line for a saved document, e.g. `Kling 3.0 prompt`. Often differs from
   * `label`, which names the model itself.
   */
  header?: string;
  /**
   * The dialect itself, for `field-list` profiles: each field in its mandatory
   * order, naming what feeds it. This is what makes a formula like Kling's an
   * editable card rather than a function in the renderer.
   */
  fields?: FieldSpec[];
  /**
   * How those fields become one prompt. Kling wants a labelled field per line;
   * a music model wants one comma-separated line and no labels at all.
   * Defaults to labelled fields separated by a blank line.
   */
  assembly?: { separator?: string; labelled?: boolean };
  /**
   * The order a `shot-description` model expects, recorded for the reader.
   * That form is prose, so the renderer composes it rather than filling slots.
   */
  fieldOrder?: string[];
  limits?: ProfileLimits;
  supports?: ProfileSupports;
  /** IR paths forced to a value before rendering, e.g. `sound.music: false`. */
  defaults?: Record<string, unknown>;
  /** Ids of engine rules that apply on top of the always-on set. */
  rules?: string[];
  /** Source and date, so a stale card is visible rather than silently wrong. */
  source?: { name: string; dated: string };
}

export interface Registry {
  profiles: Map<string, ModelProfile>;
}

export class UnknownTargetError extends Error {
  constructor(id: string, known: string[]) {
    super(
      `No model profile named "${id}". Known targets: ${known.join(', ') || '(registry is empty)'}.`,
    );
    this.name = 'UnknownTargetError';
  }
}
