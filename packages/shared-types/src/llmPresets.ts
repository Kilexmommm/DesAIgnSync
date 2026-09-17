/**
 * Optional starting points for the LLM provider form (DS-008 / DS-028).
 *
 * A preset only PRE-FILLS the Base URL, suggested model IDs and the vision hint.
 * Every field stays editable and `custom` lets the user configure any other
 * OpenAI-compatible endpoint by hand: presets are a convenience, never a requirement
 * (spec v2.1 §8: "Manual models" is mandatory, "Fetch models" is optional).
 *
 * `suggestedModels` is intentionally empty for most providers: model names change far
 * faster than base URLs, so the UI offers "Fetch models" and manual entry instead of
 * shipping stale names.
 */

export type LlmProviderPresetCategory = 'cloud' | 'local' | 'custom';

export interface LlmProviderPreset {
  id: string;
  label: string;
  category: LlmProviderPresetCategory;
  /** Empty only for the `custom` entry: the user must type it. */
  baseUrl: string;
  /** Prefilled model IDs. Empty means "use Fetch models or type it manually". */
  suggestedModels: readonly string[];
  /** Starting hint for the vision setting, not a guarantee for every model of the provider. */
  visionMode: 'auto' | 'yes' | 'no';
  /** Shown next to the form to explain what the preset does (or does not) fill. */
  hint?: string;
  docsUrl?: string;
}

export const LLM_PROVIDER_PRESETS: readonly LlmProviderPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    category: 'cloud',
    baseUrl: 'https://api.deepseek.com',
    suggestedModels: ['deepseek-flash', 'deepseek-v4-pro'],
    visionMode: 'no',
    hint: 'API OpenAI-compatible. Requiere saldo positivo en la cuenta.',
    docsUrl: 'https://api-docs.deepseek.com'
  },
  {
    id: 'openai',
    label: 'OpenAI',
    category: 'cloud',
    baseUrl: 'https://api.openai.com/v1',
    suggestedModels: [],
    visionMode: 'auto',
    docsUrl: 'https://platform.openai.com/docs'
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    category: 'cloud',
    baseUrl: 'https://openrouter.ai/api/v1',
    suggestedModels: [],
    visionMode: 'auto',
    docsUrl: 'https://openrouter.ai/docs'
  },
  {
    id: 'groq',
    label: 'Groq',
    category: 'cloud',
    baseUrl: 'https://api.groq.com/openai/v1',
    suggestedModels: [],
    visionMode: 'auto',
    docsUrl: 'https://console.groq.com/docs'
  },
  {
    id: 'mistral',
    label: 'Mistral',
    category: 'cloud',
    baseUrl: 'https://api.mistral.ai/v1',
    suggestedModels: [],
    visionMode: 'auto',
    docsUrl: 'https://docs.mistral.ai'
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    category: 'cloud',
    baseUrl: 'https://api.x.ai/v1',
    suggestedModels: [],
    visionMode: 'auto',
    docsUrl: 'https://docs.x.ai'
  },
  {
    id: 'gemini-openai',
    label: 'Google Gemini (OpenAI compat)',
    category: 'cloud',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    suggestedModels: [],
    visionMode: 'auto',
    docsUrl: 'https://ai.google.dev/gemini-api/docs/openai'
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    category: 'local',
    baseUrl: 'http://localhost:11434/v1',
    suggestedModels: [],
    visionMode: 'auto',
    hint: 'Necesita el servidor de Ollama en marcha; pulsa Fetch models para ver los descargados.'
  },
  {
    id: 'lmstudio',
    label: 'LM Studio (local)',
    category: 'local',
    baseUrl: 'http://localhost:1234/v1',
    suggestedModels: [],
    visionMode: 'auto',
    hint: 'Activa el servidor local en LM Studio antes de probar la conexión.'
  },
  {
    id: 'vllm',
    label: 'vLLM (local)',
    category: 'local',
    baseUrl: 'http://localhost:8000/v1',
    suggestedModels: [],
    visionMode: 'auto'
  },
  {
    id: 'llamacpp',
    label: 'llama.cpp server (local)',
    category: 'local',
    baseUrl: 'http://localhost:8080/v1',
    suggestedModels: [],
    visionMode: 'auto'
  },
  {
    id: 'custom',
    label: 'Custom / otro proveedor',
    category: 'custom',
    baseUrl: '',
    suggestedModels: [],
    visionMode: 'auto',
    hint: 'Escribe la Base URL y los modelos a mano: cualquier endpoint OpenAI-compatible vale.'
  }
];

export const DEFAULT_LLM_PROVIDER_PRESET_ID = 'deepseek';

export const findLlmProviderPreset = (id: string): LlmProviderPreset | undefined =>
  LLM_PROVIDER_PRESETS.find((preset) => preset.id === id);
