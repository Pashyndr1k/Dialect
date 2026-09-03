import { useEffect, useState } from 'react';

import { cacheStats, clearCache, type CacheStats } from './store.ts';
import { ModelPicker } from './ModelPicker.tsx';
import {
  ANTHROPIC_KEY,
  clearSecret,
  secretStatus,
  setSecret,
  type SecretStatus,
} from './secrets.ts';

const STORE_LABEL: Record<SecretStatus['store'], string> = {
  os: 'the operating system credential store',
  browser: 'this browser, in the clear',
};

export function Settings({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<SecretStatus | null>(null);
  const [cache, setCache] = useState<CacheStats | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const refresh = (): void => {
    secretStatus(ANTHROPIC_KEY).then(setStatus, (e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
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

  const save = (): Promise<void> =>
    run(async () => {
      await setSecret(ANTHROPIC_KEY, draft);
      // The value is deliberately not read back: a stored key has no reason to
      // travel through the UI again.
      setDraft('');
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    });

  const clear = (): Promise<void> =>
    run(async () => {
      await clearSecret(ANTHROPIC_KEY);
      setDraft('');
      setSaved(false);
    });

  return (
    <div className="sheet" role="dialog" aria-label="Settings">
      <div className="sheet-box">
        <div className="sheet-h">
          <h2>Anthropic key</h2>
          <button className="ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <p className="sheet-p">
          Reading a reference image is the only step that costs money, and it needs a key.
          Paste one here and it goes to {status ? STORE_LABEL[status.store] : 'storage'} — never
          to a config file, and never into your shell history.
        </p>

        <label className="sheet-l" htmlFor="anthropic-key">
          Key
        </label>
        <input
          id="anthropic-key"
          type="password"
          className="sheet-i"
          placeholder="sk-ant-…"
          autoComplete="off"
          spellCheck={false}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setSaved(false);
          }}
        />

        <div className="sheet-row">
          <button className="ghost" onClick={() => void save()} disabled={busy || !draft.trim()}>
            {saved ? 'Saved' : 'Save'}
          </button>
          <button
            className="ghost"
            onClick={() => void clear()}
            disabled={busy || !status?.stored}
          >
            Forget it
          </button>
          <span className={`state${status?.stored ? ' on' : ''}`}>
            {status === null
              ? 'checking…'
              : status.stored
                ? `stored in ${STORE_LABEL[status.store]}`
                : 'no key stored'}
          </span>
        </div>

        {status?.store === 'browser' ? (
          <p className="sheet-warn">
            This is the dev server in a plain browser, so there is no credential store to reach.
            The key would sit in localStorage in the clear. Run the desktop app to store it
            properly.
          </p>
        ) : null}

        {error ? <p className="sheet-err">{error}</p> : null}

        <ModelPicker />

        {/* What has already been paid for. Clearing it is the one control here
            that costs money later, so it says so rather than being tidy. */}
        {cache ? (
          <p className="sheet-p dim cache-line">
            <span>
              {cache.entries} answer{cache.entries === 1 ? '' : 's'} already bought, {' '}
              {(cache.bytes / 1024 / 1024).toFixed(1)} MB
            </span>
            <button
              type="button"
              className="ghost"
              title="Reading those references again would cost money"
              onClick={() =>
                void run(async () => {
                  await clearCache();
                  setCache(await cacheStats());
                })
              }
            >
              Forget them
            </button>
          </p>
        ) : null}

        <p className="sheet-p dim">
          Keys are issued at{' '}
          <a href="https://console.anthropic.com/" target="_blank" rel="noreferrer">
            console.anthropic.com
          </a>
          . An environment variable still works for the command line.
        </p>
      </div>
    </div>
  );
}
