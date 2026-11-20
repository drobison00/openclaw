// Verifies group-policy normalization and runtime resolution.
import { describe, expect, it } from "vitest";
import { normalizeAccountId } from "../routing/account-id.js";
import { parseConcreteConfigPath } from "../shared/dot-path.js";
import { resolveMergedAccountConfig } from "./channel-account-config.js";
import { setConfigValueAtPath } from "./config-paths.js";
import type { OpenClawConfig } from "./config.js";
import {
  resolveChannelGroupPolicy,
  resolveChannelGroupRequireMention,
  resolveChannelGroupToolsPolicy,
  resolveChannelGroups,
  resolveChannelGroupsConfigPath,
  resolveToolsBySender,
} from "./group-policy.js";

describe("named group account aliases", () => {
  function inspectGroupPolicy(
    keys: string[],
    accountId: string,
    channel: "telegram" | "whatsapp",
    normalizeAccountKey?: (key: string) => string,
  ) {
    const accounts = Object.fromEntries(
      keys.map((key) => [
        key,
        {
          groupPolicy: "allowlist",
          groups: { "-1001": { requireMention: true, tools: { deny: [key] } } },
        },
      ]),
    );
    const cfg: OpenClawConfig = {
      channels: {
        [channel]: {
          groupPolicy: "open",
          groups: { "*": { requireMention: false, tools: { allow: ["read"] } } },
          accounts,
        },
      },
    };
    const params = { cfg, channel, accountId, normalizeAccountKey, groupId: "-1001" };
    const groups = resolveChannelGroups(cfg, channel, accountId, normalizeAccountKey);
    const policy = resolveChannelGroupPolicy(params);
    return {
      listed: Boolean(policy.groupConfig),
      unlistedAllowed: resolveChannelGroupPolicy({ ...params, groupId: "-1002" }).allowed,
      mention: resolveChannelGroupRequireMention(params),
      tools: resolveChannelGroupToolsPolicy(params),
      path: resolveChannelGroupsConfigPath({ ...params, groups }),
    };
  }

  it.each([
    { keys: ["ops.team"], selected: "ops.team" },
    { keys: ["Ops Team"], selected: "Ops Team" },
    { keys: ["ops-team"], selected: "ops-team" },
    { keys: ["OPS-TEAM"], selected: "OPS-TEAM" },
    { keys: ["ops.team", "ops-team"], selected: "ops-team" },
    { keys: ["ops.team", "OPS-TEAM"], selected: "OPS-TEAM" },
    { keys: ["OPS-TEAM", "ops.team"], selected: "OPS-TEAM" },
    { keys: ["ops.team", "Ops Team"], selected: undefined },
    { keys: ["Ops Team", "ops.team"], selected: undefined },
    { keys: ["Default."], selected: undefined, accountId: "default" },
    { keys: ["Default.", "DEFAULT"], selected: "DEFAULT", accountId: "default" },
    { keys: ["Default.", "DEFAULT", "default"], selected: "default", accountId: "default" },
  ])("selects $selected for $keys", ({ keys, selected, accountId }) => {
    expect(
      inspectGroupPolicy(keys, accountId ?? "ops-team", "telegram", normalizeAccountId),
    ).toEqual({
      listed: Boolean(selected),
      unlistedAllowed: !selected,
      mention: Boolean(selected),
      tools: selected ? { deny: [selected] } : { allow: ["read"] },
      path: selected
        ? `channels.telegram.accounts["${selected}"].groups`
        : "channels.telegram.groups",
    });
  });

  it("enforces the account allowlist mode even without a groups map", () => {
    const cfg: OpenClawConfig = {
      channels: {
        telegram: {
          groupPolicy: "open",
          accounts: { "Ops Team": { groupPolicy: "allowlist" } },
        },
      },
    };
    expect(
      resolveChannelGroupPolicy({
        cfg,
        channel: "telegram",
        accountId: "ops-team",
        normalizeAccountKey: normalizeAccountId,
        groupId: "-1002",
      }),
    ).toMatchObject({ allowlistEnabled: true, allowed: false });
  });

  it.each(["telegram", "whatsapp"] as const)(
    "keeps the root for %s without an account normalizer",
    (channel) => {
      expect(inspectGroupPolicy(["ops.team"], "ops-team", channel)).toEqual({
        listed: false,
        unlistedAllowed: true,
        mention: false,
        tools: { allow: ["read"] },
        path: `channels.${channel}.groups`,
      });
    },
  );
});

describe("resolveChannelGroupPolicy", () => {
  const whatsapp = (config: Record<string, unknown>) =>
    ({ channels: { whatsapp: config } }) as OpenClawConfig;

  it.each([
    {
      name: "allows configured groups on an allowlist",
      config: { groupPolicy: "allowlist", groups: { "123@g.us": { requireMention: true } } },
      accountId: undefined,
      hasGroupAllowFrom: false,
      allowed: true,
    },
    {
      name: "blocks disabled groups despite a wildcard",
      config: { groupPolicy: "disabled", groups: { "*": { requireMention: false } } },
      accountId: undefined,
      hasGroupAllowFrom: false,
      allowed: false,
    },
    {
      name: "respects account-scoped allowlist overrides",
      config: { groupPolicy: "open", accounts: { work: { groupPolicy: "allowlist" } } },
      accountId: "work",
      hasGroupAllowFrom: false,
      allowed: false,
    },
    ...[false, true].map((hasGroupAllowFrom) => ({
      name: `requires sender filtering without configured groups (${hasGroupAllowFrom})`,
      config: { groupPolicy: "allowlist" },
      accountId: undefined,
      hasGroupAllowFrom,
      allowed: hasGroupAllowFrom,
    })),
  ])("$name", ({ config, accountId, hasGroupAllowFrom, allowed }) => {
    expect(
      resolveChannelGroupPolicy({
        cfg: whatsapp(config),
        channel: "whatsapp",
        groupId: "123@g.us",
        accountId,
        hasGroupAllowFrom,
      }),
    ).toMatchObject({ allowlistEnabled: true, allowed });
  });

  it.each([undefined, true])(
    "defaults configured groups to no mention only with channel opt-in (%s)",
    (configuredGroupDefaultsToNoMention) => {
      expect(
        resolveChannelGroupRequireMention({
          cfg: whatsapp({ groups: { "123@g.us": {} } }),
          channel: "whatsapp",
          groupId: "123@g.us",
          configuredGroupDefaultsToNoMention,
        }),
      ).toBe(!configuredGroupDefaultsToNoMention);
    },
  );

  it.each([
    ["inherits root groups for an empty account map (#79427)", {}, "-100root", true],
    [
      "selects populated account groups",
      { "-100account": { requireMention: false } },
      "-100account",
      true,
    ],
    [
      "does not merge root groups into populated account groups",
      { "-100account": { requireMention: false } },
      "-100root",
      false,
    ],
  ] as const)("%s", (_name, groups, groupId, allowed) => {
    const cfg = {
      channels: {
        telegram: {
          groupPolicy: "allowlist",
          groups: { "-100root": { requireMention: false } },
          accounts: { default: { botToken: "123:default", groups } },
        },
      },
    } as OpenClawConfig;
    expect(
      resolveChannelGroupPolicy({ cfg, channel: "telegram", groupId, accountId: "default" }),
    ).toMatchObject({ allowlistEnabled: true, allowed });
  });
});

describe("resolveChannelGroupsConfigPath", () => {
  it.each([
    { name: "inherited root", accountId: "work", accountKey: "Work", override: false },
    {
      name: "normalized account override",
      accountId: " WORK ",
      accountKey: "Work",
      override: true,
    },
    {
      name: "explicit default account",
      accountId: "default",
      accountKey: "default",
      override: true,
    },
  ])(
    "updates the $name map while retaining sibling policies",
    ({ accountId, accountKey, override }) => {
      const rootGroups = {
        "*": { requireMention: true, tools: { deny: ["exec"] } },
        room: { requireMention: true, tools: { deny: ["write"] } },
        sibling: { requireMention: true, tools: { deny: ["read"] } },
      };
      const accountGroups = override ? structuredClone(rootGroups) : undefined;
      const cfg = {
        channels: {
          imessage: {
            groups: rootGroups,
            accounts: { [accountKey]: accountGroups ? { groups: accountGroups } : {} },
          },
        },
      } satisfies OpenClawConfig;
      const groups = resolveChannelGroups(cfg, "imessage", accountId);
      const groupsPath = resolveChannelGroupsConfigPath({
        cfg,
        channel: "imessage",
        accountId,
        groups,
      });
      expect(groupsPath).toBe(
        override
          ? `channels.imessage.accounts[${JSON.stringify(accountKey)}].groups`
          : "channels.imessage.groups",
      );
      const before = structuredClone(rootGroups);

      setConfigValueAtPath(
        cfg,
        parseConcreteConfigPath(`${groupsPath}["room"].requireMention`),
        false,
      );

      expect(resolveChannelGroups(cfg, "imessage", accountId)).toEqual({
        ...before,
        room: { ...before.room, requireMention: false },
      });
      expect(
        resolveChannelGroupRequireMention({ cfg, channel: "imessage", accountId, groupId: "room" }),
      ).toBe(false);
      expect(
        resolveChannelGroupPolicy({ cfg, channel: "imessage", accountId, groupId: "sibling" })
          .allowed,
      ).toBe(true);
      if (override) {
        expect(rootGroups).toEqual(before);
      } else {
        expect(cfg.channels.imessage.accounts[accountKey]).toEqual({});
      }
    },
  );

  it.each([
    { name: "shared single-account inheritance", shallow: false, multiple: false, scope: "root" },
    { name: "shared multi-account override", shallow: false, multiple: true, scope: "account" },
    { name: "plugin-owned shallow override", shallow: true, multiple: false, scope: "account" },
  ])("honors $name for an empty map", ({ shallow, multiple, scope }) => {
    const channelConfig = {
      groups: { sibling: { requireMention: false } },
      accounts: { Work: { groups: {} }, ...(multiple ? { Other: {} } : {}) },
    };
    const cfg = { channels: { line: channelConfig } } satisfies OpenClawConfig;
    const groups = shallow
      ? resolveMergedAccountConfig<{ groups?: Record<string, { requireMention?: boolean }> }>({
          channelConfig,
          accounts: channelConfig.accounts,
          accountId: "work",
        }).groups
      : resolveChannelGroups(cfg, "line", "work");
    expect(
      resolveChannelGroupsConfigPath({ cfg, channel: "line", accountId: "work", groups }),
    ).toBe(scope === "root" ? "channels.line.groups" : 'channels.line.accounts["Work"].groups');
  });

  it.each([
    { accountId: "work", expected: 'channels.signal.accounts["Work"].groups' },
    { accountId: "default", expected: 'channels.signal.accounts["default"].groups' },
    { accountId: "missing", expected: "channels.signal.groups" },
  ])(
    "locates a new map for $accountId without inventing a fallback account",
    ({ accountId, expected }) => {
      const cfg = {
        channels: { signal: { accounts: { Work: {}, default: {} } } },
      } satisfies OpenClawConfig;
      expect(
        resolveChannelGroupsConfigPath({ cfg, channel: "signal", accountId, groups: undefined }),
      ).toBe(expected);
    },
  );

  it("preserves exact account-key precedence when config objects share a reference", () => {
    const account = { groups: {} };
    const cfg = {
      channels: { signal: { accounts: { Work: account, work: account } } },
    } satisfies OpenClawConfig;
    expect(
      resolveChannelGroupsConfigPath({
        cfg,
        channel: "signal",
        accountId: "work",
        groups: account.groups,
      }),
    ).toBe('channels.signal.accounts["work"].groups');
  });
});

describe("resolveToolsBySender", () => {
  it("matches typed sender IDs", () => {
    expect(
      resolveToolsBySender({
        toolsBySender: {
          "id:user:alice": { allow: ["exec"] },
          "*": { deny: ["exec"] },
        },
        senderId: "user:alice",
      }),
    ).toEqual({ allow: ["exec"] });
  });

  it("matches channel-scoped sender IDs through canonical channel aliases", () => {
    expect(
      resolveToolsBySender({
        toolsBySender: {
          "channel:msteams:user:alice": { allow: ["exec"] },
          "id:user:alice": { deny: ["exec"] },
          "*": { deny: ["write"] },
        },
        messageProvider: "teams",
        senderId: "user:alice",
      }),
    ).toEqual({ allow: ["exec"] });
  });

  it("does not allow senderName collisions to match id keys", () => {
    const victimId = "f4ce8a7d-1111-2222-3333-444455556666";
    expect(
      resolveToolsBySender({
        toolsBySender: {
          [`id:${victimId}`]: { allow: ["exec", "fs.read"] },
          "*": { deny: ["exec"] },
        },
        senderId: "attacker-real-id",
        senderName: victimId,
        senderUsername: "attacker",
      }),
    ).toEqual({ deny: ["exec"] });
  });

  it("rejects untyped policies instead of silently dropping a restriction", () => {
    expect(() =>
      resolveToolsBySender({
        toolsBySender: { alice: { deny: ["exec"] }, "*": { allow: ["exec"] } },
        senderId: "alice",
      }),
    ).toThrow('Untyped toolsBySender keys are retired. Run "openclaw doctor --fix".');
  });

  it.each(["id:alice:example.invalid", "channel:matrix:alice:example.invalid"])(
    "preserves incoming sender-ID alternatives for %s",
    (key) => {
      expect(
        resolveToolsBySender({
          toolsBySender: { [key]: { deny: ["exec"] }, "*": { allow: ["exec"] } },
          senderId: "@Alice:example.invalid",
          messageProvider: "matrix",
        }),
      ).toEqual({ deny: ["exec"] });
    },
  );

  it("matches username keys only against senderUsername", () => {
    expect(
      resolveToolsBySender({
        toolsBySender: {
          "username:alice": { allow: ["exec"] },
          "*": { deny: ["exec"] },
        },
        senderId: "alice",
        senderUsername: "other-user",
      }),
    ).toEqual({ deny: ["exec"] });

    expect(
      resolveToolsBySender({
        toolsBySender: {
          "username:alice": { allow: ["exec"] },
          "*": { deny: ["exec"] },
        },
        senderId: "other-id",
        senderUsername: "@alice",
      }),
    ).toEqual({ allow: ["exec"] });
  });

  it("matches e164 and name only when explicitly typed", () => {
    expect(
      resolveToolsBySender({
        toolsBySender: {
          "e164:+15550001111": { allow: ["exec"] },
          "name:owner": { deny: ["exec"] },
        },
        senderE164: "+15550001111",
        senderName: "owner",
      }),
    ).toEqual({ allow: ["exec"] });
  });

  it("prefers id over username over name", () => {
    expect(
      resolveToolsBySender({
        toolsBySender: {
          "id:alice": { deny: ["exec"] },
          "username:alice": { allow: ["exec"] },
          "name:alice": { allow: ["read"] },
        },
        senderId: "alice",
        senderUsername: "alice",
        senderName: "alice",
      }),
    ).toEqual({ deny: ["exec"] });
  });
});
