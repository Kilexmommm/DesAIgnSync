import { useState, type FormEvent } from 'react';

import { elementTargetLabel } from '@desaignsync/core';
import type { McpServerRuntimeStatus } from '@desaignsync/shared-types';

import { useElementPicker } from './useElementPicker.js';
import { useHostConnection, type HostConnectionSnapshot } from './useHostConnection.js';

const STATE_LABEL: Record<HostConnectionSnapshot['state'], string> = {
  checking: 'Checking...',
  offline: 'Local Host offline',
  'pairing-required': 'Pairing required',
  connected: 'Connected'
};

/**
 * Side Panel shell (DS-002).
 *
 * Scope of Wave 1: host connectivity, pairing and MCP server visibility.
 * Element selection (DS-012), review flow (DS-018) and page audit (DS-019) are not implemented yet
 * and are listed explicitly instead of being faked.
 */
export function App(): React.JSX.Element {
  const { snapshot, busy, pair, refresh, unpair, updateHostUrl, testServer } = useHostConnection();
  const { picking, target, error: pickError, start: startPick, clear: clearPick } = useElementPicker();
  const [hostUrlInput, setHostUrlInput] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [actionError, setActionError] = useState<string | undefined>(undefined);

  const effectiveHostUrl = hostUrlInput !== '' ? hostUrlInput : snapshot.hostUrl;

  const handlePair = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setActionError(undefined);
    try {
      await pair(pairingCode.trim().toUpperCase());
      setPairingCode('');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Pairing failed.');
    }
  };

  const handleHostUrl = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setActionError(undefined);
    try {
      await updateHostUrl(effectiveHostUrl);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Cannot use that host URL.');
    }
  };

  return (
    <div className="ds-app">
      <header className="ds-header">
        <h1>DesAIgnSync</h1>
        <p>MCP-first Design System compliance auditor</p>
      </header>

      <section className="ds-card">
        <h2>Local MCP Host</h2>
        <div className="ds-row">
          <span>Status</span>
          <span className={`ds-badge ds-badge--${snapshot.state}`}>{STATE_LABEL[snapshot.state]}</span>
        </div>
        <div className="ds-row">
          <span>Endpoint</span>
          <span className="ds-muted">{snapshot.hostUrl || effectiveHostUrl}</span>
        </div>
        <div className="ds-row">
          <span>Host version</span>
          <span className="ds-muted">{snapshot.hostVersion ?? 'n/a'}</span>
        </div>
        <div className="ds-row">
          <span>Pairing window</span>
          <span className="ds-muted">{snapshot.pairingOpen ? 'open' : 'closed'}</span>
        </div>

        <form className="ds-form" onSubmit={(event) => void handleHostUrl(event)}>
          <input
            className="ds-input"
            aria-label="Local Host URL"
            placeholder="http://127.0.0.1:8787"
            value={effectiveHostUrl}
            onChange={(event) => setHostUrlInput(event.target.value)}
          />
          <button className="ds-button" type="submit" disabled={busy}>
            Use
          </button>
        </form>

        {snapshot.state === 'pairing-required' ? (
          <form className="ds-form" onSubmit={(event) => void handlePair(event)}>
            <input
              className="ds-input"
              aria-label="Pairing code"
              placeholder="Pairing code"
              maxLength={8}
              value={pairingCode}
              onChange={(event) => setPairingCode(event.target.value)}
            />
            <button className="ds-button" type="submit" disabled={busy || pairingCode.length < 8}>
              Pair
            </button>
          </form>
        ) : null}

        {snapshot.state === 'connected' ? (
          <div className="ds-row">
            <button
              className="ds-button"
              type="button"
              onClick={() => void refresh()}
              disabled={busy}
            >
              Refresh
            </button>
            <button className="ds-button" type="button" onClick={() => void unpair()} disabled={busy}>
              Unpair
            </button>
          </div>
        ) : null}

        {snapshot.state === 'offline' ? (
          <p className="ds-note">
            Start the host with <code>npm run host</code> and paste the pairing code it prints.
          </p>
        ) : null}

        {snapshot.message ? <p className="ds-note">{snapshot.message}</p> : null}
        {actionError ? <p className="ds-note ds-badge--error">{actionError}</p> : null}
      </section>

      <section className="ds-card">
        <h2>Selected element</h2>
        {target ? (
          <>
            <div className="ds-row">
              <span>{elementTargetLabel(target)}</span>
              <span className="ds-badge ds-badge--ready">target</span>
            </div>
            <div className="ds-row">
              <span>Selector</span>
              <span className="ds-muted">{target.selector}</span>
            </div>
            <div className="ds-row">
              <span>Box</span>
              <span className="ds-muted">
                {Math.round(target.rect.width)}×{Math.round(target.rect.height)} px
                {target.role ? ` · role=${target.role}` : ''}
              </span>
            </div>
          </>
        ) : (
          <p className="ds-muted">No element selected yet.</p>
        )}

        <div className="ds-row">
          <button
            className="ds-button"
            type="button"
            disabled={picking}
            onClick={() => void startPick()}
          >
            {picking ? 'Pick in page...' : 'Select element'}
          </button>
          <button className="ds-button" type="button" disabled={!target} onClick={clearPick}>
            Clear
          </button>
        </div>
        <p className="ds-note">
          Read-only: the page is never modified. Evidence collection, matching and the checklist for
          this selection arrive with DS-018.
        </p>
        {pickError ? <p className="ds-note ds-badge--error">{pickError}</p> : null}
      </section>

      <section className="ds-card">
        <h2>MCP servers</h2>
        {snapshot.servers.length === 0 ? (
          <p className="ds-muted">No MCP servers reported by the host.</p>
        ) : (
          <ul className="ds-list">
            {snapshot.servers.map((server) => (
              <ServerRow key={server.serverId} server={server} busy={busy} onTest={testServer} />
            ))}
          </ul>
        )}
        <p className="ds-note">
          Adding and editing MCP servers arrives with DS-028. Test connection is available now.
        </p>
      </section>

      <section className="ds-card">
        <h2>Coming in later waves</h2>
        <ul className="ds-upcoming">
          <li>Evidence, matching and checklist for the selected element (DS-018)</li>
          <li>Deterministic rules with tolerances (DS-014, DS-015)</li>
          <li>Auditable checklist and export (DS-020)</li>
          <li>Page audit (DS-019) and Ask AI (DS-021)</li>
        </ul>
      </section>
    </div>
  );
}

interface ServerRowProps {
  server: McpServerRuntimeStatus;
  busy: boolean;
  onTest: (serverId: string) => Promise<McpServerRuntimeStatus | undefined>;
}

function ServerRow({ server, busy, onTest }: ServerRowProps): React.JSX.Element {
  return (
    <li className="ds-row">
      <span>
        <strong>{server.name}</strong>
        <br />
        <span className="ds-muted">
          {server.transport} · {server.tools?.length ?? 0} tools
          {server.restartCount > 0 ? ` · restarts ${server.restartCount}` : ''}
        </span>
      </span>
      <span>
        <span className={`ds-badge ds-badge--${server.state}`}>{server.state}</span>{' '}
        <button
          className="ds-button"
          type="button"
          disabled={busy}
          onClick={() => void onTest(server.serverId)}
        >
          Test
        </button>
      </span>
    </li>
  );
}