import {
  mergeAccountConfig,
  normalizeAccountId,
  type OpenClawConfig,
} from "openclaw/plugin-sdk/account-core";
import { resolveAccountKey } from "openclaw/plugin-sdk/account-resolution";
import type { TelegramAccountConfig } from "openclaw/plugin-sdk/config-contracts";

export function resolveTelegramAccountConfig(
  cfg: OpenClawConfig | undefined,
  accountId: string,
): TelegramAccountConfig | undefined {
  const accounts = cfg?.channels?.telegram?.accounts;
  if (!accounts || Array.isArray(accounts)) {
    return undefined;
  }
  const key = resolveAccountKey(accounts, normalizeAccountId(accountId), undefined, undefined, {
    channelId: "telegram",
  });
  return key === undefined ? undefined : accounts[key];
}

export function mergeTelegramAccountConfig(
  cfg: OpenClawConfig,
  accountId: string,
): TelegramAccountConfig {
  const channelConfig = cfg.channels?.telegram;
  // Empty groups retain their shipped single-account inheritance behavior;
  // multiple accounts can explicitly opt out with an empty map.
  const isMultiAccount = Object.keys(channelConfig?.accounts ?? {}).length > 1;
  return mergeAccountConfig<TelegramAccountConfig>({
    channelConfig,
    accountConfig: resolveTelegramAccountConfig(cfg, accountId),
    omitKeys: ["defaultAccount"],
    inheritEmptyKeys: { capabilities: "array", ...(isMultiAccount ? {} : { groups: "object" }) },
    preserveRootAllowFrom: true,
  });
}

export function resolveTelegramLegacyWebhookListener(
  configured: TelegramAccountConfig["legacyWebhook"],
): { port: number; host: string } | undefined {
  if (!configured) {
    return undefined;
  }
  return { port: configured.port, host: configured.host ?? "127.0.0.1" };
}
