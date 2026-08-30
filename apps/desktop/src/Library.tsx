import type { LibraryEntry } from './store.ts';

/**
 * References this app has read before, on any day.
 *
 * The cache holds the answers, but a cache entry is a hash and a blob — nothing
 * anyone could pick out of a list. This is the list: what each was called, when
 * it was read, and enough of a picture to recognise. Choosing one brings back
 * its prompt without paying for it again.
 *
 * References already in this session are not shown: they are up there.
 */
export function Library({
  entries,
  onRestore,
  busy,
}: {
  entries: LibraryEntry[];
  onRestore: (entry: LibraryEntry) => void;
  busy: string | null;
}) {
  if (entries.length === 0) return null;

  return (
    <div className="library">
      <div className="batch-h">
        <h3>
          Read earlier
          <span className="batch-c">
            {entries.length} reference{entries.length === 1 ? '' : 's'}, free to open
          </span>
        </h3>
      </div>

      <ul className="lib-rows">
        {entries.map((entry) => (
          <li key={entry.key}>
            <button
              className="lib-row"
              disabled={busy !== null}
              title={`Read ${new Date(entry.readAt).toLocaleString()} — opening it costs nothing`}
              onClick={() => onRestore(entry)}
            >
              {entry.thumb ? (
                <img src={entry.thumb} alt="" />
              ) : (
                <span className="lib-nothumb" aria-hidden="true" />
              )}
              <span className="lib-name">{entry.ref}</span>
              <span className="lib-when">
                {busy === entry.key ? 'opening…' : new Date(entry.readAt).toLocaleDateString()}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
