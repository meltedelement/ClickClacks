// The quiz's link to its server, through party's client (party/client in the
// repo root), with a React hook around its event stream.
import { useEffect, useState } from 'react';
import { subscribe } from '../../../party/client/index.ts';

export { eventsUrl, post } from '../../../party/client/index.ts';

// Subscribes to live state from the server. `undefined` = not received yet.
export function useEvents<T>(url: string | null) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    setData(undefined);
    setConnected(false);
    if (!url) return;
    return subscribe<T>(url, { onData: setData, onConnected: setConnected });
  }, [url]);

  return { data, connected };
}
