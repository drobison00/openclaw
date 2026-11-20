import {
  mergeAccountConfig,
  normalizeAccountId,
  type OpenClawConfig,
} from "openclaw/plugin-sdk/account-core";
import { resolveAccountKey } from "openclaw/plugin-sdk/account-resolution";
import type { TelegramAccountConfig } from "openclaw/plugin-sdk/config-contracts";

export function resolveTelegramAccountConfigKey(
  accounts: Record<string, TelegramAccountConfig> | undefined,
  accountId: string,
): string | undefined {
  if (!accounts || Array.isArray(accounts)) {
    return undefined;
  }
  return resolveAccountKey(accounts, normalizeAccountId(accountId), undefined, undefined, {
    channelId: "telegram",
  });
}

export function resolveTelegramAccountConfig(
  cfg: OpenClawConfig | undefined,
  accountId: string,
): TelegramAccountConfig | undefined {
  const accounts = cfg?.channels?.telegram?.accounts;
  const key = resolveTelegramAccountConfigKey(accounts, accountId);
  return key === undefined ? undefined : accounts?.[key];
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
