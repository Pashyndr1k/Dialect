/**
 * The two controls that do something rather than just hold a value.
 *
 * Dictation is a way of filling the words box, not a channel of its own — a
 * microphone beside the field, never a separate kind of input. Drawing a card
 * pulls one constraint out of a deck and keeps it on the node, because a set of
 * variations that changed every time you asked for it would not be a set anyone
 * could go back to.
 */

import { useEffect, useState } from 'react';
import { decksFor, drawFrom, type DeckEntry, type VaryAxis } from '@dialect/core';

import { decks } from '../decks.ts';
import { record, transcribe, voiceTools, type Recording } from '../voice.ts';

interface Held {
  params: Record<string, unknown>;
  onParams: (patch: Record<string, unknown>) => void;
}

/* ------------------------------------------------------------- dictation --- */

export function Dictated({
  control,
  data,
}: {
  control: { key: string; label: string; rows?: number; placeholder?: string };
  data: Held;
}): React.ReactElement {
  const [can, setCan] = useState(false);
  const [taking, setTaking] = useState<Recording | null>(null);
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState<string | null>(null);

  useEffect(() => {
    // Dictation needs whisper on the machine or a transcription key. Without
    // either, the button is not shown at all rather than shown and failing.
    void voiceTools()
      .then((t) => setCan(t.ready))
      .catch(() => setCan(false));
  }, []);

  const value = typeof data.params[control.key] === 'string' ? (data.params[control.key] as string) : '';

  const start = async (): Promise<void> => {
    setWrong(null);
    try {
      setTaking(await record());
    } catch (err) {
      setWrong((err as Error).message);
    }
  };

  const finish = async (): Promise<void> => {
    if (!taking) return;
    setBusy(true);
    try {
      const clip = await taking.stop();
      const said = await transcribe(clip.base64, clip.extension);
      // Added to what is there rather than replacing it: dictating is usually
      // the second half of a thought that was already being typed.
      data.onParams({ [control.key]: value ? `${value.trim()} ${said}`.trim() : said });
    } catch (err) {
      setWrong((err as Error).message);
    } finally {
      setTaking(null);
      setBusy(false);
    }
  };

  return (
    <label className="node-field">
      <span className="field-with-mic">
        {control.label}
        {can ? (
          <button
            type="button"
            className={taking ? 'nodrag mic on' : 'nodrag mic'}
            title={taking ? 'Stop and write it down' : 'Dictate'}
            disabled={busy}
            onClick={() => void (taking ? finish() : start())}
          >
            {busy ? '…' : taking ? '■' : '●'}
          </button>
        ) : null}
      </span>
      <textarea
        className="nodrag"
        rows={control.rows ?? 3}
        value={value}
        placeholder={control.placeholder}
        onChange={(e) => data.onParams({ [control.key]: e.target.value })}
      />
      {wrong ? <em className="field-wrong">{wrong}</em> : null}
    </label>
  );
}

/* ------------------------------------------------------------------ deck --- */

export function DeckCard({
  control,
  data,
}: {
  control: { key: string; label: string };
  data: Held;
}): React.ReactElement {
  const held = data.params[control.key] as DeckEntry | undefined;
  // Decks belong to an axis, not to a modality: an oblique constraint for a
  // subject is no use when the thing being varied is the light.
  const axis = (typeof data.params.axis === 'string' ? data.params.axis : 'subject') as VaryAxis;
  const usable = decksFor(decks, axis);

  const draw = (): void => {
    if (usable.length === 0) return;
    const deck = usable[Math.floor(Math.random() * usable.length)]!;
    data.onParams({ [control.key]: drawFrom(deck) });
  };

  return (
    <label className="node-field">
      <span>{control.label}</span>
      {held ? (
        <div className="deck-held">
          <b>{held.name}</b>
          <p>{held.text}</p>
          <div className="deck-buttons">
            <button type="button" className="nodrag" onClick={draw}>
              Another
            </button>
            <button
              type="button"
              className="nodrag"
              onClick={() => data.onParams({ [control.key]: undefined })}
            >
              None
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="nodrag node-pick" onClick={draw}>
          {usable.length === 0 ? 'No deck for this' : 'Draw a card'}
        </button>
      )}
    </label>
  );
}
