/**
 * @desaignsync/local-host
 * Public entry point of the Local MCP Host (loopback API + MCP client manager).
 */
export { startLocalHost, type StartedHost, type StartLocalHostOptions } from './host.js';
export { createHostServer, validateMcpServerConfig, type HostServer, type HostServerOptions } from './http/server.js';
export { EventBus } from './http/eventBus.js';
export {
  loadHostConfig,
  resolveConfigPath,
  resolveDataDir,
  HOST_VERSION,
  DEFAULT_PORT,
  LOOPBACK_HOST,
  type HostRuntimeConfig,
  type LoadHostConfigOptions,
  type LogLevel
} from './config/hostConfig.js';
export { createLogger, type Logger, type CreateLoggerOptions } from './logging/logger.js';
export { McpClientManager, toHostError, type McpManagerOptions } from './mcp/McpClientManager.js';
export { McpClient, type McpClientOptions, type McpToolCallResult } from './mcp/mcpClient.js';
export { JsonRpcPeer, JsonRpcTimeoutError, JsonRpcRemoteError } from './mcp/jsonRpc.js';
export { StdioMcpTransport, type StdioTransportOptions } from './mcp/transports/stdioTransport.js';
export {
  StreamableHttpMcpTransport,
  type HttpTransportOptions
} from './mcp/transports/httpTransport.js';
export { type McpTransport, TransportClosedError } from './mcp/transport.js';
export {
  getDefaultMcpPresets,
  createChromeDevToolsPreset,
  createStorybookDesignSystemPreset,
  CHROME_DEVTOOLS_PRESET_ID,
  STORYBOOK_DS_PRESET_ID
} from './mcp/presets.js';
export { SessionStore, generatePairingCode, type SessionRecord } from './security/sessionStore.js';
export { evaluateOrigin, type OriginPolicy, type OriginDecision } from './security/originPolicy.js';
export { redactString, redactUrl, redactValue, REDACTED } from './security/redaction.js';
export {
  createSecretStore,
  createEncryptedFileStore,
  createOsKeychainStore,
  assertSecretRef,
  type SecretStore,
  type SecretBackendKind
} from './security/secretStoreFactory.js';
export {
  LlmProviderAdapter,
  toHostErrorBody,
  type LlmCompleteRequest,
  type LlmCompletion,
  type LlmMessage,
  type LlmOperationResult,
  type LlmRuntimeOptions
} from './llm/llmProviderAdapter.js';