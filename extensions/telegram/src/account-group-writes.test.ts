import { resolveChannelConfigWrites } from "openclaw/plugin-sdk/channel-config-helpers";
import {
  resolveChannelGroupPolicy,
  resolveChannelGroupRequireMention,
  resolveChannelGroups,
  resolveChannelGroupsConfigPath,
} from "openclaw/plugin-sdk/channel-policy";
import { describe, expect, it } from "vitest";
import { withChannelAccountKeyScope } from "../../../test/helpers/channel-account-key-scope.js";
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

describe.each(["direct", "projected"] as const)("%s account writes", (scope) => {
  it("edits the sender list on the account that supplied the group deny", async () => {
    const cfg = telegramConfig();
    const parsedConfig = structuredClone(cfg);
    const result = await withChannelAccountKeyScope(scope, "telegram", () =>
      telegramPlugin.allowlist?.applyConfigEdit?.({
        cfg,
        parsedConfig,
        accountId,
        scope: "group",
        action: "add",
        entry: "202",
      }),
    );
    expect(result).toMatchObject({ kind: "ok", changed: true });
    expect(resolveTelegramGroupToolPolicy({ cfg: parsedConfig, groupId, accountId })).toEqual(
      tools,
    );
    expect(Object.keys(parsedConfig.channels.telegram.accounts)).toEqual(["Ops.Team"]);
    expect(parsedConfig.channels.telegram.accounts["Ops.Team"].groupAllowFrom).toEqual([
      "101",
      "202",
    ]);
  });

  it("carries the account's group deny to the migrated chat id", () => {
    const cfg = telegramConfig();
    const newChatId = "-100123";
    expect(
      withChannelAccountKeyScope(scope, "telegram", () =>
        migrateTelegramGroupConfig({ cfg, accountId, oldChatId: groupId, newChatId }),
      ),
    ).toEqual({
      migrated: true,
      skippedExisting: false,
    });
    expect(resolveTelegramGroupToolPolicy({ cfg, accountId, groupId: newChatId })).toEqual(tools);
    expect(cfg.channels.telegram.accounts["Ops.Team"].groups).not.toHaveProperty(groupId);
  });

  it("checks migration permission on the authored account", () => {
    expect(
      withChannelAccountKeyScope(scope, "telegram", () =>
        resolveChannelConfigWrites({
          cfg: telegramConfig(false),
          channelId: "telegram",
          accountId,
        }),
      ),
    ).toBe(false);
  });
});

it("uses the first canonical alias for settings, credentials and group policy", () => {
  const first = {
    botToken: "alias-token",
    configWrites: false,
    groupPolicy: "allowlist" as const,
    groups: { [groupId]: { requireMention: true, tools } },
  };
  const second = {
    botToken: "case-token",
    configWrites: true,
    groupPolicy: "disabled" as const,
    groups: { [groupId]: { requireMention: false, tools: { allow: ["write"] } } },
  };
  const cfg = { channels: { telegram: { accounts: { "Ops.Team": first, "OPS-TEAM": second } } } };
  const selected = resolveTelegramAccountConfig(cfg, accountId);
  expect(selected).toBe(first);
  expect(resolveTelegramToken(cfg, { accountId }).token).toBe(first.botToken);
  const params = { cfg, channel: "telegram", groupId, accountId } as const;
  const groups = resolveChannelGroups(cfg, params.channel, accountId);
  expect(groups).toBe(selected?.groups);
  expect(resolveChannelGroupsConfigPath({ ...params, groups })).toBe(
    'channels.telegram.accounts["Ops.Team"].groups',
  );
  expect(resolveChannelGroupPolicy(params).allowed).toBe(true);
  expect(resolveChannelGroupRequireMention(params)).toBe(true);
  expect(resolveTelegramGroupToolPolicy(params)).toEqual(first.groups[groupId].tools);
  expect(resolveChannelConfigWrites({ cfg, channelId: params.channel, accountId })).toBe(false);
});
