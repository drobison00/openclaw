import { describe, expect, it } from "vitest";
import { getFrameworkCommands, matchSlashCommand } from "./slash-commands-impl.js";
import type { SlashCommandContext } from "./slash-commands.js";

function buildContext(rawContent: string): SlashCommandContext {
  return {
    type: "c2c",
    senderId: "UNAUTHORIZED_SENDER",
    messageId: "msg-1",
    eventTimestamp: new Date().toISOString(),
    receivedAt: Date.now(),
    rawContent,
    args: "",
    accountId: "default",
    appId: "test-app",
    commandAuthorized: false,
    queueSnapshot: { totalPending: 0, activeUsers: 0, maxConcurrentUsers: 5, senderPending: 0 },
  };
}

describe("QQBot framework slash commands", () => {
  it("routes bot-approve through the auth-gated framework registry", () => {
    expect(getFrameworkCommands().map((command) => command.name)).toContain("bot-approve");
  });

  it("routes state-mutating built-ins through the auth-gated framework registry", () => {
    expect(getFrameworkCommands().map((command) => command.name)).toEqual(
      expect.arrayContaining(["bot-clear-storage", "bot-streaming"]),
    );
  });

  it("does not execute state-mutating built-ins on the pre-dispatch path", async () => {
    await expect(matchSlashCommand(buildContext("/bot-streaming off"))).resolves.toBeNull();
    await expect(matchSlashCommand(buildContext("/bot-clear-storage --force"))).resolves.toBeNull();
  });
});
