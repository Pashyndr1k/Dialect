import type { Template } from '@dialect/core';

/**
 * Say what you want, in as many or as few words as you have.
 *
 * This sits on the left with the references because it is the same kind of
 * thing: what the user brought. A reference is a picture of the idea; this is
 * the idea itself, and either one produces the document on the right.
 *
 * A template turns the job from inventing a whole document into answering that
 * template's questions, which is both cheaper and better — so the picker is
 * here rather than buried, and it says what it will do.
 */

/** Roughly what one write costs. Small, but not nothing, so it is shown. */
export const PER_IDEA_USD = 0.02;

export function Idea({
  idea,
  templateId,
  templates,
  busy,
  disabled,
  onIdea,
  onTemplate,
  onWrite,
}: {
  idea: string;
  templateId: string;
  templates: Template[];
  busy: boolean;
  disabled: boolean;
  onIdea: (next: string) => void;
  onTemplate: (next: string) => void;
  onWrite: () => void;
}) {
  const chosen = templates.find((t) => t.id === templateId);
  const ready = idea.trim().length > 0 && !busy && !disabled;

  return (
    <div className="idea">
      <textarea
        className="idea-t"
        rows={3}
        spellCheck={false}
        placeholder="Or describe what you want — a few words is enough"
        value={idea}
        onChange={(e) => onIdea(e.target.value)}
        onKeyDown={(e) => {
          // The obvious shortcut for a box with a button next to it.
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
          className="solid"
          disabled={!ready}
          title={
            disabled
              ? 'Needs a key in Settings'
              : chosen
                ? `Fill in "${chosen.name}" from these words`
                : 'Write a whole document from these words'
          }
          onClick={onWrite}
        >
          {busy ? 'Writing…' : `Write prompt · about $${PER_IDEA_USD.toFixed(2)}`}
        </button>
      </div>
    </div>
  );
}
