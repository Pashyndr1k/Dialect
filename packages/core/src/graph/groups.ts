/**
 * The five groups a node can be in, and what each is called.
 *
 * One list, in core, because it was two lists in two components and they had
 * already started to differ. The words are fixed in `docs/GLOSSARY.md`: an
 * interface that calls the same thing two things is two things to read.
 */

export type NodeGroup = 'in' | 'read' | 'compose' | 'shape' | 'out';

export interface GroupSpec {
  id: NodeGroup;
  /** What the catalogue calls it. A noun, like the other four. */
  label: string;
}

export const GROUPS: readonly GroupSpec[] = [
  { id: 'in', label: 'Input' },
  { id: 'read', label: 'Read' },
  { id: 'compose', label: 'Describe' },
  { id: 'shape', label: 'Shape' },
  { id: 'out', label: 'Output' },
];

/** The label for one group id, for anywhere that has the id and needs the word. */
export const labelOfGroup = (id: NodeGroup): string =>
  GROUPS.find((g) => g.id === id)?.label ?? id;
