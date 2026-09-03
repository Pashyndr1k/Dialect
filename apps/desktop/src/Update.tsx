/**
 * Telling you a new version exists, once.
 *
 * Deliberately quiet. It checks at startup, and if there is nothing it says
 * nothing and never mentions itself again — an app that reports "you are up to
 * date" every launch has taught you to ignore the place it will one day say
 * something else.
 *
 * Nothing installs on its own. A download and a restart in the middle of work
 * is the app deciding your afternoon is less important than its version number.
 */

import { useEffect, useState } from 'react';
import { check, type Update as Available } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

type Stage = 'idle' | 'found' | 'getting' | 'ready' | 'failed';

/** How much has arrived, when the server bothered to say how much there is. */
function progressOf(got: number, total: number | undefined): string {
  if (!total) return `${(got / 1024 / 1024).toFixed(0)} MB`;
  return `${Math.round((got / total) * 100)}%`;
}

export function Update(): React.ReactElement | null {
  const [stage, setStage] = useState<Stage>('idle');
  const [update, setUpdate] = useState<Available | null>(null);
  const [note, setNote] = useState('');
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const found = await check();
        if (found) {
          setUpdate(found);
          setStage('found');
        }
      } catch {
        // No network, no release yet, or a dev build with no endpoint. None of
        // those is worth a word: nothing the person is doing has changed.
      }
    })();
  }, []);

  if (stage === 'idle' || dismissed || !update) return null;

  const install = async (): Promise<void> => {
    setStage('getting');
    try {
      let got = 0;
      let total: number | undefined;
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') total = event.data.contentLength;
        if (event.event === 'Progress') {
          got += event.data.chunkLength;
          setNote(progressOf(got, total));
        }
      });
      setStage('ready');
    } catch (err) {
      setNote((err as Error).message);
      setStage('failed');
    }
  };

  return (
    <aside className="update" role="status">
      {stage === 'found' ? (
        <>
          <span>
            <b>{update.version}</b> is out. You have {update.currentVersion}.
          </span>
          <button type="button" onClick={() => void install()}>
            Get it
          </button>
          <button type="button" className="ghost" onClick={() => setDismissed(true)}>
            Later
          </button>
        </>
      ) : null}

      {stage === 'getting' ? <span>Downloading… {note}</span> : null}

      {stage === 'ready' ? (
        <>
          {/* Installed, but not switched to. Restarting is still the person's
              call — they may be in the middle of a run. */}
          <span>{update.version} is installed. It starts using it when you restart.</span>
          <button
            type="button"
            onClick={() =>
              void relaunch().catch((err: Error) => {
                setNote(err.message);
                setStage('failed');
              })
            }
          >
            Restart now
          </button>
          <button type="button" className="ghost" onClick={() => setDismissed(true)}>
            Later
          </button>
        </>
      ) : null}

      {stage === 'failed' ? (
        <>
          <span className="update-bad">That update would not install: {note}</span>
          <button type="button" className="ghost" onClick={() => setDismissed(true)}>
            Close
          </button>
        </>
      ) : null}
    </aside>
  );
}
