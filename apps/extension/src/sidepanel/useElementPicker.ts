import { useCallback, useState } from 'react';

import type { ElementTarget } from '@desaignsync/shared-types';

import { startElementPick } from '../picker/startElementPick.js';

/**
 * Side Panel state for the element picker (DS-012).
 * Evidence collection and matching for the selected target land with DS-018.
 */
export function useElementPicker(): {
  picking: boolean;
  target?: ElementTarget;
  error?: string;
  start: () => Promise<void>;
  clear: () => void;
} {
  const [picking, setPicking] = useState(false);
  const [target, setTarget] = useState<ElementTarget | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const start = useCallback(async (): Promise<void> => {
    setPicking(true);
    setError(undefined);
    try {
      const outcome = await startElementPick();
      if (outcome.target) setTarget(outcome.target);
      if (outcome.error) setError(outcome.error);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : 'Element selection failed.');
    } finally {
      setPicking(false);
    }
  }, []);

  const clear = useCallback((): void => {
    setTarget(undefined);
    setError(undefined);
  }, []);

  return {
    picking,
    ...(target !== undefined ? { target } : {}),
    ...(error !== undefined ? { error } : {}),
    start,
    clear
  };
}
