import { useCallback, useEffect, useState } from 'react';

import type {
  LlmModelsResponse,
  LlmProvidersResponse,
  McpServerConfig,
  McpServerRuntimeStatus,
  ProfilesResponse,
  RemoveProfileResponse,
  SaveLlmProviderRequest,
  SaveProfileResponse,
  TestLlmProviderResponse,
  ValidationProfile
} from '@desaignsync/shared-types';

import { HostRequestError, LocalHostClient } from '../bridge/LocalHostClient.js';
import { getHostUrl, getSessionToken } from '../bridge/extensionStorage.js';

export type ProviderView = LlmProvidersResponse['providers'][number];
export type ProfileView = ProfilesResponse['profiles'][number];

export interface SettingsApi {
  providers: ProviderView[];
  profiles: ProfileView[];
  loading: boolean;
  busy: boolean;
  error?: string;
  notice?: string;
  refresh: () => Promise<void>;
  saveProvider: (input: SaveLlmProviderRequest) => Promise<ProviderView | undefined>;
  removeProvider: (providerId: string) => Promise<void>;
  testProvider: (providerId: string) => Promise<TestLlmProviderResponse>;
  fetchModels: (providerId: string) => Promise<LlmModelsResponse>;
  saveServer: (server: McpServerConfig, connect?: boolean) => Promise<McpServerRuntimeStatus | undefined>;
  removeServer: (serverId: string) => Promise<void>;
  saveProfile: (profile: ValidationProfile) => Promise<SaveProfileResponse>;
  removeProfile: (profileId: string) => Promise<RemoveProfileResponse>;
  clearFeedback: () => void;
}

/** Builds a short-lived client from the paired session; the panel never holds secrets itself. */
const withClient = async <T,>(action: (client: LocalHostClient) => Promise<T>): Promise<T> => {
  const [url, token] = await Promise.all([getHostUrl(), getSessionToken()]);
  if (!token) {
    throw new HostRequestError({
      code: 'UNAUTHORIZED',
      message: 'Pair with the Local Host first.',
      retryable: false,
      correlationId: 'settings-no-token'
    });
  }
  return action(new LocalHostClient({ baseUrl: url, token, timeoutMs: 120_000 }));
};

const messageOf = (error: unknown): string =>
  error instanceof HostRequestError
    ? `${error.code}: ${error.message}`
    : error instanceof Error
      ? error.message
      : 'Unexpected settings error.';

/**
 * Settings state for the Side Panel (DS-028): MCP servers, LLM providers and validation profiles.
 * Every mutation goes through the loopback API; the host persists it and owns the secrets.
 */
export function useSettings(enabled: boolean): SettingsApi {
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [profiles, setProfiles] = useState<ProfileView[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);

  const refresh = useCallback(async (): Promise<void> => {
    if (!enabled) return;
    setLoading(true);
    setError(undefined);
    try {
      const [providerList, profileList] = await withClient(async (client) => {
        const [currentProviders, currentProfiles] = await Promise.all([client.providers(), client.profiles()]);
        return [currentProviders, currentProfiles] as const;
      });
      setProviders(providerList.providers);
      setProfiles(profileList.profiles);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(
    async <T,>(action: () => Promise<T>, successNotice: string): Promise<T | undefined> => {
      setBusy(true);
      setError(undefined);
      setNotice(undefined);
      try {
        const value = await action();
        setNotice(successNotice);
        await refresh();
        return value;
      } catch (caught) {
        setError(messageOf(caught));
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [refresh]
  );

  return {
    providers,
    profiles,
    loading,
    busy,
    ...(error !== undefined ? { error } : {}),
    ...(notice !== undefined ? { notice } : {}),
    refresh,
    saveProvider: (input) =>
      run(async () => (await withClient((client) => client.saveProvider(input))).provider, 'Provider saved.'),
    removeProvider: async (providerId) => {
      await run(async () => {
        await withClient((client) => client.removeProvider(providerId));
      }, 'Provider removed.');
    },
    testProvider: (providerId) => withClient((client) => client.testProvider({ providerId })),
    fetchModels: (providerId) => withClient((client) => client.providerModels({ providerId })),
    saveServer: (server, connect = false) =>
      run(
        async () => (await withClient((client) => client.saveServer(server, connect))).status,
        connect ? 'Server saved; connecting...' : 'Server saved.'
      ),
    removeServer: async (serverId) => {
      await run(async () => {
        await withClient((client) => client.removeServer(serverId));
      }, 'Server removed.');
    },
    saveProfile: (profile) => withClient((client) => client.saveProfile(profile)),
    removeProfile: (profileId) => withClient((client) => client.removeProfile(profileId)),
    clearFeedback: () => {
      setError(undefined);
      setNotice(undefined);
    }
  };
}
