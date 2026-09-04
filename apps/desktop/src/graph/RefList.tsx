/**
 * The two lists on a Reference node: the files, and the readings of them.
 *
 * A reference and the reading of it used to be separate nodes, which made
 * "use the reading I already paid for" a different box wired into a different
 * port rather than a choice about the same reference. They are one node now,
 * and picking a reading greys the files rather than removing them — the paths
 * stay so you can switch back, and reading a file twice costs money twice.
 *
 * Three of each. Not because three is principled, but because a node that holds
 * an unbounded list stops being readable on a canvas, and a folder is the right
 * answer past that.
 */

import { filesOf, readingsOf, type GraphSource, type SavedSource } from '@dialect/core';

import { useBoard } from './NodeData.tsx';

interface Held {
  params: Record<string, unknown>;
  onParams: (patch: Record<string, unknown>) => void;
}

function RemoveIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" focusable="false">
      <path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/* ----------------------------------------------------------------- files --- */

export function FileList({
  control,
  data,
}: {
  control: { key: string; label: string; max: number; mutedWhen?: string };
  data: Held;
}): React.ReactElement {
  const { chooseFile } = useBoard();
  const files = filesOf(data.params);

  // Written as the list even when the graph held the old single-file shape, so
  // the first edit to an old node upgrades it rather than leaving two shapes.
  const write = (next: GraphSource[]): void =>
    data.onParams({ [control.key]: next, path: undefined, name: undefined, kind: undefined });

  const muted =
    control.mutedWhen !== undefined &&
    Array.isArray(data.params[control.mutedWhen]) &&
    (data.params[control.mutedWhen] as unknown[]).length > 0;

  return (
    <div className={muted ? 'node-field ref-list muted' : 'node-field ref-list'}>
      <span>
        {control.label}
        {muted ? <em> — not used while a reading is picked</em> : null}
      </span>

      {files.map((f, i) => (
        <div className="ref-row" key={`${f.path}-${i}`}>
          <span className="ref-name" title={f.path}>
            {f.name}
          </span>
          <span className="ref-kind">{f.kind}</span>
          <button
            type="button"
            className="nodrag ref-drop"
            title={`Remove ${f.name}`}
            aria-label={`Remove ${f.name}`}
            onClick={() => write(files.filter((_, n) => n !== i))}
          >
            <RemoveIcon />
          </button>
        </div>
      ))}

      {files.length < control.max ? (
        <button
          type="button"
          className="nodrag node-pick"
          onClick={() =>
            void chooseFile().then((found) => {
              if (found) write([...files, found]);
            })
          }
        >
          {files.length === 0 ? 'Choose a file' : 'Add another'}
        </button>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------- readings --- */

/** What a reading picked out of Memory is stored as on the node. */
interface HeldReading {
  id: string;
  kind: string;
  role: string;
  lines: string[];
}

export function ReadingList({
  control,
  data,
}: {
  control: { key: string; label: string; max: number };
  data: Held;
}): React.ReactElement {
  const { world } = useBoard();
  const readings = readingsOf(data.params);

  const write = (next: HeldReading[]): void => data.onParams({ [control.key]: next });

  const held = readings.map((r) => ({
    id: r.id,
    kind: r.kind,
    role: r.role,
    lines: r.lines,
  })) as HeldReading[];

  const taken = new Set(held.map((r) => r.id));
  const offer = world.sources.filter((s: SavedSource) => !taken.has(s.id));

  return (
    <div className="node-field ref-list">
      <span>{control.label}</span>

      {held.map((r, i) => (
        <div className="ref-row" key={`${r.id}-${i}`}>
          <span className="ref-name" title={`${r.lines.length} lines`}>
            {r.id}
          </span>
          <span className="ref-kind">{r.kind}</span>
          <button
            type="button"
            className="nodrag ref-drop"
            title={`Remove ${r.id}`}
            aria-label={`Remove ${r.id}`}
            onClick={() => write(held.filter((_, n) => n !== i))}
          >
            <RemoveIcon />
          </button>
        </div>
      ))}

      {held.length < control.max ? (
        <select
          className="nodrag"
          value=""
          onChange={(e) => {
            const found = world.sources.find((s: SavedSource) => s.id === e.target.value);
            // The lines come with it. A reading was paid for once and is text
            // afterwards, so attaching it costs nothing and needs no lookup.
            if (found) {
              write([
                ...held,
                { id: found.id, kind: found.kind, role: found.role, lines: found.lines },
              ]);
            }
          }}
        >
          <option value="">{held.length === 0 ? '— nothing from Memory —' : '— add another —'}</option>
          {offer.map((s: SavedSource) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      ) : null}

      {world.sources.length === 0 ? (
        <em className="ref-empty">
          Nothing in Memory yet. Keep a reading after a run and it appears here.
        </em>
      ) : null}
    </div>
  );
}
