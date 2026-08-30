import type { Template } from '@dialect/core';

/**
 * Four ways in, one block.
 *
 * They are four because they are four different things someone might have: a
 * sentence, a voice, a file, a folder of them. Not four buttons in a row — one
 * choice, and then only what that choice needs, so the panel is never showing
 * controls for a thing nobody is doing.
 *
 * Speaking is not its own destination: it fills the same box describing does,
 * and the words land there to be corrected before they are spent on.
 */

export const MODES = ['describe', 'speak', 'file', 'folder'] as const;
export type InputMode = (typeof MODES)[number];

const MODE_LABEL: Record<InputMode, string> = {
  describe: 'Describe',
  speak: 'Speak',
  file: 'Reference',
  folder: 'Folder',
};

const MODE_TITLE: Record<InputMode, string> = {
  describe: 'Type a few words and let the app write the rest',
  speak: 'Say it instead of typing it',
  file: 'A still, a clip or a track — read as whatever it is',
  folder: 'Every reference in one folder, read as a batch',
};

/** Roughly what one write costs. Small, but not nothing, so it is shown. */
export const PER_IDEA_USD = 0.02;

export function Input({
  mode,
  idea,
  templateId,
  templates,
  writing,
  recording,
  hearing,
  busy,
  noKey,
  canSpeak,
  speakNote,
  canReadMedia,
  onMode,
  onIdea,
  onTemplate,
  onWrite,
  onRecord,
  onStopRecording,
  onFile,
  onFolder,
  onTemplates,
}: {
  mode: InputMode;
  idea: string;
  templateId: string;
  templates: Template[];
  writing: boolean;
  recording: boolean;
  hearing: boolean;
  /** A reference is being read, so the panel says so instead of taking more. */
  busy: string | null;
  noKey: boolean;
  canSpeak: boolean;
  /** What is missing, when speaking is not available. */
  speakNote: string;
  canReadMedia: boolean;
  onMode: (next: InputMode) => void;
  onIdea: (next: string) => void;
  onTemplate: (next: string) => void;
  onWrite: () => void;
  onRecord: () => void;
  onStopRecording: () => void;
  onFile: () => void;
  onFolder: () => void;
  onTemplates: () => void;
}) {
  const chosen = templates.find((t) => t.id === templateId);
  const ready = idea.trim().length > 0 && !writing && !noKey;
  const words = mode === 'describe' || mode === 'speak';

  return (
    <div className="in">
      <div className="in-tabs" role="tablist">
        {MODES.map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            className={`in-tab${mode === m ? ' on' : ''}`}
            title={MODE_TITLE[m]}
            onClick={() => onMode(m)}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>

      <div className="in-body">
        {busy ? <p className="drop-busy">Reading {busy}…</p> : null}

        {mode === 'speak' ? (
          <div className="in-rec">
            {recording ? (
              <button className="solid rec" onClick={onStopRecording}>
                <span className="dotr" /> Stop and write it down
              </button>
            ) : (
              <button
                className="solid"
                disabled={!canSpeak || hearing}
                title={canSpeak ? 'Record what you say' : speakNote}
                onClick={onRecord}
              >
                {hearing ? 'Listening back…' : 'Start speaking'}
              </button>
            )}
            <span className="quiet">
              {recording
                ? 'Recording. It stops and transcribes when you press the button.'
                : hearing
                  ? 'Turning it into words…'
                  : canSpeak
                    ? 'The words land in the box below, to correct before you spend on them.'
                    : speakNote}
            </span>
          </div>
        ) : null}

        {words ? (
          <>
            <textarea
              className="idea-t"
              rows={3}
              spellCheck={false}
              placeholder="A few words about what you want — one is enough"
              value={idea}
              onChange={(e) => onIdea(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && ready) onWrite();
              }}
            />

            <div className="idea-b">
              <select
                className="idea-s"
                value={templateId}
                title={
                  chosen?.description?.trim().replace(/\s+/g, ' ') ??
                  'Write the whole document, with nothing deciding it in advance'
                }
                onChange={(e) => onTemplate(e.target.value)}
              >
                <option value="">No template</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>

              <button
                className="ghost"
                title="Make a template from a prompt that already works"
                onClick={onTemplates}
              >
                Templates
              </button>

              <button
                className="solid"
                disabled={!ready}
                title={
                  noKey
                    ? 'Needs a key in Settings'
                    : chosen
                      ? `Fill in "${chosen.name}" from these words`
                      : 'Write a whole document from these words'
                }
                onClick={onWrite}
              >
                {writing ? 'Writing…' : `Write prompt · about $${PER_IDEA_USD.toFixed(2)}`}
              </button>
            </div>
          </>
        ) : null}

        {mode === 'file' ? (
          <div className="in-pick">
            <button className="solid" onClick={onFile}>
              Choose a reference
            </button>
            <p className="quiet">
              {canReadMedia
                ? 'A still, a clip or a track. Each is read as what it is — several at once are staged rather than read straight away.'
                : 'Stills only until ffmpeg is on PATH; clips and tracks need it.'}
            </p>
          </div>
        ) : null}

        {mode === 'folder' ? (
          <div className="in-pick">
            <button className="solid" onClick={onFolder}>
              Choose a folder
            </button>
            <p className="quiet">
              Everything directly inside it, in the order it was named. Subfolders are left alone,
              and nothing is read until you say what it costs is acceptable.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
