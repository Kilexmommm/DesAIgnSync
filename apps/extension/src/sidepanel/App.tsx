import { useState, type FormEvent } from 'react';

import { elementTargetLabel } from '@desaignsync/core';
import type { McpServerRuntimeStatus } from '@desaignsync/shared-types';

import { ReviewView } from '../review/ReviewView.js';
import { useReview } from '../review/useReview.js';
import { SettingsPanel } from '../settings/SettingsPanel.js';
import { useSettings } from '../settings/useSettings.js';
import { Help } from './Help.js';
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

/** Review first: it is where everything else converges (DS-028). */
const TABS: readonly TabDefinition[] = [
  { id: 'review', label: 'Revisar' },
  { id: 'mcp', label: 'MCP' },
  { id: 'llm', label: 'LLM' },
  { id: 'profiles', label: 'Perfiles' }
];

const HELP = {
  host:
    'DesAIgnSync Start es el cerebro local (npm run host). Corre en tu Mac, no en Chrome: lanza los servidores MCP, guarda tus API keys, y ejecuta matching, reglas e interpretación AI. Chrome no puede lanzar procesos locales por seguridad, por eso existe este puente en loopback 127.0.0.1.',
  mcp: 'MCP es el protocolo con el que el cerebro local se conecta a herramientas externas. Chrome DevTools MCP aporta la evidencia de la página y el Design System MCP el catálogo de componentes (Storybook es solo un preset). Ambos deben estar "ready" (en verde) para que la revisión tenga sentido.',
  llm: 'Endpoint OpenAI-compatible que redacta la interpretación en lenguaje natural. La API key se guarda en el cerebro local y nunca vuelve al panel. Es opcional: sin proveedor verás solo los hechos medidos por las reglas.',
  profiles:
    'Un perfil define qué checks se ejecutan, con qué tolerancias y con qué instrucciones AI. El Core System Prompt (evidencia, seguridad, matching y formato de salida) es fijo; solo las Advanced AI Instructions son editables.',
  report:
    'El checklist son hechos medidos por código (PASS/FAIL/REVIEW/NOT_EVALUATED). El % de match es una inferencia con su evidencia y la interpretación AI va marcada aparte: el modelo nunca puede cambiar un PASS/FAIL medido.'
} as const;

/**
 * Side Panel shell (DS-002/DS-028): tabbed layout with the review flow first, a real-state
 * pre-flight checklist and the settings. The panel only orchestrates: evidence, matching,
 * rules and the LLM run inside the Local Host.
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

  const [tab, setTab] = useState<TabId>('review');
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
  const llmReady = settings.providers.length > 0;
  const canReview =
    target !== undefined && snapshot.state === 'connected' && inspectionReady && !reviewing;

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

      {tab === 'review' ? (
        <>
          <section className="ds-card">
            <div className="ds-row">
              <h2>
                DesAIgnSync Start
                <Help text={HELP.host} />
              </h2>
              <span className={`ds-badge ds-badge--${snapshot.state}`}>{STATE_LABEL[snapshot.state]}</span>
            </div>
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
                Arranca el cerebro con <code>npm run host</code> y pega el pairing code que imprime.
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
            llmReady={llmReady}
            hasTarget={target !== undefined}
            hasReview={review !== undefined}
            onGoTo={setTab}
          />

          <section className="ds-card">
            <div className="ds-row">
              <h2>Elemento seleccionado</h2>
              <span className="ds-muted ds-inline">
                Perfil
                <Help text={HELP.profiles} />
              </span>
            </div>

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
              <p className="ds-muted">Sin selección todavía. Usa “Select element” y haz clic en la página.</p>
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
                className="ds-button ds-button--primary"
                type="button"
                disabled={!canReview}
                onClick={() => void handleReview()}
              >
                {reviewing ? 'Revisando...' : 'Revisar'}
              </button>
              {review ? (
                <button className="ds-button" type="button" onClick={resetReview}>
                  Limpiar
                </button>
              ) : null}
            </div>

            {!inspectionReady ? (
              <p className="ds-note">
                Necesitas Chrome DevTools MCP activo para obtener evidencia.{' '}
                <button className="ds-link" type="button" onClick={() => setTab('mcp')}>
                  Ir a MCP
                </button>
              </p>
            ) : null}

            <p className="ds-note">
              Read-only: la página nunca se modifica. La evidencia viene de Chrome DevTools MCP; el
              matching, las reglas y la interpretación AI corren en el cerebro local.
            </p>
            {pickError ? <p className="ds-note ds-badge--error">{pickError}</p> : null}
            {reviewError ? <p className="ds-note ds-badge--error">{reviewError}</p> : null}
          </section>

          {review ? (
            <section className="ds-card">
              <div className="ds-row">
                <h2>
                  Reporte
                  <Help text={HELP.report} />
                </h2>
                <span className="ds-muted">{review.durationMs} ms</span>
              </div>
              <ReviewView result={review} />
            </section>
          ) : null}

          <p className="ds-note ds-footnote">
            Próximo: reporte exportable (DS-020), page audit (DS-019), Ask AI (DS-021) y privacidad
            (DS-022).
          </p>
        </>
      ) : null}

      {tab === 'mcp' ? (
        <>
          <section className="ds-card">
            <div className="ds-row">
              <h2>
                Servidores conectados
                <Help text={HELP.mcp} />
              </h2>
            </div>
            {snapshot.servers.length === 0 ? (
              <p className="ds-muted">El cerebro no reporta servidores MCP.</p>
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
