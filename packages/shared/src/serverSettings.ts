import {
  DEFAULT_MODEL_BY_PROVIDER,
  type ModelSelection,
  type ProviderStartOptions,
  type ServerSettings,
  type ServerSettingsPatch,
} from "@synara/contracts";
import { deepMerge, type DeepPartial } from "./Struct";

function shouldReplaceTextGenerationModelSelection(
  patch: ServerSettingsPatch["textGenerationModelSelection"] | undefined,
): boolean {
  return Boolean(patch && (patch.provider !== undefined || patch.model !== undefined));
}

export function applyServerSettingsPatch(
  current: ServerSettings,
  patch: ServerSettingsPatch,
): ServerSettings {
  const selectionPatch = patch.textGenerationModelSelection;
  const next = deepMerge(current, patch as DeepPartial<ServerSettings>);
  if (!selectionPatch) {
    return next;
  }

  const provider = selectionPatch.provider ?? current.textGenerationModelSelection.provider;
  const model =
    selectionPatch.model ??
    (selectionPatch.provider &&
    selectionPatch.provider !== "pi" &&
    selectionPatch.provider !== current.textGenerationModelSelection.provider
      ? DEFAULT_MODEL_BY_PROVIDER[selectionPatch.provider]
      : current.textGenerationModelSelection.model);
  const options = shouldReplaceTextGenerationModelSelection(selectionPatch)
    ? selectionPatch.options
    : (selectionPatch.options ?? current.textGenerationModelSelection.options);

  return {
    ...next,
    textGenerationModelSelection: {
      provider,
      model,
      ...(options !== undefined ? { options } : {}),
    } as ModelSelection,
  };
}

/** Server-owned launch options derived from the persisted non-secret settings snapshot. */
export function providerStartOptionsFromServerSettings(
  settings: ServerSettings,
): ProviderStartOptions {
  const { providers } = settings;
  return {
    codex: {
      binaryPath: providers.codex.binaryPath || undefined,
      homePath: providers.codex.homePath || undefined,
    },
    claudeAgent: {
      binaryPath: providers.claudeAgent.binaryPath || undefined,
    },
    cursor: {
      binaryPath: providers.cursor.binaryPath || undefined,
      apiEndpoint: providers.cursor.apiEndpoint || undefined,
    },
    antigravity: {
      binaryPath: providers.antigravity.binaryPath || undefined,
    },
    grok: {
      binaryPath: providers.grok.binaryPath || undefined,
    },
    droid: {
      binaryPath: providers.droid.binaryPath || undefined,
    },
    kilo: {
      binaryPath: providers.kilo.binaryPath || undefined,
      serverUrl: providers.kilo.serverUrl || undefined,
    },
    opencode: {
      binaryPath: providers.opencode.binaryPath || undefined,
      serverUrl: providers.opencode.serverUrl || undefined,
      experimentalWebSockets: providers.opencode.experimentalWebSockets,
    },
    pi: {
      binaryPath: providers.pi.binaryPath || undefined,
      agentDir: providers.pi.agentDir || undefined,
    },
  };
}
