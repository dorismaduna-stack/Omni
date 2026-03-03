export type RoutingMode = 'auto' | 'local' | 'cloud' | 'deep_research';
export type CloudModelPreference = 'auto' | 'local' | 'claude' | 'pegasus' | 'glm';

export type BedrockConfig = {
  region: string;
  apiKey: string;
  modelIds: {
    claude: string;
    pegasus: string;
    glm: string;
  };
};

export type SearchResult = {
  title: string;
  snippet: string;
  url: string;
};

export type CloudUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type CloudResponse = {
  text: string;
  usage: CloudUsage;
  modelId: string;
};

export type HybridRunResult = {
  route: 'local' | 'cloud';
  response: string;
  complexity: 'low' | 'high';
  usage?: CloudUsage;
  modelId?: string;
  sources?: SearchResult[];
};

type LocalRunner = (prompt: string) => Promise<string>;

const HIGH_COMPLEXITY_HINTS = [
  'deep research',
  'research',
  'analyze',
  'compare',
  'architecture',
  'tradeoff',
  'citations',
  'sources',
  'step by step',
  'plan',
  'investigate',
  'latest',
  'news',
];

const CLOUD_INPUT_PRICE_PER_1K = 0.003;
const CLOUD_OUTPUT_PRICE_PER_1K = 0.015;
const VIDEO_HINTS = ['video', 'clip', 'subtitle', 'transcript', 'transcribe', 'frame', 'scene'];
const CODE_HINTS = ['code', 'bug', 'refactor', 'typescript', 'javascript', 'react', 'expo', 'api'];

export function estimatePromptComplexity(prompt: string): 'low' | 'high' {
  const normalized = prompt.toLowerCase();
  const hasHint = HIGH_COMPLEXITY_HINTS.some((hint) => normalized.includes(hint));
  const longPrompt = normalized.length > 260;
  return hasHint || longPrompt ? 'high' : 'low';
}

export function estimateCloudCostUsd(usage: CloudUsage) {
  const inputCost = (usage.inputTokens / 1000) * CLOUD_INPUT_PRICE_PER_1K;
  const outputCost = (usage.outputTokens / 1000) * CLOUD_OUTPUT_PRICE_PER_1K;
  return Number((inputCost + outputCost).toFixed(6));
}

export function shouldUseCloud({
  mode,
  prompt,
  isOnline,
}: {
  mode: RoutingMode;
  prompt: string;
  isOnline: boolean;
}) {
  if (!isOnline) {
    return false;
  }
  if (mode === 'cloud' || mode === 'deep_research') {
    return true;
  }
  if (mode === 'local') {
    return false;
  }
  return estimatePromptComplexity(prompt) === 'high';
}

function selectCloudModelType(prompt: string): 'claude' | 'pegasus' | 'glm' {
  const normalized = prompt.toLowerCase();
  if (VIDEO_HINTS.some((hint) => normalized.includes(hint))) {
    return 'pegasus';
  }
  if (CODE_HINTS.some((hint) => normalized.includes(hint))) {
    return 'glm';
  }
  return 'claude';
}

function resolveModelId({
  prompt,
  preference,
  allowAutoModelSwitch,
  modelIds,
}: {
  prompt: string;
  preference: CloudModelPreference;
  allowAutoModelSwitch: boolean;
  modelIds: BedrockConfig['modelIds'];
}) {
  if (preference === 'local') {
    return { modelId: '', modelType: 'local' as const };
  }
  if (preference === 'claude' || preference === 'pegasus' || preference === 'glm') {
    return { modelId: modelIds[preference], modelType: preference };
  }
  if (allowAutoModelSwitch) {
    const autoType = selectCloudModelType(prompt);
    return { modelId: modelIds[autoType], modelType: autoType };
  }
  return { modelId: modelIds.claude, modelType: 'claude' as const };
}

function extractBedrockText(output: unknown): string {
  const message = (output as { output?: { message?: { content?: { text?: string }[] } } })?.output?.message;
  const blocks = message?.content ?? [];
  return blocks
    .map((block) => block?.text ?? '')
    .join('\n')
    .trim();
}

export async function runBedrockPrompt({
  config,
  prompt,
  modelId,
}: {
  config: BedrockConfig;
  prompt: string;
  modelId: string;
}): Promise<CloudResponse> {
  const endpoint = `https://bedrock-runtime.${config.region}.amazonaws.com/model/${encodeURIComponent(modelId)}/converse`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'x-api-key': config.apiKey,
    },
    body: JSON.stringify({
      messages: [
        {
          role: 'user',
          content: [{ text: prompt }],
        },
      ],
      inferenceConfig: {
        temperature: 0.6,
        maxTokens: 2048,
      },
    }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Bedrock request failed (${response.status}): ${errorText}`);
  }
  const payload = (await response.json()) as {
    output?: { message?: { content?: { text?: string }[] } };
    usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  };
  const text = extractBedrockText(payload);
  const usage = {
    inputTokens: payload.usage?.inputTokens ?? 0,
    outputTokens: payload.usage?.outputTokens ?? 0,
    totalTokens: payload.usage?.totalTokens ?? 0,
  };
  return {
    text,
    usage,
    modelId,
  };
}

export async function runWebSearch({
  query,
  tavilyApiKey,
}: {
  query: string;
  tavilyApiKey?: string;
}): Promise<SearchResult[]> {
  if (tavilyApiKey) {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: tavilyApiKey,
        query,
        max_results: 5,
      }),
    });
    if (response.ok) {
      const payload = (await response.json()) as {
        results?: { title?: string; content?: string; url?: string }[];
      };
      return (payload.results ?? []).map((item, index) => ({
        title: item.title?.trim() || `Result ${index + 1}`,
        snippet: item.content?.trim() || '',
        url: item.url?.trim() || '',
      }));
    }
  }

  const fallback = await fetch(
    `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
  );
  const data = (await fallback.json()) as {
    Heading?: string;
    AbstractText?: string;
    AbstractURL?: string;
    RelatedTopics?: { Text?: string; FirstURL?: string; Topics?: { Text?: string; FirstURL?: string }[] }[];
  };

  const top: SearchResult[] = [];
  if (data.AbstractText) {
    top.push({
      title: data.Heading?.trim() || 'Summary',
      snippet: data.AbstractText.trim(),
      url: data.AbstractURL?.trim() || '',
    });
  }

  for (const topic of data.RelatedTopics ?? []) {
    if (Array.isArray(topic.Topics)) {
      for (const nested of topic.Topics ?? []) {
        if (!nested.Text) {
          continue;
        }
        top.push({
          title: nested.Text.slice(0, 72),
          snippet: nested.Text,
          url: nested.FirstURL?.trim() || '',
        });
      }
    } else if (topic.Text) {
      top.push({
        title: topic.Text.slice(0, 72),
        snippet: topic.Text,
        url: topic.FirstURL?.trim() || '',
      });
    }
    if (top.length >= 5) {
      break;
    }
  }
  return top.slice(0, 5);
}

export function buildResearchQueries(prompt: string) {
  return [
    prompt,
    `${prompt} latest updates`,
    `${prompt} best practices`,
  ];
}

export async function runDeepResearch({
  prompt,
  tavilyApiKey,
  cloudConfig,
  modelId,
}: {
  prompt: string;
  tavilyApiKey?: string;
  cloudConfig: BedrockConfig;
  modelId: string;
}) {
  const researchQueries = buildResearchQueries(prompt);
  const groupedSources = await Promise.all(
    researchQueries.map(async (query) => runWebSearch({ query, tavilyApiKey }))
  );
  const sources = groupedSources.flat().slice(0, 10);
  const contextBlock = sources
    .map(
      (source, index) =>
        `[${index + 1}] ${source.title}\nURL: ${source.url || 'n/a'}\nSummary: ${source.snippet}`
    )
    .join('\n\n');
  const researchPrompt = [
    'You are Omni research mode.',
    'Create a focused answer with clear sections and practical recommendations.',
    'Cite sources inline like [1], [2].',
    `User question: ${prompt}`,
    `Web results:\n${contextBlock}`,
  ].join('\n\n');
  const response = await runBedrockPrompt({ config: cloudConfig, prompt: researchPrompt, modelId });
  return { response, sources };
}

export async function runHybridPrompt({
  prompt,
  mode,
  isOnline,
  localRunner,
  cloudConfig,
  modelPreference,
  allowAutoModelSwitch,
  tavilyApiKey,
}: {
  prompt: string;
  mode: RoutingMode;
  isOnline: boolean;
  localRunner: LocalRunner;
  cloudConfig: BedrockConfig;
  modelPreference: CloudModelPreference;
  allowAutoModelSwitch: boolean;
  tavilyApiKey?: string;
}): Promise<HybridRunResult> {
  const complexity = estimatePromptComplexity(prompt);
  const resolvedModel = resolveModelId({
    prompt,
    preference: mode === 'deep_research' ? 'claude' : modelPreference,
    allowAutoModelSwitch,
    modelIds: cloudConfig.modelIds,
  });
  if (resolvedModel.modelType === 'local') {
    const local = await localRunner(prompt);
    return {
      route: 'local',
      response: local,
      complexity,
    };
  }
  if (mode === 'deep_research' && isOnline) {
    const deepResearchResult = await runDeepResearch({
      prompt,
      tavilyApiKey,
      cloudConfig,
      modelId: cloudConfig.modelIds.claude,
    });
    return {
      route: 'cloud',
      response: deepResearchResult.response.text,
      complexity: 'high',
      usage: deepResearchResult.response.usage,
      modelId: deepResearchResult.response.modelId,
      sources: deepResearchResult.sources,
    };
  }

  if (shouldUseCloud({ mode, prompt, isOnline })) {
    const cloud = await runBedrockPrompt({
      config: cloudConfig,
      prompt,
      modelId: resolvedModel.modelId,
    });
    return {
      route: 'cloud',
      response: cloud.text,
      complexity,
      usage: cloud.usage,
      modelId: cloud.modelId,
    };
  }

  const local = await localRunner(prompt);
  return {
    route: 'local',
    response: local,
    complexity,
  };
}
