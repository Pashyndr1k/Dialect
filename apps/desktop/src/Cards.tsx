import { useEffect, useState } from 'react';
import type { LoadedRegistry } from '@dialect/core';

import { CardList } from './CardList.tsx';
import { pickFolder } from './store.ts';

import {
  channelStatus,
  checkChannel,
  installChannel,
  revertChannel,
  type ChannelStatus,
  type Checked,
} from './channel.ts';

/**
 * Where the model cards came from, and how to replace them.
 *
 * Cards are dated. The formula a model wants this month is not the one it
 * wanted last, and the card is the only thing between that change and a wrong
 * prompt — so the set has to be replaceable without a new binary.
 *
 * The cards themselves come first, because that is what someone opening a panel
 * called "Model cards" came to see. Where the set came from is a question you
 * have once; what a card says is a question you have every time one is wrong.
 *
 * This tab used to open with a field demanding a 64-character Ed25519 public
 * key, and until one was pasted in nothing would install. That was a lock on a
 * door standing open beside it — the cards are plain YAML you can read, edit and
 * delete in the other tab. A set is now a folder, or a web address, and it
 * installs.
 */
export function Cards({
  registry,
  onChanged,
  onClose,
}: {
  registry: LoadedRegistry;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'cards' | 'source'>('cards');
  const rejected = registry.rejected;
  const cardCount = registry.registry.profiles.size;
  const [status, setStatus] = useState<ChannelStatus | null>(null);
  const [source, setSource] = useState('');
  const [found, setFound] = useState<Checked | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refresh = (): void => {
    void channelStatus().then(setStatus);
  };
  useEffect(refresh, []);

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await action();
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheet-box wide" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-h">
          <h2>Model cards</h2>
          <button className="ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="tabs">
          <button className={tab === 'cards' ? 'on' : ''} onClick={() => setTab('cards')}>
            The cards
          </button>
          <button className={tab === 'source' ? 'on' : ''} onClick={() => setTab('source')}>
            Where they come from
          </button>
        </div>

        {tab === 'cards' ? <CardList registry={registry} onChanged={onChanged} /> : null}

        <div hidden={tab !== 'source'}>
          <p className="sheet-p">
            {cardCount} cards in use.{' '}
            {status?.version
              ? `Set ${status.channel} v${status.version}, published ${status.published}.`
              : 'The set this build shipped with.'}
          </p>

          {rejected.length > 0 ? (
            <ul className="findings">
              {rejected.map((r) => (
                <li key={`${r.origin}-${r.source}`} className="warn">
                  <span className="lvl">skipped</span>
                  <div>
                    <p className="msg">
                      {r.source} <em className="src">{r.origin}</em>
                    </p>
                    <p className="fix">{r.reason}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}

          <h3>Install a set</h3>
          <p className="sheet-p">
            A folder of <span className="mono">.yaml</span> cards, or a web address serving one.
            The whole set replaces the whole set: a card dropped from it is gone, and a set that
            fails halfway through leaves the working one exactly where it was.
          </p>

          <div className="sheet-row">
            <input
              className="sheet-i"
              spellCheck={false}
              placeholder="a folder, or https://…"
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                setFound(null);
              }}
            />
            <button
              className="ghost"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const dir = await pickFolder();
                  if (dir) {
                    setSource(dir);
                    setFound(null);
                  }
                })
              }
            >
              Choose a folder…
            </button>
          </div>

          <div className="sheet-row">
            <button
              className="ghost"
              disabled={busy || source.trim().length === 0}
              onClick={() => void run(async () => setFound(await checkChannel(source.trim())))}
            >
              Check
            </button>
            <button
              className="solid"
              disabled={busy || source.trim().length === 0}
              onClick={() =>
                void run(async () => {
                  await installChannel(source.trim(), false);
                  setFound(null);
                  setNote('Installed.');
                  onChanged();
                })
              }
            >
              Install
            </button>
          </div>

          {found ? (
            <p className="sheet-p dim">
              {found.channel}
              {found.version > 0 ? ` v${found.version}` : ''}, {found.cards} cards
              {found.published ? `, published ${found.published}` : ''}
              {found.stale ? ' — not newer than what is installed.' : '.'}
            </p>
          ) : null}

          {error ? <p className="sheet-err">{error}</p> : null}
          {note && !error ? <p className="state on">{note}</p> : null}

          {status?.version ? (
            <div className="sheet-row">
              <button
                className="ghost"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await revertChannel();
                    setNote('Back to the cards this build shipped with.');
                    onChanged();
                  })
                }
              >
                Back to built-in
              </button>
            </div>
          ) : null}

          <p className="sheet-p dim">
            Three layers, in this order: what the app shipped with, what a set installed, then
            the cards in your own folder — which load last, so one of yours overrides anything
            above it. A card naming a renderer this build does not have is skipped rather than
            crashing the window.
          </p>
        </div>
      </div>
    </div>
  );
}
