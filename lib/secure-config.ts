import * as SecureStore from 'expo-secure-store';

export type HybridSecureConfig = {
  bedrockRegion: string;
  bedrockApiKey: string;
  bedrockClaudeModelId: string;
  bedrockPegasusModelId: string;
  bedrockGlmModelId: string;
  tavilyApiKey: string;
};

const STORAGE_KEY = 'omni.hybrid.secure-config.v1';

const ENV_DEFAULTS = {
  bedrockRegion: process.env.EXPO_PUBLIC_BEDROCK_REGION?.trim() || 'us-east-1',
  bedrockApiKey: process.env.EXPO_PUBLIC_BEDROCK_API_KEY?.trim() || '',
  bedrockClaudeModelId:
    process.env.EXPO_PUBLIC_BEDROCK_MODEL_ID_CLAUDE?.trim() || 'anthropic.claude-sonnet-4-20250514-v1:0',
  bedrockPegasusModelId:
    process.env.EXPO_PUBLIC_BEDROCK_MODEL_ID_PEGASUS?.trim() || 'twelvelabs.pegasus-1-2-v1:0',
  bedrockGlmModelId: process.env.EXPO_PUBLIC_BEDROCK_MODEL_ID_GLM?.trim() || 'zai.glm-4.7',
  tavilyApiKey: process.env.EXPO_PUBLIC_TAVILY_API_KEY?.trim() || '',
};

export const DEFAULT_HYBRID_CONFIG: HybridSecureConfig = {
  bedrockRegion: ENV_DEFAULTS.bedrockRegion,
  bedrockApiKey: ENV_DEFAULTS.bedrockApiKey,
  bedrockClaudeModelId: ENV_DEFAULTS.bedrockClaudeModelId,
  bedrockPegasusModelId: ENV_DEFAULTS.bedrockPegasusModelId,
  bedrockGlmModelId: ENV_DEFAULTS.bedrockGlmModelId,
  tavilyApiKey: ENV_DEFAULTS.tavilyApiKey,
};

export async function loadHybridSecureConfig(): Promise<HybridSecureConfig> {
  const stored = await SecureStore.getItemAsync(STORAGE_KEY);
  if (!stored) {
    return DEFAULT_HYBRID_CONFIG;
  }
  try {
    const parsed = JSON.parse(stored) as Partial<HybridSecureConfig>;
    const normalized = Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => typeof value !== 'string' || value.trim().length > 0)
    ) as Partial<HybridSecureConfig>;
    return {
      ...DEFAULT_HYBRID_CONFIG,
      ...normalized,
    };
  } catch {
    return DEFAULT_HYBRID_CONFIG;
  }
}

export async function saveHybridSecureConfig(config: HybridSecureConfig) {
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(config));
}
