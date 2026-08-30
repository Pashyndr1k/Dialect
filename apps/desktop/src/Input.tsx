import { ROLE_LABEL, SOURCE_ROLES, type SourceRole } from '@dialect/core';

/**
 * One block: what you want, and what you brought.
 *
 * They are not two channels. A sentence narrows a reference and a reference
 * grounds a sentence, and either alone is a fair answer — so there is one box,
 * one row of attachments, and one button that does whatever the two of them add
 * up to.
 *
 * Speaking is not a third thing. It is a way of filling the box, so it is an
 * icon beside the box.
 */

export interface Attachment {
  name: string;
  kind: 'image' | 'video' | 'audio';
  role: SourceRole;
  /** What it turned out to say, once it has been read. */
  read?: string;
  /** Whether this is the one shown in the preview. */
  showing?: boolean;
}

function Mic({ recording }: { recording: boolean }) {
  return recording ? (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" />
    </svg>
  ) : (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none">
      <rect x="6" y="2" width="4" height="7" rx="2" fill="currentColor" />
      <path
        d="M3.75 7.25v.5a4.25 4.25 0 0 0 8.5 0v-.5M8 12.25V14"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Input({
  idea,
  attached,
  working,
  recording,
  hearing,
  canSpeak,
  speakNote,
  noKey,
  cost,
  onIdea,
  onRole,
  onShow,
  onGo,
  onRecord,
  onStopRecording,
  onAttach,
  onDetach,
  onFolder,
}: {
  idea: string;
  attached: Attachment[];
  /** Reading, writing, or both — the label the button carries while it runs. */
  working: string | null;
  recording: boolean;
  hearing: boolean;
  canSpeak: boolean;
  speakNote: string;
  noKey: boolean;
  /** What pressing the button will cost, given what has already been read. */
  cost: number;
  onIdea: (next: string) => void;
  onRole: (name: string, role: SourceRole) => void;
  onShow: (name: string) => void;
  onGo: () => void;
  onRecord: () => void;
  onStopRecording: () => void;
  onAttach: () => void;
  onDetach: (name: string) => void;
  onFolder: () => void;
}) {
  const ready = (idea.trim().length > 0 || attached.length > 0) && !working && !noKey;

  return (
    <div className="in">
      <div className="in-say">
        <textarea
          className="idea-t"
          rows={3}
          spellCheck={false}
          placeholder="What you want"
          value={idea}
          onChange={(e) => onIdea(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && ready) onGo();
          }}
        />
        <button
          className={`mic${recording ? ' on' : ''}`}
          disabled={!canSpeak || hearing}
          title={recording ? 'Stop and write it down' : canSpeak ? 'Dictate' : speakNote}
          aria-label={recording ? 'Stop dictating' : 'Dictate'}
          onClick={recording ? onStopRecording : onRecord}
        >
          {hearing ? <span className="mic-w" /> : <Mic recording={recording} />}
        </button>
      </div>

      {attached.length > 0 ? (
        <ul className="refs">
          {attached.map((a) => (
            <li
              key={a.name}
              className={`ref ${a.kind}${a.showing ? ' on' : ''}`}
              title={a.read ?? a.name}
            >
              <button className="ref-n" onClick={() => onShow(a.name)}>
                {a.name}
              </button>
              <select
                className="ref-r"
                value={a.role}
                aria-label={`What ${a.name} is for`}
                onChange={(e) => onRole(a.name, e.target.value as SourceRole)}
              >
                {SOURCE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
              <button
                className="ref-x"
                aria-label={`Remove ${a.name}`}
                onClick={() => onDetach(a.name)}
              >
                {'×'}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="in-row">
        <button className="ghost" onClick={onAttach}>
          Reference
        </button>
        <button className="ghost" title="Read a whole folder, one prompt each" onClick={onFolder}>
          Batch
        </button>

        <button className="solid go" disabled={!ready} onClick={onGo}>
          {working ?? `Prompt · $${cost.toFixed(2)}`}
        </button>
      </div>
    </div>
  );
}
