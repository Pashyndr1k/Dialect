import type { Template } from '@dialect/core';

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

/** Roughly what one call costs. Small, but not nothing, so it is shown. */
export const PER_CALL_USD = 0.02;

export interface Attachment {
  name: string;
  kind: 'image' | 'video' | 'audio';
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
  templateId,
  templates,
  working,
  recording,
  hearing,
  canSpeak,
  speakNote,
  noKey,
  onIdea,
  onTemplate,
  onGo,
  onRecord,
  onStopRecording,
  onAttach,
  onDetach,
  onFolder,
  onTemplates,
}: {
  idea: string;
  attached: Attachment[];
  templateId: string;
  templates: Template[];
  /** Reading, writing, or both — the label the button carries while it runs. */
  working: string | null;
  recording: boolean;
  hearing: boolean;
  canSpeak: boolean;
  speakNote: string;
  noKey: boolean;
  onIdea: (next: string) => void;
  onTemplate: (next: string) => void;
  onGo: () => void;
  onRecord: () => void;
  onStopRecording: () => void;
  onAttach: () => void;
  onDetach: (name: string) => void;
  onFolder: () => void;
  onTemplates: () => void;
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
            <li key={a.name} className={`ref ${a.kind}`}>
              <span className="ref-n">{a.name}</span>
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
        <button className="ghost" onClick={onFolder}>
          Folder
        </button>

        <select
          className="idea-s"
          value={templateId}
          title={templates.find((t) => t.id === templateId)?.description ?? 'No template'}
          onChange={(e) => onTemplate(e.target.value)}
        >
          <option value="">No template</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>

        <button className="ghost" title="Make a template from a prompt you have" onClick={onTemplates}>
          Edit
        </button>

        <button className="solid go" disabled={!ready} onClick={onGo}>
          {working ?? `Prompt · $${PER_CALL_USD.toFixed(2)}`}
        </button>
      </div>
    </div>
  );
}
