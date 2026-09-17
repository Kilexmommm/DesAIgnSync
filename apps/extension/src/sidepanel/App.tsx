import { useState, type FormEvent } from 'react';

import { elementTargetLabel } from '@desaignsync/core';
import type { McpServerRuntimeStatus } from '@desaignsync/shared-types';

import { ReviewView } from '../review/ReviewView.js';
import { useReview } from '../review/useReview.js';
import { SettingsPanel } from '../settings/SettingsPanel.js';
import { useSettings } from '../settings/useSettings.js';
import { SetupGuide } from './SetupGuide.js';
import { TabBar, type TabDefinition, type TabId } from './Tabs.js';
import { useElementPicker } from './useElementPicker.js';
import { useHostConnection, type HostConnectionSnapshot } from './useHostConnection.js';

const STATE_LABEL: Record<HostConnectionSnapshot['state'], string> = {
  checking: 'checking',
  offline: 'offline',
  'pairing-required': 'pairing',
  connected: 'connected'
};

const TABS: readonly TabDefinition[] = [
  { id: 'setup', label: 'Empezar' },
  { id: 'review', label: 'Revisar' },
  { id: 'mcp', label: 'MCP' },
  { id: 'llm', label: 'LLM' },
  { id: 'profiles', label: 'Perfiles' }
];

/**
 * Side Panel shell (DS-002/DS-028): tabbed layout with a guided setup, the review flow and settings.
 * The panel only orchestrates: evidence, matching, rules and the LLM run inside the Local Host.
 */
export function App(): React.JSX.Element {
  const { snapshot, busy, pair, refresh, unpair, updateHostUrl, testServer } = useHostConnection();
  const { picking, target, error: pickError, start: startPick, clear: clearPick } = useElementPicker();
  const settings = useSettings(snapshot.state === 'connected');
  const profiles = settings.profiles;
  const {
    running: reviewing,
    result: review,
    error: reviewError,
    run: runReview,
    reset: resetReview
  } = useReview();

  const [tab, setTab] = useState<TabId>('setup');
  const [hostUrlInput, setHostUrlInput] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [profileId, setProfileId] = useState('design-qa');
  const [actionError, setActionError] = useState<string | undefined>(undefined);

  const effectiveHostUrl = hostUrlInput !== '' ? hostUrlInput : snapshot.hostUrl;
  const inspectionReady = snapshot.servers.some(
    (server) => server.role === 'inspection' && server.state === 'ready'
  );
  const designSystemReady = snapshot.servers.some(
    (server) => server.role === 'design-system-reference' && server.state === 'ready'
  );

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

  const handleReview = async (): Promise<void> => {
    if (!target) return;
    await runReview({ target, profileId });
  };

  return (
    <div className="ds-app">
      <header className="ds-header">
        <div className="ds-row">
          <h1>DesAIgnSync</h1>
          <span className={`ds-badge ds-badge--${snapshot.state}`}>{STATE_LABEL[snapshot.state]}</span>
        </div>
        <p>Design System compliance · MCP-first</p>
      </header>

      <TabBar tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'setup' ? (
        <>
          <section className="ds-card">
            <h2>DesAIgnSync Start</h2>
            <div className="ds-row">
              <span className="ds-muted">{snapshot.hostUrl || effectiveHostUrl}</span>
              <span className="ds-muted">v{snapshot.hostVersion ?? 'n/a'}</span>
            </div>

            <form className="ds-form" onSubmit={(event) => void handleHostUrl(event)}>
              <input
                className="ds-input ds-input--plain"
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
                <button className="ds-button" type="button" onClick={() => void refresh()} disabled={busy}>
                  Refresh
                </button>
                <button className="ds-button" type="button" onClick={() => void unpair()} disabled={busy}>
                  Unpair
                </button>
              </div>
            ) : null}

            {snapshot.state === 'offline' ? (
              <p className="ds-note">
                Arranca el host con <code>npm run host</code> y pega el pairing code que imprime.
              </p>
            ) : null}

            {snapshot.message ? <p className="ds-note">{snapshot.message}</p> : null}
            {actionError ? <p className="ds-note ds-badge--error">{actionError}</p> : null}
          </section>

          <SetupGuide
            hostState={snapshot.state}
            pairingOpen={snapshot.pairingOpen}
            inspectionReady={inspectionReady}
            designSystemReady={designSystemReady}
            llmReady={settings.providers.length > 0}
            hasTarget={target !== undefined}
            hasReview={review !== undefined}
            onGoTo={setTab}
          />

          <p className="ds-note ds-footnote">
            Próximo: reporte exportable (DS-020), page audit (DS-019), Ask AI (DS-021) y privacidad
            (DS-022).
          </p>
        </>
      ) : null}

      {tab === 'review' ? (
        <>
          <section className="ds-card">
            <h2>Elemento seleccionado</h2>
            {target ? (
              <>
                <div className="ds-row">
                  <span>{elementTargetLabel(target)}</span>
                  <span className="ds-badge ds-badge--ready">target</span>
                </div>
                <div className="ds-row">
                  <span className="ds-muted">{target.selector}</span>
                  <span className="ds-muted">
                    {Math.round(target.rect.width)}×{Math.round(target.rect.height)} px
                    {target.role ? ` · ${target.role}` : ''}
                  </span>
                </div>
              </>
            ) : (
              <p className="ds-muted">Sin selección todavía.</p>
            )}

            <div className="ds-row">
              <button className="ds-button" type="button" disabled={picking} onClick={() => void startPick()}>
                {picking ? 'Pick in page...' : 'Select element'}
              </button>
              <button className="ds-button" type="button" disabled={!target} onClick={clearPick}>
                Clear
              </button>
            </div>

            <div className="ds-row">
              <span className="ds-muted">Perfil</span>
              <select
                className="ds-input ds-select"
                aria-label="Validation profile"
                value={profileId}
                onChange={(event) => setProfileId(event.target.value)}
                disabled={profiles.length === 0}
              >
                {profiles.length === 0 ? <option value={profileId}>{profileId}</option> : null}
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name} · {profile.tier}
                  </option>
                ))}
              </select>
            </div>

            <div className="ds-row">
              <button
                className="ds-button"
                type="button"
                disabled={!target || reviewing || snapshot.state !== 'connected'}
                onClick={() => void handleReview()}
              >
                {reviewing ? 'Reviewing...' : 'Review element'}
              </button>
              {review ? (
                <button className="ds-button" type="button" onClick={resetReview}>
                  Clear result
                </button>
              ) : null}
            </div>

            <p className="ds-note">
              Read-only: la página nunca se modifica. La evidencia viene de Chrome DevTools MCP; el
              matching, las reglas y la interpretación AI corren en el Local Host.
            </p>
            {pickError ? <p className="ds-note ds-badge--error">{pickError}</p> : null}
            {reviewError ? <p className="ds-note ds-badge--error">{reviewError}</p> : null}
          </section>

          {review ? (
            <section className="ds-card">
              <ReviewView result={review} />
            </section>
          ) : null}
        </>
      ) : null}

      {tab === 'mcp' ? (
        <>
          <section className="ds-card">
            <h2>Servidores conectados</h2>
            {snapshot.servers.length === 0 ? (
              <p className="ds-muted">El host no reporta servidores MCP.</p>
            ) : (
              <ul className="ds-list">
                {snapshot.servers.map((server) => (
                  <ServerRow key={server.serverId} server={server} busy={busy} onTest={testServer} />
                ))}
              </ul>
            )}
          </section>
          <section className="ds-card">
            <SettingsPanel
              section="mcp"
              settings={settings}
              servers={snapshot.servers}
              busy={busy}
              onTestServer={testServer}
              activeProfileId={profileId}
              onSelectProfile={setProfileId}
            />
          </section>
        </>
      ) : null}

      {tab === 'llm' ? (
        <section className="ds-card">
          <SettingsPanel
            section="llm"
            settings={settings}
            servers={snapshot.servers}
            busy={busy}
            onTestServer={testServer}
            activeProfileId={profileId}
            onSelectProfile={setProfileId}
          />
        </section>
      ) : null}

      {tab === 'profiles' ? (
        <section className="ds-card">
          <SettingsPanel
            section="profiles"
            settings={settings}
            servers={snapshot.servers}
            busy={busy}
            onTestServer={testServer}
            activeProfileId={profileId}
            onSelectProfile={setProfileId}
          />
        </section>
      ) : null}
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
