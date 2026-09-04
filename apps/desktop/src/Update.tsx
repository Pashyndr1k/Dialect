/**
 * A bar that says a newer version exists.
 *
 * Not an updater. Dialect used to download its own replacement and install it,
 * which meant it had to tell its own build from anyone else's, which meant
 * signing every release, which meant a private key, a repository secret and a
 * password to keep. A reasonable trade for software with strangers using it; a
 * poor one for a handful of people who know whoever wrote it.
 *
 * So nothing is downloaded and nothing is run. The host asks GitHub which
 * release is newest and the window offers to open the releases page. What
 * arrives over the network is one version number, and the worst a wrong one can
 * do is offer a link nobody wanted.
 *
 * Silent when there is nothing to say, and silent when it cannot tell. No
 * network, a rate limit, a repository that has never published — none of those
 * is something the person is doing, and a bar saying "could not check for
 * updates" is a bar that is wrong about what matters.
 */

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export function Update(): React.ReactElement | null {
  const [version, setVersion] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [wrong, setWrong] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;

    void (async () => {
      try {
        const { version: latest } = await invoke<{ version: string }>('latest_release', {});
        if (!latest) return;
        // Compared in the host, where it is a numeric comparison with tests
        // behind it. Done here it would be string comparison, and string
        // comparison stops mentioning releases after the tenth.
        const newer = await invoke<boolean>('newer_than', {
          latest,
          running: __APP_VERSION__,
        });
        if (newer) setVersion(latest);
      } catch {
        /* Nothing worth saying. See the note above. */
      }
    })();
  }, []);

  if (!version || dismissed) return null;

  return (
    <aside className="update" role="status">
      <span>
        <b>{version}</b> is out. You have {__APP_VERSION__}.
      </span>
      <button
        type="button"
        onClick={() =>
          void invoke('open_releases', {}).catch((err: unknown) =>
            setWrong(err instanceof Error ? err.message : String(err)),
          )
        }
      >
        Get it
      </button>
      <button type="button" className="ghost" onClick={() => setDismissed(true)}>
        Later
      </button>
      {wrong ? <span className="update-bad">{wrong}</span> : null}
    </aside>
  );
}
