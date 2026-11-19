import { resolveChannelConfigWrites } from "openclaw/plugin-sdk/channel-config-helpers";
import { expect, it } from "vitest";
import { resolveTelegramAccountConfig } from "./account-config.js";
import { telegramPlugin } from "./channel.js";
import { migrateTelegramGroupConfig } from "./group-migration.js";
import { resolveTelegramGroupToolPolicy } from "./group-policy.js";
import { resolveTelegramToken } from "./token.js";

const accountId = "ops-team";
const groupId = "-123";
const tools = { deny: ["write"] };

function telegramConfig(configWrites = true) {
  return {
    channels: {
      telegram: {
        groups: { "*": { tools: { allow: ["write"] } } },
        accounts: {
          "Ops.Team": {
            configWrites,
            groupAllowFrom: ["101"],
            groups: { [groupId]: { tools } },
          },
        },
      },
    },
  };
}

it("edits the sender list on the account that supplied the group deny", async () => {
  const cfg = telegramConfig();
  const parsedConfig = structuredClone(cfg);
  const result = await telegramPlugin.allowlist?.applyConfigEdit?.({
    cfg,
    parsedConfig,
    accountId,
    scope: "group",
    action: "add",
    entry: "202",
  });
  expect(result).toMatchObject({ kind: "ok", changed: true });
  expect(resolveTelegramGroupToolPolicy({ cfg: parsedConfig, groupId, accountId })).toEqual(tools);
  expect(Object.keys(parsedConfig.channels.telegram.accounts)).toEqual(["Ops.Team"]);
  expect(parsedConfig.channels.telegram.accounts["Ops.Team"].groupAllowFrom).toEqual([
    "101",
    "202",
  ]);
});

it("carries the account's group deny to the migrated chat id", () => {
  const cfg = telegramConfig();
  const newChatId = "-100123";
  expect(migrateTelegramGroupConfig({ cfg, accountId, oldChatId: groupId, newChatId })).toEqual({
    migrated: true,
    skippedExisting: false,
  });
  expect(resolveTelegramGroupToolPolicy({ cfg, accountId, groupId: newChatId })).toEqual(tools);
  expect(cfg.channels.telegram.accounts["Ops.Team"].groups).not.toHaveProperty(groupId);
});

it("checks migration permission on the authored account", () => {
  expect(
    resolveChannelConfigWrites({ cfg: telegramConfig(false), channelId: "telegram", accountId }),
  ).toBe(false);
});

it("selects the case-only account before a dotted alias for settings and credentials", () => {
  const alias = { botToken: "alias-token" };
  const winner = { botToken: "case-token" };
  const cfg = { channels: { telegram: { accounts: { "Ops.Team": alias, "OPS-TEAM": winner } } } };
  expect(resolveTelegramAccountConfig(cfg, accountId)).toBe(winner);
  expect(resolveTelegramToken(cfg, { accountId }).token).toBe(winner.botToken);
});
