import { describe, expect, it } from 'vitest';

import { LLM_PROVIDER_PRESETS, findLlmProviderPreset } from './llmPresets.js';

describe('LLM provider presets (DS-008 / DS-028: presets are optional)', () => {
  it('has a single entry per provider id', () => {
    const ids = LLM_PROVIDER_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('only the custom entry may ship an empty base URL', () => {
    const withoutUrl = LLM_PROVIDER_PRESETS.filter((preset) => preset.baseUrl === '');
    expect(withoutUrl.map((preset) => preset.id)).toEqual(['custom']);
  });

  it('uses http(s) base URLs that never embed credentials', () => {
    for (const preset of LLM_PROVIDER_PRESETS) {
      if (preset.baseUrl === '') continue;
      const url = new URL(preset.baseUrl);
      expect(['http:', 'https:']).toContain(url.protocol);
      expect(url.username).toBe('');
      expect(url.password).toBe('');
    }
  });

  it('prefills DeepSeek with the documented base URL and current models', () => {
    const deepseek = findLlmProviderPreset('deepseek');
    expect(deepseek?.baseUrl).toBe('https://api.deepseek.com');
    expect(deepseek?.suggestedModels).toEqual(['deepseek-flash', 'deepseek-v4-pro']);
    expect(deepseek?.visionMode).toBe('no');
  });

  it('never ships secrets or API keys inside a preset', () => {
    const serialized = JSON.stringify(LLM_PROVIDER_PRESETS);
    expect(serialized).not.toMatch(/api[-_]?key/i);
    expect(serialized).not.toMatch(/sk-[a-z0-9]/i);
  });

  it('returns undefined for unknown ids so the UI can fall back to custom', () => {
    expect(findLlmProviderPreset('does-not-exist')).toBeUndefined();
    expect(findLlmProviderPreset('custom')?.category).toBe('custom');
  });
});
