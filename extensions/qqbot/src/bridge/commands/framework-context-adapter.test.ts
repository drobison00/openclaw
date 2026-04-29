import type { PluginCommandContext } from "openclaw/plugin-sdk/plugin-entry";
import { describe, expect, it } from "vitest";
import type { ResolvedQQBotAccount } from "../../types.js";
import { buildFrameworkSlashContext } from "./framework-context-adapter.js";

function buildPluginContext(isAuthorizedSender: boolean): PluginCommandContext {
  return {
    senderId: "sender-1",
    channel: "qqbot",
    isAuthorizedSender,
    args: "off",
    commandBody: "/bot-streaming off",
    config: {} as PluginCommandContext["config"],
    from: "qqbot:c2c:sender-1",
    requestConversationBinding: async () => ({ bound: false }),
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null,
  };
}

const account: ResolvedQQBotAccount = {
  accountId: "default",
  enabled: true,
  appId: "app-1",
  clientSecret: "secret",
  secretSource: "config",
  markdownSupport: true,
  config: {},
};

describe("buildFrameworkSlashContext", () => {
  it("preserves the framework authorization decision", () => {
    expect(
      buildFrameworkSlashContext({
        ctx: buildPluginContext(false),
        account,
        from: { msgType: "c2c", targetType: "c2c", targetId: "sender-1" },
        commandName: "bot-streaming",
      }).commandAuthorized,
    ).toBe(false);

    expect(
      buildFrameworkSlashContext({
        ctx: buildPluginContext(true),
        account,
        from: { msgType: "c2c", targetType: "c2c", targetId: "sender-1" },
        commandName: "bot-streaming",
      }).commandAuthorized,
    ).toBe(true);
  });
});
