// FILE: piSession.test.ts
// Purpose: impl-11 correction regression tests for model resolution. The
// harness must resolve Pi's configured default provider/model (settings.json)
// through SDK/settings semantics and verify it exists in the model registry,
// failing clearly instead of picking an arbitrary first registry model.
// Explicit CLI models must remain higher priority.
import { describe, expect, it } from "vitest";

import type { AgentSession } from "@earendil-works/pi-coding-agent";

import {
  parseModelReference,
  resolveConfiguredDefaultModel,
  resolveConfiguredModelId,
  resolvePiModel,
} from "./piSession.ts";
import { resolveRunModelId } from "./cli.ts";
import type { PiSdkModule } from "./piSession.ts";

interface FakeModel {
  readonly id: string;
  readonly provider: string;
  readonly api?: unknown;
  readonly baseUrl?: unknown;
}

const REGISTRY_MODELS: readonly FakeModel[] = [
  // Arbitrary first registry model (the impl-11 bug picked this one).
  {
    id: "us.anthropic.claude-opus-4-6-v1",
    provider: "amazon-bedrock",
    api: {},
    baseUrl: "https://bedrock.invalid",
  },
  { id: "gpt-5.6-sol", provider: "cockpit", api: {}, baseUrl: "http://localhost:59450/v1" },
  { id: "gpt-5.6-terra", provider: "cockpit", api: {}, baseUrl: "http://localhost:59450/v1" },
];

function fakeRegistry(models: readonly FakeModel[]): {
  readonly find: (provider: string, id: string) => FakeModel | undefined;
  readonly getAll: () => readonly FakeModel[];
} {
  return {
    find: (provider, id) => models.find((model) => model.provider === provider && model.id === id),
    getAll: () => models,
  };
}

function fakeSdk(overrides: {
  readonly defaultProvider?: string;
  readonly defaultModel?: string;
}): PiSdkModule {
  return {
    ModelRuntime: {
      create: async () => ({}),
    },
    ModelRegistry: class {
      find(provider: string, id: string): FakeModel | undefined {
        return fakeRegistry(REGISTRY_MODELS).find(provider, id);
      }
      getAll(): readonly FakeModel[] {
        return REGISTRY_MODELS;
      }
    },
    SettingsManager: {
      create: () => ({
        getDefaultProvider: () => overrides.defaultProvider,
        getDefaultModel: () => overrides.defaultModel,
      }),
    },
    SessionManager: {
      create: () => ({}),
    },
    createAgentSessionServices: async () => ({}),
    createAgentSessionFromServices: async () => ({ session: {} as unknown as AgentSession }),
    createBashToolDefinition: () => ({}),
    createLocalBashOperations: () => ({}),
    defineTool: () => ({}),
  };
}

describe("resolveConfiguredDefaultModel", () => {
  it("resolves the configured default provider/model, never the first registry model", () => {
    // Regression: the first registry model is amazon-bedrock, but the
    // configured default is cockpit/gpt-5.6-sol.
    expect(fakeRegistry(REGISTRY_MODELS).getAll()[0]?.provider).toBe("amazon-bedrock");
    const resolved = resolveConfiguredDefaultModel(
      { defaultProvider: "cockpit", defaultModel: "gpt-5.6-sol" },
      fakeRegistry(REGISTRY_MODELS),
    );
    expect(resolved).toEqual({ provider: "cockpit", id: "gpt-5.6-sol" });
  });

  it("fails clearly when settings.json has no configured default", () => {
    expect(() => resolveConfiguredDefaultModel({}, fakeRegistry(REGISTRY_MODELS))).toThrow(
      /settings\.json has no configured default provider\/model/,
    );
  });

  it("fails clearly on an incomplete default (provider or model missing)", () => {
    expect(() =>
      resolveConfiguredDefaultModel({ defaultProvider: "cockpit" }, fakeRegistry(REGISTRY_MODELS)),
    ).toThrow(/incomplete default model configuration/);
    expect(() =>
      resolveConfiguredDefaultModel({ defaultModel: "gpt-5.6-sol" }, fakeRegistry(REGISTRY_MODELS)),
    ).toThrow(/incomplete default model configuration/);
  });

  it("fails clearly when the configured default is not present in the registry", () => {
    expect(() =>
      resolveConfiguredDefaultModel(
        { defaultProvider: "cockpit", defaultModel: "claude-opus-4-8" },
        fakeRegistry(REGISTRY_MODELS),
      ),
    ).toThrow(/'cockpit\/claude-opus-4-8'.*not present in the model registry/i);
  });

  it("fails clearly when the configured provider has no registered models", () => {
    expect(() =>
      resolveConfiguredDefaultModel(
        { defaultProvider: "anthropic", defaultModel: "claude-opus-4-8" },
        fakeRegistry(REGISTRY_MODELS),
      ),
    ).toThrow(/'anthropic\/claude-opus-4-8'/);
  });
});

describe("resolveConfiguredModelId", () => {
  it("returns the configured default provider/model id through SDK settings semantics", async () => {
    const modelId = await resolveConfiguredModelId(
      "/tmp/agent",
      fakeSdk({ defaultProvider: "cockpit", defaultModel: "gpt-5.6-sol" }),
    );
    expect(modelId).toBe("cockpit/gpt-5.6-sol");
  });

  it("propagates the clear failure when the configured default is missing", async () => {
    await expect(resolveConfiguredModelId("/tmp/agent", fakeSdk({}))).rejects.toThrow(
      /settings\.json has no configured default provider\/model/,
    );
  });

  it("propagates the clear failure when the configured default is invalid", async () => {
    await expect(
      resolveConfiguredModelId(
        "/tmp/agent",
        fakeSdk({ defaultProvider: "cockpit", defaultModel: "not-a-model" }),
      ),
    ).rejects.toThrow(/'cockpit\/not-a-model'/);
  });
});

describe("explicit CLI model priority (resolveRunModelId)", () => {
  it("keeps an explicit --model and never consults the agent directory", async () => {
    // If the explicit model path consulted the agent dir, resolution would
    // fail loudly (no SDK/registry/settings load happens at all).
    await expect(
      resolveRunModelId({ explicitModel: "cockpit/gpt-5.6-sol", agentDir: "/nonexistent/agent" }),
    ).resolves.toBe("cockpit/gpt-5.6-sol");
  });

  it("trims and keeps an explicit --model reference", async () => {
    await expect(
      resolveRunModelId({
        explicitModel: "  cockpit/gpt-5.6-sol  ",
        agentDir: "/nonexistent/agent",
      }),
    ).resolves.toBe("cockpit/gpt-5.6-sol");
  });
});

describe("explicit model resolution at the session boundary", () => {
  it("parses a provider-qualified model reference", () => {
    expect(parseModelReference("cockpit/gpt-5.6-sol")).toEqual({
      provider: "cockpit",
      id: "gpt-5.6-sol",
    });
  });

  it("resolves an explicit provider-qualified model from the registry", () => {
    const model = resolvePiModel(fakeRegistry(REGISTRY_MODELS), "cockpit/gpt-5.6-sol") as FakeModel;
    expect(model.provider).toBe("cockpit");
    expect(model.id).toBe("gpt-5.6-sol");
  });
});
