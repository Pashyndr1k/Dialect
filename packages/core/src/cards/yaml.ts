/**
 * A profile, written out as the card file it is.
 *
 * Ordered by hand rather than by whatever order the object happened to be
 * built in. A card is read by people — that is the entire reason it is YAML and
 * not JSON — and the order the built-in cards use is what someone comparing a
 * new card against them will expect: what it is, what it is for, how it is
 * built, what it will not do, where it came from.
 */

import { stringify } from 'yaml';
import type { ModelProfile } from '../registry/types.ts';

/** Card keys, in the order a person reads them. */
const ORDER: Array<keyof ModelProfile> = [
  'id',
  'label',
  'vendor',
  'family',
  'syntax',
  'renderer',
  'header',
  'bestFor',
  'routingNote',
  'fields',
  'fieldOrder',
  'assembly',
  'limits',
  'supports',
  'defaults',
  'rules',
  'source',
];

export function profileToYaml(profile: ModelProfile): string {
  const ordered: Record<string, unknown> = {};
  for (const key of ORDER) {
    if (profile[key] !== undefined) ordered[key] = profile[key];
  }
  // Anything added to the format since this list was written still gets out,
  // at the end, rather than being silently dropped on a round trip.
  for (const [key, value] of Object.entries(profile)) {
    if (!(key in ordered) && value !== undefined) ordered[key] = value;
  }

  return stringify(ordered, {
    lineWidth: 88,
    // Long prose folds rather than running off the side; short strings stay bare.
    defaultStringType: 'PLAIN',
    defaultKeyType: 'PLAIN',
  });
}
