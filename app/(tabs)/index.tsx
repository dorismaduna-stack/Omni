import * as FileSystem from 'expo-file-system/legacy';
import * as LiveActivity from 'expo-live-activity';
import { useNetInfo } from '@react-native-community/netinfo';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { initLlama, type LlamaContext } from 'llama.rn';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { addCostEvent, getCostSummary, type CostSummary } from '@/lib/cost-tracker';
import {
  type CloudModelPreference,
  estimateCloudCostUsd,
  runHybridPrompt,
  type RoutingMode,
} from '@/lib/hybrid-ai';
import {
  DEFAULT_HYBRID_CONFIG,
  loadHybridSecureConfig,
  saveHybridSecureConfig,
} from '@/lib/secure-config';

const DEFAULT_MODEL_URL =
  'https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf?download=true';
const TEST_PROMPT = 'Say hello from Omni in one short sentence.';
const DEFAULT_HYBRID_PROMPT =
  'Research the latest Expo and React Native updates and give practical migration advice.';

const INITIAL_COST_SUMMARY: CostSummary = {
  totalCostUsd: 0,
  totalRequests: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
};

function formatUsd(value: number) {
  return `$${value.toFixed(4)}`;
}

export default function HomeScreen() {
  const netInfo = useNetInfo();

  const [modelUrl, setModelUrl] = useState(DEFAULT_MODEL_URL);
  const [modelStatus, setModelStatus] = useState('Not downloaded');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isLoadingModel, setIsLoadingModel] = useState(false);
  const [isRunningPrompt, setIsRunningPrompt] = useState(false);
  const [promptResult, setPromptResult] = useState('');
  const [liveActivityId, setLiveActivityId] = useState<string | null>(null);
  const [liveActivityStatus, setLiveActivityStatus] = useState('Not started');
  const [routingMode, setRoutingMode] = useState<RoutingMode>('auto');
  const [cloudModelPreference, setCloudModelPreference] = useState<CloudModelPreference>('auto');
  const [allowAutoModelSwitch, setAllowAutoModelSwitch] = useState(true);
  const [hybridPrompt, setHybridPrompt] = useState(DEFAULT_HYBRID_PROMPT);
  const [hybridStatus, setHybridStatus] = useState('Idle');
  const [hybridResponse, setHybridResponse] = useState('');
  const [hybridMeta, setHybridMeta] = useState('');
  const [hybridSources, setHybridSources] = useState<{ title: string; url: string }[]>([]);
  const [isRunningHybrid, setIsRunningHybrid] = useState(false);
  const [costSummary, setCostSummary] = useState(INITIAL_COST_SUMMARY);

  const [bedrockRegion, setBedrockRegion] = useState(DEFAULT_HYBRID_CONFIG.bedrockRegion);
  const [bedrockApiKey, setBedrockApiKey] = useState(DEFAULT_HYBRID_CONFIG.bedrockApiKey);
  const [bedrockClaudeModelId, setBedrockClaudeModelId] = useState(DEFAULT_HYBRID_CONFIG.bedrockClaudeModelId);
  const [bedrockPegasusModelId, setBedrockPegasusModelId] = useState(DEFAULT_HYBRID_CONFIG.bedrockPegasusModelId);
  const [bedrockGlmModelId, setBedrockGlmModelId] = useState(DEFAULT_HYBRID_CONFIG.bedrockGlmModelId);
  const [tavilyApiKey, setTavilyApiKey] = useState(DEFAULT_HYBRID_CONFIG.tavilyApiKey);

  const contextRef = useRef<LlamaContext | null>(null);
  const downloadRef = useRef<FileSystem.DownloadResumable | null>(null);

  const modelFilename = useMemo(() => {
    const cleanedUrl = modelUrl.trim().split('?')[0];
    const parts = cleanedUrl.split('/');
    const candidate = parts.at(-1) ?? 'qwen.gguf';
    return candidate.endsWith('.gguf') ? candidate : 'qwen.gguf';
  }, [modelUrl]);

  const modelDirectory = `${FileSystem.documentDirectory ?? ''}models/`;
  const modelFileUri = `${modelDirectory}${modelFilename}`;
  const isOnline = Boolean(netInfo.isConnected) && netInfo.isInternetReachable !== false;
  const cloudConfigured =
    bedrockRegion.trim().length > 0 &&
    bedrockApiKey.trim().length > 0 &&
    bedrockClaudeModelId.trim().length > 0 &&
    bedrockPegasusModelId.trim().length > 0 &&
    bedrockGlmModelId.trim().length > 0;

  useEffect(() => {
    const loadConfig = async () => {
      const loaded = await loadHybridSecureConfig();
      setBedrockRegion(loaded.bedrockRegion);
      setBedrockApiKey(loaded.bedrockApiKey);
      setBedrockClaudeModelId(loaded.bedrockClaudeModelId);
      setBedrockPegasusModelId(loaded.bedrockPegasusModelId);
      setBedrockGlmModelId(loaded.bedrockGlmModelId);
      setTavilyApiKey(loaded.tavilyApiKey);
    };
    const loadCosts = async () => {
      const summary = await getCostSummary();
      setCostSummary(summary);
    };
    void loadConfig();
    void loadCosts();
    return () => {
      void contextRef.current?.release();
      void downloadRef.current?.pauseAsync();
    };
  }, []);

  const ensureModelDirectory = async () => {
    if (!FileSystem.documentDirectory) {
      throw new Error('File system is not available on this platform.');
    }
    await FileSystem.makeDirectoryAsync(modelDirectory, { intermediates: true });
  };

  const checkModel = async () => {
    await ensureModelDirectory();
    const info = await FileSystem.getInfoAsync(modelFileUri);
    if (!info.exists) {
      setModelStatus('Not downloaded');
      return;
    }
    const mb = ((info.size ?? 0) / (1024 * 1024)).toFixed(0);
    setModelStatus(`Ready at ${modelFilename} (${mb} MB)`);
  };

  const downloadModel = async () => {
    try {
      setIsDownloading(true);
      setDownloadProgress(0);
      setModelStatus('Downloading...');
      await ensureModelDirectory();
      downloadRef.current = FileSystem.createDownloadResumable(
        modelUrl.trim(),
        modelFileUri,
        {},
        ({ totalBytesExpectedToWrite, totalBytesWritten }) => {
          if (!totalBytesExpectedToWrite) {
            return;
          }
          setDownloadProgress(totalBytesWritten / totalBytesExpectedToWrite);
        }
      );
      const result = await downloadRef.current.downloadAsync();
      if (!result?.uri) {
        setModelStatus('Download cancelled');
        return;
      }
      setModelStatus(`Downloaded to ${modelFilename}`);
      await checkModel();
    } catch (error) {
      setModelStatus(`Download failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsDownloading(false);
      downloadRef.current = null;
    }
  };

  const loadModel = async () => {
    try {
      setIsLoadingModel(true);
      await checkModel();
      const info = await FileSystem.getInfoAsync(modelFileUri);
      if (!info.exists) {
        setModelStatus('Download the model first');
        return;
      }
      await contextRef.current?.release();
      contextRef.current = await initLlama({
        model: modelFileUri,
        n_ctx: 4096,
        n_gpu_layers: 99,
        use_mmap: true,
      });
      setModelStatus(
        `Model loaded (${contextRef.current.gpu ? 'Metal GPU enabled' : contextRef.current.reasonNoGPU})`
      );
    } catch (error) {
      setModelStatus(`Load failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsLoadingModel(false);
    }
  };

  const runLocalPrompt = async (prompt: string) => {
    if (!contextRef.current) {
      throw new Error('Load the local model first.');
    }
    const result = await contextRef.current.completion({
      messages: [{ role: 'user', content: prompt }],
      n_predict: 512,
      temperature: 0.6,
    });
    return result.text.trim();
  };

  const runPrompt = async () => {
    try {
      setIsRunningPrompt(true);
      setPromptResult('');
      const text = await runLocalPrompt(TEST_PROMPT);
      setPromptResult(text);
    } catch (error) {
      setPromptResult(`Prompt failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsRunningPrompt(false);
    }
  };

  const saveCloudConfig = async () => {
    await saveHybridSecureConfig({
      bedrockRegion: bedrockRegion.trim(),
      bedrockApiKey: bedrockApiKey.trim(),
      bedrockClaudeModelId: bedrockClaudeModelId.trim(),
      bedrockPegasusModelId: bedrockPegasusModelId.trim(),
      bedrockGlmModelId: bedrockGlmModelId.trim(),
      tavilyApiKey: tavilyApiKey.trim(),
    });
    setHybridStatus('Cloud config saved on device');
  };

  const refreshCosts = async () => {
    const summary = await getCostSummary();
    setCostSummary(summary);
  };

  const runHybrid = async () => {
    try {
      setIsRunningHybrid(true);
      setHybridResponse('');
      setHybridSources([]);
      setHybridMeta('');
      setHybridStatus('Running hybrid router...');
      if ((routingMode === 'cloud' || routingMode === 'deep_research') && !isOnline) {
        setHybridStatus('Offline mode: switching to local only');
      }
      if ((routingMode === 'cloud' || routingMode === 'deep_research' || routingMode === 'auto') && !cloudConfigured && isOnline) {
        setHybridStatus('Cloud key/models are missing, local route only');
      }
      const result = await runHybridPrompt({
        prompt: hybridPrompt.trim(),
        mode: cloudConfigured ? routingMode : 'local',
        isOnline,
        localRunner: runLocalPrompt,
        cloudConfig: {
          region: bedrockRegion.trim(),
          apiKey: bedrockApiKey.trim(),
          modelIds: {
            claude: bedrockClaudeModelId.trim(),
            pegasus: bedrockPegasusModelId.trim(),
            glm: bedrockGlmModelId.trim(),
          },
        },
        modelPreference: cloudModelPreference,
        allowAutoModelSwitch,
        tavilyApiKey: tavilyApiKey.trim() || undefined,
      });
      setHybridResponse(result.response);
      setHybridStatus('Done');
      setHybridMeta(
        [
          `Route: ${result.route}`,
          `Complexity: ${result.complexity}`,
          result.modelId ? `Model: ${result.modelId}` : null,
          result.usage ? `Tokens: ${result.usage.inputTokens}/${result.usage.outputTokens}` : null,
        ]
          .filter(Boolean)
          .join(' | ')
      );
      if (result.sources?.length) {
        setHybridSources(result.sources.map((source) => ({ title: source.title, url: source.url })));
      }
      if (result.route === 'cloud' && result.usage && result.modelId) {
        const cost = estimateCloudCostUsd(result.usage);
        await addCostEvent({
          route: result.route,
          modelId: result.modelId,
          usdCost: cost,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
        });
        await refreshCosts();
      }
    } catch (error) {
      setHybridStatus(`Hybrid run failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsRunningHybrid(false);
    }
  };

  const startLiveActivity = () => {
    if (Platform.OS !== 'ios') {
      setLiveActivityStatus('Live Activities run only on iOS');
      return;
    }
    const id = LiveActivity.startActivity(
      {
        title: 'Omni setup',
        subtitle: 'Preparing local model',
        progressBar: { progress: 0.1 },
      },
      {
        deepLinkUrl: 'omni://',
      }
    );
    if (!id) {
      setLiveActivityStatus('Could not start live activity');
      return;
    }
    setLiveActivityId(id);
    setLiveActivityStatus(`Started: ${id}`);
  };

  const updateLiveActivity = () => {
    if (!liveActivityId) {
      setLiveActivityStatus('Start activity first');
      return;
    }
    LiveActivity.updateActivity(liveActivityId, {
      title: 'Omni setup',
      subtitle: 'Model loaded and testing',
      progressBar: { progress: 0.8 },
    });
    setLiveActivityStatus('Updated');
  };

  const stopLiveActivity = () => {
    if (!liveActivityId) {
      setLiveActivityStatus('Start activity first');
      return;
    }
    LiveActivity.stopActivity(liveActivityId, {
      title: 'Omni setup',
      subtitle: 'Done',
      progressBar: { progress: 1 },
    });
    setLiveActivityStatus('Stopped');
    setLiveActivityId(null);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ThemedText type="title">Omni Native Bring-Up</ThemedText>
      <ThemedText>Download a GGUF model, load it with llama.rn, and run a local prompt.</ThemedText>
      <ThemedText>{isOnline ? 'Online mode available' : 'Offline mode: local model only'}</ThemedText>

      <ThemedView style={styles.block}>
        <ThemedText type="subtitle">Model URL</ThemedText>
        <TextInput
          style={styles.input}
          value={modelUrl}
          onChangeText={setModelUrl}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
        />
        <ThemedText>{modelStatus}</ThemedText>
        {isDownloading ? (
          <View style={styles.progressRow}>
            <ActivityIndicator />
            <ThemedText>{`${Math.round(downloadProgress * 100)}%`}</ThemedText>
          </View>
        ) : null}
        <View style={styles.actionsRow}>
          <ActionButton label="Download Model" onPress={downloadModel} disabled={isDownloading} />
          <ActionButton label="Load Model" onPress={loadModel} disabled={isLoadingModel} />
          <ActionButton label="Run Test Prompt" onPress={runPrompt} disabled={isRunningPrompt} />
        </View>
        <ThemedText>{promptResult || 'No local prompt run yet.'}</ThemedText>
      </ThemedView>

      <ThemedView style={styles.block}>
        <ThemedText type="subtitle">Hybrid Router</ThemedText>
        <ThemedText>{hybridStatus}</ThemedText>
        <View style={styles.actionsRow}>
          <ActionButton label="Auto" onPress={() => setRoutingMode('auto')} active={routingMode === 'auto'} />
          <ActionButton label="Local" onPress={() => setRoutingMode('local')} active={routingMode === 'local'} />
          <ActionButton label="Cloud" onPress={() => setRoutingMode('cloud')} active={routingMode === 'cloud'} />
          <ActionButton
            label="Deep Research"
            onPress={() => setRoutingMode('deep_research')}
            active={routingMode === 'deep_research'}
            disabled={!isOnline}
          />
        </View>
        <View style={styles.actionsRow}>
          <ActionButton
            label="Auto Switch On"
            onPress={() => setAllowAutoModelSwitch(true)}
            active={allowAutoModelSwitch}
          />
          <ActionButton
            label="Auto Switch Off"
            onPress={() => setAllowAutoModelSwitch(false)}
            active={!allowAutoModelSwitch}
          />
        </View>
        <View style={styles.actionsRow}>
          <ActionButton
            label="Model Auto"
            onPress={() => setCloudModelPreference('auto')}
            active={cloudModelPreference === 'auto'}
          />
          <ActionButton
            label="Model Local"
            onPress={() => setCloudModelPreference('local')}
            active={cloudModelPreference === 'local'}
          />
          <ActionButton
            label="Claude Sonnet 4"
            onPress={() => setCloudModelPreference('claude')}
            active={cloudModelPreference === 'claude'}
          />
          <ActionButton
            label="Pegasus 1.2"
            onPress={() => setCloudModelPreference('pegasus')}
            active={cloudModelPreference === 'pegasus'}
          />
          <ActionButton
            label="GLM 4.7"
            onPress={() => setCloudModelPreference('glm')}
            active={cloudModelPreference === 'glm'}
          />
        </View>
        <TextInput
          style={styles.input}
          value={hybridPrompt}
          onChangeText={setHybridPrompt}
          autoCapitalize="sentences"
          autoCorrect
          multiline
        />
        <View style={styles.actionsRow}>
          <ActionButton
            label={isRunningHybrid ? 'Running...' : 'Run Hybrid Prompt'}
            onPress={runHybrid}
            disabled={isRunningHybrid || !hybridPrompt.trim().length}
          />
        </View>
        <ThemedText>{hybridMeta || 'No hybrid run yet.'}</ThemedText>
        <ThemedText>{hybridResponse || 'Response will appear here.'}</ThemedText>
        {hybridSources.length ? (
          <View style={styles.sourcesBlock}>
            {hybridSources.map((source, index) => (
              <ThemedText key={`${source.url}-${index}`}>
                {`${index + 1}. ${source.title}${source.url ? ` — ${source.url}` : ''}`}
              </ThemedText>
            ))}
          </View>
        ) : null}
      </ThemedView>

      <ThemedView style={styles.block}>
        <ThemedText type="subtitle">Cloud Config</ThemedText>
        <TextInput
          style={styles.singleLineInput}
          value={bedrockRegion}
          onChangeText={setBedrockRegion}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Bedrock region"
        />
        <TextInput
          style={styles.singleLineInput}
          value={bedrockApiKey}
          onChangeText={setBedrockApiKey}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          placeholder="Bedrock API key"
        />
        <TextInput
          style={styles.singleLineInput}
          value={bedrockClaudeModelId}
          onChangeText={setBedrockClaudeModelId}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Claude model ID"
        />
        <TextInput
          style={styles.singleLineInput}
          value={bedrockPegasusModelId}
          onChangeText={setBedrockPegasusModelId}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Pegasus model ID (video to text)"
        />
        <TextInput
          style={styles.singleLineInput}
          value={bedrockGlmModelId}
          onChangeText={setBedrockGlmModelId}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="GLM model ID"
        />
        <TextInput
          style={styles.singleLineInput}
          value={tavilyApiKey}
          onChangeText={setTavilyApiKey}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          placeholder="Tavily key for richer web search (optional)"
        />
        <View style={styles.actionsRow}>
          <ActionButton label="Save Cloud Config" onPress={saveCloudConfig} />
          <ActionButton
            label="Use Requested IDs"
            onPress={() => {
              setBedrockClaudeModelId('anthropic.claude-sonnet-4-20250514-v1:0');
              setBedrockPegasusModelId('twelvelabs.pegasus-1-2-v1:0');
              setBedrockGlmModelId('zai.glm-4.7');
            }}
          />
        </View>
      </ThemedView>

      <ThemedView style={styles.block}>
        <ThemedText type="subtitle">Cloud Cost Tracker</ThemedText>
        <ThemedText>{`Total spend: ${formatUsd(costSummary.totalCostUsd)}`}</ThemedText>
        <ThemedText>{`Requests: ${costSummary.totalRequests}`}</ThemedText>
        <ThemedText>{`Input tokens: ${costSummary.totalInputTokens}`}</ThemedText>
        <ThemedText>{`Output tokens: ${costSummary.totalOutputTokens}`}</ThemedText>
        <View style={styles.actionsRow}>
          <ActionButton label="Refresh Cost Summary" onPress={refreshCosts} />
        </View>
      </ThemedView>

      <ThemedView style={styles.block}>
        <ThemedText type="subtitle">Dynamic Island / Live Activity</ThemedText>
        <ThemedText>{liveActivityStatus}</ThemedText>
        <View style={styles.actionsRow}>
          <ActionButton label="Start Activity" onPress={startLiveActivity} />
          <ActionButton label="Update Activity" onPress={updateLiveActivity} />
          <ActionButton label="Stop Activity" onPress={stopLiveActivity} />
        </View>
      </ThemedView>
    </ScrollView>
  );
}

function ActionButton({
  label,
  onPress,
  disabled,
  active,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.button, active ? styles.buttonActive : null, disabled ? styles.buttonDisabled : null]}
      disabled={disabled}>
      <ThemedText style={styles.buttonLabel}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 12,
  },
  block: {
    gap: 10,
    borderRadius: 12,
    padding: 12,
  },
  input: {
    minHeight: 88,
    borderWidth: 1,
    borderColor: '#888',
    borderRadius: 8,
    padding: 10,
    color: '#111',
  },
  singleLineInput: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#888',
    borderRadius: 8,
    paddingHorizontal: 10,
    color: '#111',
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  button: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#0a7ea4',
  },
  buttonActive: {
    backgroundColor: '#155dfc',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonLabel: {
    color: '#fff',
  },
  sourcesBlock: {
    gap: 6,
  },
});
