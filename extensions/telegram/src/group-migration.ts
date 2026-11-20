import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import { expectDefined } from "openclaw/plugin-sdk/expect-runtime";
import { resolveTelegramAccountConfigKey } from "./account-config.js";

export function migrateTelegramGroupConfig(
  params: ({ accountKey: string | undefined } | { accountId?: string | null }) & {
    cfg: OpenClawConfig;
    oldChatId: string;
    newChatId: string;
  },
) {
  let migrated = false;
  let skippedExisting = false;

  const channel = params.cfg.channels?.telegram;
  const accountKey =
    "accountKey" in params
      ? params.accountKey
      : params.accountId && resolveTelegramAccountConfigKey(channel?.accounts, params.accountId);
  const migrationTargets = [
    accountKey ? channel?.accounts?.[accountKey]?.groups : undefined,
    channel?.groups,
  ];

  const { oldChatId, newChatId } = params;
  for (const groups of migrationTargets) {
    if (!groups || oldChatId === newChatId || !Object.hasOwn(groups, oldChatId)) {
      continue;
    }
    if (Object.hasOwn(groups, newChatId)) {
      skippedExisting = true;
      continue;
    }
    groups[newChatId] = expectDefined(groups[oldChatId], "owned Telegram group config key");
    delete groups[oldChatId];
    migrated = true;
  }

  return { migrated, skippedExisting };
}
