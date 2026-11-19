import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import { expectDefined } from "openclaw/plugin-sdk/expect-runtime";
import { resolveTelegramAccountConfig } from "./account-config.js";

export function migrateTelegramGroupConfig(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
  oldChatId: string;
  newChatId: string;
}) {
  let migrated = false;
  let skippedExisting = false;

  const migrationTargets = [
    params.accountId
      ? resolveTelegramAccountConfig(params.cfg, params.accountId)?.groups
      : undefined,
    params.cfg.channels?.telegram?.groups,
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
