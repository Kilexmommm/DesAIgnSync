import { useState, type FormEvent } from 'react';

import {
  LLM_PROVIDER_PRESETS,
  DEFAULT_LLM_PROVIDER_PRESET_ID,
  findLlmProviderPreset,
  type McpServerConfig,
  type McpServerRuntimeStatus
} from '@desaignsync/shared-types';

import type { ProviderView, SettingsApi } from './useSettings.js';

export type SettingsSection = 'mcp' | 'llm' | 'profiles';

interface SettingsPanelProps {
  settings: SettingsApi;
  servers: McpServerRuntimeStatus[];
  busy: boolean;
  onTestServer: (serverId: string) => Promise<McpServerRuntimeStatus | undefined>;
  activeProfileId: string;
  onSelectProfile: (profileId: string) => void;
  /** Which block to render: the Side Panel puts each one in its own tab (DS-028). */
  section?: SettingsSection;
}

/**
 * Unified settings screen (DS-028): MCP servers, LLM providers and validation profiles.
 * Every field is sent to the Local Host; API keys are write-only from the panel's point of view.
 */
export function SettingsPanel({
  settings,
  servers,
  busy,
  onTestServer,
  activeProfileId,
  onSelectProfile,
  section = 'mcp'
}: SettingsPanelProps): React.JSX.Element {
  return (
    <div className="ds-settings">
      {section === 'mcp' ? (
        <ServerSettings settings={settings} servers={servers} busy={busy} onTestServer={onTestServer} />
      ) : null}
      {section === 'llm' ? <ProviderSettings settings={settings} /> : null}
      {section === 'profiles' ? (
        <ProfileSettings settings={settings} activeProfileId={activeProfileId} onSelectProfile={onSelectProfile} />
      ) : null}
      {settings.error ? <p className="ds-note ds-badge--error">{settings.error}</p> : null}
      {settings.notice ? <p className="ds-note">{settings.notice}</p> : null}
    </div>
  );
}

interface ServerSettingsProps {
  settings: SettingsApi;
  servers: McpServerRuntimeStatus[];
  busy: boolean;
  onTestServer: (serverId: string) => Promise<McpServerRuntimeStatus | undefined>;
}

const slugify = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

function ServerSettings({ settings, servers, busy, onTestServer }: ServerSettingsProps): React.JSX.Element {
  const [name, setName] = useState('');
  const [transport, setTransport] = useState<McpServerConfig['transport']>('stdio');
  const [command, setCommand] = useState('npx');
  const [args, setArgs] = useState('-y @scope/design-system-mcp@latest');
  const [url, setUrl] = useState('http://localhost:6006/mcp');
  const [role, setRole] = useState<McpServerConfig['role']>('design-system-reference');
  const [autoStart, setAutoStart] = useState(false);
  const [probe, setProbe] = useState<Record<string, string | undefined>>({});

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const id = slugify(name);
    if (id === '') return;
    const config: McpServerConfig = {
      id,
      name: name.trim(),
      transport,
      role,
      enabled: true,
      autoStart,
      ...(transport === 'stdio'
        ? { command: command.trim(), args: args.trim() === '' ? [] : args.trim().split(/\s+/) }
        : { url: url.trim() })
    };
    const status = await settings.saveServer(config, true);
    setProbe({ ...probe, [id]: status?.state === 'ready' ? `Connected · ${status.tools?.length ?? 0} tools` : (status?.lastError?.message ?? 'Saved') });
  };

  return (
    <div className="ds-subsection">
      <h3>
        MCP servers
        <span
          className="ds-help"
          role="note"
          title="Herramientas externas que usa el cerebro local. Chrome DevTools MCP aporta la evidencia de la página auditada; el Design System MCP aporta el catálogo de componentes (Storybook es solo un preset). Deben quedar en verde (ready)."
        >
          ?
        </span>
      </h3>
      <ul className="ds-list">
        {servers.map((server) => (
          <li key={server.serverId} className="ds-check">
            <div className="ds-row">
              <span>
                <strong>{server.name}</strong>
                <br />
                <span className="ds-muted">
                  {server.transport} · {server.tools?.length ?? 0} tools · {server.role}
                </span>
              </span>
              <span>
                <span className={`ds-badge ds-badge--${server.state}`}>{server.state}</span>{' '}
                <button className="ds-button" type="button" disabled={busy} onClick={() => void onTestServer(server.serverId)}>
                  Test
                </button>{' '}
                <button className="ds-button" type="button" disabled={busy} onClick={() => void settings.removeServer(server.serverId)}>
                  Remove
                </button>
              </span>
            </div>
            {probe[server.serverId] ? <div className="ds-muted ds-check-detail">{probe[server.serverId]}</div> : null}
          </li>
        ))}
      </ul>

      <form className="ds-form ds-form--grid" onSubmit={(event) => void submit(event)}>
        <input className="ds-input" aria-label="Server name" placeholder="Server name" value={name} onChange={(event) => setName(event.target.value)} />
        <select className="ds-input" aria-label="Transport" value={transport} onChange={(event) => setTransport(event.target.value as McpServerConfig['transport'])}>
          <option value="stdio">stdio</option>
          <option value="streamable-http">streamable-http</option>
        </select>
        {transport === 'stdio' ? (
          <>
            <input className="ds-input" aria-label="Command" placeholder="command" value={command} onChange={(event) => setCommand(event.target.value)} />
            <input className="ds-input" aria-label="Arguments" placeholder="arguments" value={args} onChange={(event) => setArgs(event.target.value)} />
          </>
        ) : (
          <input className="ds-input" aria-label="MCP URL" placeholder="http://localhost:6006/mcp" value={url} onChange={(event) => setUrl(event.target.value)} />
        )}
        <select className="ds-input" aria-label="Role" value={role} onChange={(event) => setRole(event.target.value as McpServerConfig['role'])}>
          <option value="inspection">inspection</option>
          <option value="design-system-reference">design-system-reference</option>
          <option value="generic">generic</option>
        </select>
        <label className="ds-muted ds-inline">
          <input type="checkbox" checked={autoStart} onChange={(event) => setAutoStart(event.target.checked)} /> auto start
        </label>
        <button className="ds-button" type="submit" disabled={busy || name.trim() === ''}>
          Save &amp; connect
        </button>
      </form>
    </div>
  );
}

function ProviderSettings({ settings }: { settings: SettingsApi }): React.JSX.Element {
  // The form starts from the recommended preset, but every value stays editable (DS-028).
  const initialPreset = findLlmProviderPreset(DEFAULT_LLM_PROVIDER_PRESET_ID);
  const [presetId, setPresetId] = useState(initialPreset?.id ?? 'custom');
  const [name, setName] = useState(initialPreset?.label ?? '');
  const [baseUrl, setBaseUrl] = useState(initialPreset?.baseUrl ?? 'http://127.0.0.1:1234/v1');
  const [apiKey, setApiKey] = useState('');
  const [modelsText, setModelsText] = useState((initialPreset?.suggestedModels ?? []).join(', '));
  const [selectedModel, setSelectedModel] = useState(initialPreset?.suggestedModels[0] ?? '');
  const [visionMode, setVisionMode] = useState<'auto' | 'yes' | 'no'>('auto');
  const [fetched, setFetched] = useState<Record<string, string[] | undefined>>({});
  const [probe, setProbe] = useState<Record<string, string | undefined>>({});
  const [manual, setManual] = useState<Record<string, string>>({});

  const vision = (value: string): 'auto' | 'yes' | 'no' =>
    value === 'yes' || value === 'no' ? value : 'auto';

  const activePreset = findLlmProviderPreset(presetId);
  const presetHint = activePreset
    ? [activePreset.hint, activePreset.docsUrl].filter((part): part is string => part !== undefined).join(' · ')
    : undefined;

  /** A preset only prefills fields: the user can still override every value afterwards. */
  const applyPreset = (id: string): void => {
    setPresetId(id);
    const preset = findLlmProviderPreset(id);
    if (!preset) return;
    if (preset.baseUrl !== '') setBaseUrl(preset.baseUrl);
    if (preset.suggestedModels.length > 0) {
      setModelsText(preset.suggestedModels.join(', '));
      setSelectedModel(preset.suggestedModels[0] ?? '');
    }
    if (preset.category !== 'custom') setName(preset.label);
    setVisionMode(preset.visionMode);
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const modelIds = modelsText
      .split(',')
      .map((model) => model.trim())
      .filter((model) => model !== '');
    const selected = selectedModel.trim() !== '' ? selectedModel.trim() : modelIds[0];
    await settings.saveProvider({
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      ...(apiKey.trim() !== '' ? { apiKey } : {}),
      modelIds,
      ...(selected !== undefined ? { selectedModel: selected } : {}),
      visionMode
    });
    setApiKey('');
  };

  const selectModel = async (provider: ProviderView, model: string): Promise<void> => {
    if (model.trim() === '') return;
    await settings.saveProvider({
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      modelIds: Array.from(new Set([...provider.modelIds, model.trim()])),
      selectedModel: model.trim(),
      visionMode: vision(provider.visionMode)
    });
  };

  const runProbe = async (provider: ProviderView): Promise<void> => {
    const result = await settings.testProvider(provider.id);
    setProbe({
      ...probe,
      [provider.id]: result.ok
        ? `Connected · ${result.model ?? 'model'}${result.latencyMs !== undefined ? ` · ${result.latencyMs} ms` : ''}`
        : `${result.error?.code ?? 'error'}: ${result.error?.message ?? 'failed'}`
    });
  };

  const runFetch = async (provider: ProviderView): Promise<void> => {
    const result = await settings.fetchModels(provider.id);
    if (result.ok) {
      setFetched({ ...fetched, [provider.id]: result.models });
      setProbe({ ...probe, [provider.id]: `${result.models.length} model(s) detected` });
      return;
    }
    setFetched({ ...fetched, [provider.id]: undefined });
    setProbe({
      ...probe,
      [provider.id]: `${result.error?.code ?? 'error'}: /models is not available — add the model manually`
    });
  };

  return (
    <div className="ds-subsection">
      <h3>
        LLM providers
        <span
          className="ds-help"
          role="note"
          title="Endpoint OpenAI-compatible que redacta la interpretación. La API key viaja al cerebro local y se guarda en el credential store del sistema; el panel no la vuelve a ver. Es opcional: sin proveedor solo verás los hechos medidos."
        >
          ?
        </span>
      </h3>
      <ul className="ds-list">
        {settings.providers.map((provider) => (
          <li key={provider.id} className="ds-check">
            <div className="ds-row">
              <span>
                <strong>{provider.name}</strong>
                <br />
                <span className="ds-muted">
                  {provider.baseUrl} · {provider.selectedModel ?? 'no model'} · vision {provider.visionMode}
                  {provider.hasApiKeyRef ? ' · key stored' : ''}
                </span>
              </span>
              <span>
                <button className="ds-button" type="button" disabled={settings.busy} onClick={() => void runFetch(provider)}>
                  Fetch models
                </button>{' '}
                <button className="ds-button" type="button" disabled={settings.busy} onClick={() => void runProbe(provider)}>
                  Test
                </button>{' '}
                <button className="ds-button" type="button" disabled={settings.busy} onClick={() => void settings.removeProvider(provider.id)}>
                  Remove
                </button>
              </span>
            </div>
            {probe[provider.id] ? <div className="ds-muted ds-check-detail">{probe[provider.id]}</div> : null}
            {fetched[provider.id]?.map((model) => (
              <button key={model} className="ds-button ds-button--chip" type="button" onClick={() => void selectModel(provider, model)}>
                use {model}
              </button>
            ))}
            <div className="ds-form">
              <input
                className="ds-input"
                aria-label={`Manual model for ${provider.name}`}
                placeholder="Add model manually"
                value={manual[provider.id] ?? ''}
                onChange={(event) => setManual({ ...manual, [provider.id]: event.target.value })}
              />
              <button className="ds-button" type="button" onClick={() => void selectModel(provider, manual[provider.id] ?? '')}>
                Add
              </button>
            </div>
          </li>
        ))}
      </ul>

      <form className="ds-form ds-form--grid" onSubmit={(event) => void submit(event)}>
        <select
          className="ds-input ds-field-full"
          aria-label="Provider preset"
          value={presetId}
          onChange={(event) => applyPreset(event.target.value)}
        >
          {LLM_PROVIDER_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </select>
        {presetHint !== undefined ? <p className="ds-note ds-field-full">{presetHint}</p> : null}
        <input className="ds-input" aria-label="Provider name" placeholder="Provider name" value={name} onChange={(event) => setName(event.target.value)} />
        <input className="ds-input" aria-label="Base URL" placeholder="https://api.example.com/v1" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
        <input
          className="ds-input"
          type="password"
          aria-label="API key"
          placeholder="API key (stored in the host)"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
        />
        <input className="ds-input" aria-label="Model IDs" placeholder="model-a, model-b" value={modelsText} onChange={(event) => setModelsText(event.target.value)} />
        <input className="ds-input" aria-label="Selected model" placeholder="selected model" value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)} />
        <select className="ds-input" aria-label="Vision" value={visionMode} onChange={(event) => setVisionMode(event.target.value as 'auto' | 'yes' | 'no')}>
          <option value="auto">vision: auto</option>
          <option value="yes">vision: yes</option>
          <option value="no">vision: no</option>
        </select>
        <button className="ds-button" type="submit" disabled={settings.busy || name.trim() === '' || baseUrl.trim() === ''}>
          Save provider
        </button>
      </form>
    </div>
  );
}

interface ProfileSettingsProps {
  settings: SettingsApi;
  activeProfileId: string;
  onSelectProfile: (profileId: string) => void;
}

function ProfileSettings({ settings, activeProfileId, onSelectProfile }: ProfileSettingsProps): React.JSX.Element {
  return (
    <div className="ds-subsection">
      <h3>
        Validation profiles
        <span
          className="ds-help"
          role="note"
          title="Un perfil define los checks, las tolerancias y las instrucciones AI. El Core System Prompt (evidencia, seguridad, matching, formato de salida) es fijo; solo las Advanced AI Instructions se pueden editar."
        >
          ?
        </span>
      </h3>
      <p className="ds-note">
        Un perfil agrupa los <strong>checks</strong>, las <strong>tolerancias</strong> y las{' '}
        <strong>instrucciones AI</strong> con las que se revisa. El <strong>Core System Prompt</strong> (evidencia,
        seguridad, matching, formato de salida) es fijo y no se edita desde aquí; solo se pueden personalizar las
        Advanced AI Instructions del perfil.
      </p>
      <ul className="ds-list">
        {settings.profiles.map((profile) => (
          <li key={profile.id} className="ds-row">
            <span>
              <label className="ds-inline">
                <input
                  type="radio"
                  name="ds-active-profile"
                  checked={activeProfileId === profile.id}
                  onChange={() => onSelectProfile(profile.id)}
                />{' '}
                <strong>{profile.name}</strong>
              </label>
              <br />
              <span className="ds-muted">
                {profile.tier} · {profile.enabledCheckCount} checks · min {Math.round(profile.minConfidence * 100)}% ·
                top {profile.maxCandidates}
                {profile.isBuiltIn === true ? ' · built-in' : ''}
              </span>
            </span>
            <span>
              {profile.isBuiltIn === true ? null : (
                <button
                  className="ds-button"
                  type="button"
                  disabled={settings.busy}
                  onClick={() => void settings.removeProfile(profile.id)}
                >
                  Remove
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
