/**
 * The graphs you have open, across the top.
 *
 * There was one graph at a time, and opening another replaced it — which meant
 * that comparing two ways of building the same thing, or keeping a reference
 * graph beside the one being written, meant closing one to see the other. That
 * is a document editor with one window.
 *
 * A tab shows the name and a dot when there are unsaved changes, exactly as the
 * title bar does, because they are reading the same two facts about the same
 * document. The close button appears on hover and on the active tab, so a row
 * of tabs is a row of names rather than a row of names and crosses.
 */

const UNTITLED = 'Untitled graph';

export interface TabView {
  id: string;
  name: string | undefined;
  dirty: boolean;
}

export interface TabsProps {
  tabs: TabView[];
  active: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}

function CloseIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true" focusable="false">
      <path
        d="M3 3l6 6M9 3l-6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Tabs({ tabs, active, onSelect, onClose, onNew }: TabsProps): React.ReactElement {
  return (
    <div className="tab-bar" role="tablist" aria-label="Open graphs">
      {tabs.map((t) => (
        <div key={t.id} className={t.id === active ? 'gtab on' : 'gtab'}>
          <button
            type="button"
            role="tab"
            aria-selected={t.id === active}
            className="gtab-name"
            title={t.name?.trim() || UNTITLED}
            onClick={() => onSelect(t.id)}
            // The middle button closes a tab in every other tabbed thing.
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                onClose(t.id);
              }
            }}
          >
            {t.name?.trim() || UNTITLED}
            {t.dirty ? <i className="graph-dirty" title="Not saved since the last change" /> : null}
          </button>
          <button
            type="button"
            className="gtab-close"
            title={`Close ${t.name?.trim() || UNTITLED}`}
            aria-label={`Close ${t.name?.trim() || UNTITLED}`}
            onClick={() => onClose(t.id)}
          >
            <CloseIcon />
          </button>
        </div>
      ))}

      <button type="button" className="gtab-new" title="New graph" aria-label="New graph" onClick={onNew}>
        +
      </button>
    </div>
  );
}
