// The deploy-time capability walk reads `gmail.definitions` without
// invoking the factory, so the static declaration must match what the
// instantiated bundle emits.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDefaultDirectorRegistry } from "@intx/agent";
import { noopAuditStore, permissiveAuthorize } from "@intx/agent/testing";
import { createIsogitStore } from "@intx/storage-isogit/node";
import type { InferenceSource } from "@intx/types/runtime";
import { createRuntimeCapabilities } from "@intx/types/runtime-capabilities";

import { gmail, type GmailToolEnv } from "./sidecar-bundle.js";

const SOURCE: InferenceSource = {
  id: "anthropic:mock-model",
  provider: "anthropic",
  baseURL: "https://api.anthropic.com",
  credentialId: "test-credential",
  model: "mock-model",
};

let tmpDir: string;
let env: GmailToolEnv;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "google-tools-sidecar-bundle-test-"));
  env = {
    sources: [SOURCE],
    defaultSource: SOURCE.id,
    storage: await createIsogitStore(tmpDir),
    workdir: tmpDir,
    audit: noopAuditStore(),
    authorize: permissiveAuthorize(),
    directors: createDefaultDirectorRegistry(),
    capabilities: createRuntimeCapabilities({}),
  };
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("gmail sidecar-bundle static declaration", () => {
  test("declared definition names match the instantiated bundle's names", async () => {
    const bundle = gmail(env);
    const declared = new Set(
      gmail.definitions.map((definition) => definition.name),
    );
    const emitted = new Set(
      bundle.definitions.map((definition) => definition.name),
    );
    expect(emitted).toEqual(declared);
    await bundle.dispose?.();
  });

  test("gates every tool behind approval", () => {
    expect(gmail.definitions.length).toBeGreaterThan(0);
    for (const definition of gmail.definitions) {
      expect(definition.approval).toBe("ask");
    }
  });
});
