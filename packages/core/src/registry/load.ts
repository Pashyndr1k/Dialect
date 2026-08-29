import { parse as parseYaml } from 'yaml';
import type { ModelProfile, Registry } from './types.ts';
import { UnknownTargetError } from './types.ts';

export class ProfileError extends Error {
  constructor(source: string, detail: string) {
    super(`Model profile ${source} is not usable: ${detail}`);
    this.name = 'ProfileError';
  }
}

const REQUIRED = ['id', 'label', 'family', 'syntax', 'renderer'] as const;

/** Parse one YAML card. Throws with the file name rather than a bare YAML error. */
export function parseProfile(yamlText: string, source: string): ModelProfile {
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (err) {
    throw new ProfileError(source, `it is not valid YAML (${(err as Error).message})`);
  }
  if (raw === null || typeof raw !== 'object') {
    throw new ProfileError(source, 'it is empty or not a mapping');
  }
  const profile = raw as Partial<ModelProfile>;
  const missing = REQUIRED.filter((k) => profile[k] === undefined);
  if (missing.length > 0) {
    throw new ProfileError(source, `it is missing ${missing.join(', ')}`);
  }
  return profile as ModelProfile;
}

export function createRegistry(profiles: ModelProfile[]): Registry {
  const map = new Map<string, ModelProfile>();
  for (const p of profiles) {
    const existing = map.get(p.id);
    if (existing) {
      throw new ProfileError(p.id, 'two cards claim the same id');
    }
    map.set(p.id, p);
  }
  return { profiles: map };
}

export function parseRegistry(entries: Array<{ source: string; text: string }>): Registry {
  return createRegistry(entries.map((e) => parseProfile(e.text, e.source)));
}

export function getProfile(registry: Registry, id: string): ModelProfile {
  const found = registry.profiles.get(id);
  if (!found) throw new UnknownTargetError(id, [...registry.profiles.keys()]);
  return found;
}

/**
 * Rank targets for a job label. Routing by job rather than habit is the whole
 * point of `bestFor`; the caller shows the winner with its `routingNote` and
 * lets the user override.
 */
export function routeTargets(
  registry: Registry,
  job: string,
  family?: ModelProfile['family'],
): ModelProfile[] {
  return [...registry.profiles.values()]
    .filter((p) => (family ? p.family === family : true))
    .filter((p) => p.bestFor?.includes(job))
    .sort((a, b) => a.id.localeCompare(b.id));
}
