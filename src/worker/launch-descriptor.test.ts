import { describe, expect, it } from "vitest";
import {
  WORKER_PROTOCOL_FEATURES,
  WORKER_PROTOCOL_MAX_PAYLOAD_BYTES,
  WORKER_RPC_SET_VERSION,
} from "../../packages/gateway-protocol/src/schema/worker-admission.js";
import { WORKER_INFERENCE_MAX_CONTEXT_MESSAGES } from "../../packages/gateway-protocol/src/schema/worker-inference.js";
import type { WorkerLaunchDescriptor } from "./launch-descriptor.js";
import { buildWorkerConnectParams, parseWorkerLaunchDescriptor } from "./launch-descriptor.js";

function launchDescriptor(): WorkerLaunchDescriptor {
  return {
    version: 2,
    socketPath: "/tmp/openclaw-worker/gateway.sock",
    admission: {
      environmentId: "environment-1",
      credential: ["worker", "fixture", "value"].join("-"),
      sessionId: "session-1",
      ownerEpoch: 3,
      rpcSetVersion: WORKER_RPC_SET_VERSION,
      handshake: {
        bundleHash: "a".repeat(64),
        openclawVersion: "2026.7.12",
        protocolFeatures: [...WORKER_PROTOCOL_FEATURES],
      },
    },
    assignment: {
      runId: "run-1",
      turnId: "turn-1",
      prompt: "Inspect the workspace.",
      suppressPromptTranscript: false,
      workspaceDir: "/tmp/openclaw-worker/workspace",
      modelRef: { provider: "provider-1", model: "model-1" },
      inferenceOptions: { reasoning: "medium", maxTokens: 512 },
      initialMessages: [
        {
          role: "user",
          content: [{ type: "text", text: "Earlier context." }],
          timestamp: 1,
        },
      ],
      transcript: { baseLeafId: "leaf-7", nextSeq: 8 },
      liveEvents: { ackedSeq: 12, nextSeq: 13 },
      toolAuthority: { allowedToolNames: ["read", "exec"] },
    },
  };
}

function expectExecDeniedOrDescriptorRejected(candidate: unknown): void {
  try {
    const parsed = parseWorkerLaunchDescriptor(candidate);
    const authority = parsed.assignment
      .toolAuthority as WorkerLaunchDescriptor["assignment"]["toolAuthority"] & {
      exec?: { security?: unknown; ask?: unknown };
    };
    expect(authority.exec).toMatchObject({ security: "deny", ask: "off" });
    expect(authority.exec?.security).not.toBe("full");
  } catch (error) {
    expect(error).toMatchObject({ message: "invalid worker launch descriptor" });
  }
}

describe("worker launch descriptor", () => {
  it("accepts the exact admitted single-session launch shape", () => {
    const descriptor = launchDescriptor();

    expect(parseWorkerLaunchDescriptor(structuredClone(descriptor))).toEqual(descriptor);
    expect(buildWorkerConnectParams(descriptor)).toMatchObject({
      role: "worker",
      client: { id: "openclaw-worker", mode: "worker", version: "2026.7.12" },
      admission: { ...descriptor.admission, runId: descriptor.assignment.runId },
    });
  });

  it("rejects unknown fields at every launch-owned boundary", () => {
    const descriptor = launchDescriptor();
    const cases: unknown[] = [
      { ...descriptor, unexpected: true },
      {
        ...descriptor,
        admission: { ...descriptor.admission, unexpected: true },
      },
      {
        ...descriptor,
        assignment: { ...descriptor.assignment, unexpected: true },
      },
      {
        ...descriptor,
        assignment: {
          ...descriptor.assignment,
          modelRef: { ...descriptor.assignment.modelRef, unexpected: true },
        },
      },
      {
        ...descriptor,
        assignment: {
          ...descriptor.assignment,
          inferenceOptions: { ...descriptor.assignment.inferenceOptions, unexpected: true },
        },
      },
      {
        ...descriptor,
        assignment: {
          ...descriptor.assignment,
          transcript: { ...descriptor.assignment.transcript, unexpected: true },
        },
      },
      {
        ...descriptor,
        assignment: {
          ...descriptor.assignment,
          liveEvents: { ...descriptor.assignment.liveEvents, unexpected: true },
        },
      },
      {
        ...descriptor,
        assignment: {
          ...descriptor.assignment,
          toolAuthority: { ...descriptor.assignment.toolAuthority, unexpected: true },
        },
      },
    ];

    for (const candidate of cases) {
      expect(() => parseWorkerLaunchDescriptor(candidate)).toThrow(
        "invalid worker launch descriptor",
      );
    }
  });

  it("requires a unique closed worker tool authority", () => {
    const descriptor = launchDescriptor();
    const { toolAuthority: _missing, ...assignmentWithoutAuthority } = descriptor.assignment;
    const cases: unknown[] = [
      { ...descriptor, version: 1 },
      { ...descriptor, assignment: assignmentWithoutAuthority },
      {
        ...descriptor,
        assignment: {
          ...descriptor.assignment,
          toolAuthority: { allowedToolNames: ["read", "read"] },
        },
      },
      {
        ...descriptor,
        assignment: {
          ...descriptor.assignment,
          toolAuthority: { allowedToolNames: ["read", "gateway"] },
        },
      },
      {
        ...descriptor,
        assignment: {
          ...descriptor.assignment,
          toolAuthority: { allowedToolNames: ["exec", "plugin__exec"] },
        },
      },
      {
        ...descriptor,
        assignment: {
          ...descriptor.assignment,
          toolAuthority: { allowedToolNames: ["exec", "message"] },
        },
      },
    ];

    for (const candidate of cases) {
      expect(() => parseWorkerLaunchDescriptor(candidate)).toThrow(
        "invalid worker launch descriptor",
      );
    }

    descriptor.assignment.toolAuthority.allowedToolNames = [];
    expect(parseWorkerLaunchDescriptor(structuredClone(descriptor))).toEqual(descriptor);
  });

  it("never gives a name-only legacy descriptor permissive exec authority", () => {
    const descriptor = launchDescriptor();

    expectExecDeniedOrDescriptorRejected(structuredClone(descriptor));
  });

  it("rejects or denies malformed and partially populated exec authority", () => {
    const descriptor = launchDescriptor();
    const cases = [
      null,
      {},
      { security: "deny" },
      { ask: "off" },
      { security: "full" },
      { security: "full", ask: "off" },
      { security: null, ask: "off" },
      { security: "deny", ask: false },
    ];

    for (const exec of cases) {
      expectExecDeniedOrDescriptorRejected({
        ...descriptor,
        assignment: {
          ...descriptor.assignment,
          toolAuthority: { ...descriptor.assignment.toolAuthority, exec },
        },
      });
    }
  });

  it("rejects or denies every accepted legacy launch shape", () => {
    const descriptor = launchDescriptor();
    const { toolAuthority: _authority, ...assignmentWithoutAuthority } = descriptor.assignment;

    expectExecDeniedOrDescriptorRejected({ ...descriptor, version: 1 });
    expectExecDeniedOrDescriptorRejected({
      ...descriptor,
      assignment: assignmentWithoutAuthority,
    });
  });

  it("rejects non-absolute paths, unattached sessions, and discontinuous event sequences", () => {
    const descriptor = launchDescriptor();
    const cases: unknown[] = [
      { ...descriptor, socketPath: "gateway.sock" },
      {
        ...descriptor,
        assignment: { ...descriptor.assignment, workspaceDir: "workspace" },
      },
      {
        ...descriptor,
        admission: { ...descriptor.admission, sessionId: null },
      },
      {
        ...descriptor,
        admission: { ...descriptor.admission, ownerEpoch: 0 },
      },
      {
        ...descriptor,
        assignment: {
          ...descriptor.assignment,
          liveEvents: { ackedSeq: 12, nextSeq: 14 },
        },
      },
    ];

    for (const candidate of cases) {
      expect(() => parseWorkerLaunchDescriptor(candidate)).toThrow(
        "invalid worker launch descriptor",
      );
    }
  });

  it("caps initial history at the inference context limit", () => {
    const descriptor = launchDescriptor();
    const message = descriptor.assignment.initialMessages[0];
    if (!message) {
      throw new Error("expected launch fixture message");
    }
    descriptor.assignment.initialMessages = Array.from(
      { length: WORKER_INFERENCE_MAX_CONTEXT_MESSAGES },
      () => structuredClone(message),
    );
    expect(parseWorkerLaunchDescriptor(structuredClone(descriptor))).toEqual(descriptor);

    descriptor.assignment.initialMessages = Array.from(
      { length: WORKER_INFERENCE_MAX_CONTEXT_MESSAGES + 1 },
      () => structuredClone(message),
    );

    expect(() => parseWorkerLaunchDescriptor(descriptor)).toThrow(
      "invalid worker launch descriptor",
    );
  });

  it("rejects a prompt that cannot fit its transcript frame", () => {
    const descriptor = launchDescriptor();
    descriptor.assignment.prompt = "x".repeat(WORKER_PROTOCOL_MAX_PAYLOAD_BYTES);

    expect(() => parseWorkerLaunchDescriptor(descriptor)).toThrow(
      "invalid worker launch descriptor",
    );
  });
});
