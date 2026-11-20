import type { ChannelId } from "../channels/plugins/channel-id.types.js";
import { resolveChannelAccountKey } from "../routing/account-lookup.js";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "../routing/session-key.js";
import { mergeAccountConfig } from "./channel-account-config.js";
import type { CommonChannelGroupConfig } from "./types.channel-messaging-common.js";
import type { OpenClawConfig } from "./types.openclaw.js";

export type ChannelGroupConfig = Pick<
  CommonChannelGroupConfig,
  "requireMention" | "tools" | "toolsBySender"
> & {
  requireMentionInBotThreads?: boolean;
  ingest?: boolean;
};

export type ChannelGroups = Record<string, ChannelGroupConfig>;

export function resolveGroupAccountKey(
  accounts: Record<string, unknown> | undefined,
  channel: ChannelId,
  accountId?: string | null,
  normalizeAccountKey?: (key: string) => string,
): string | undefined {
  const id = normalizeAccountId(accountId);
  const key = resolveChannelAccountKey(accounts, id, channel);
  if (key !== undefined || !normalizeAccountKey || !accounts || id === DEFAULT_ACCOUNT_ID) {
    return key;
  }
  // Only recover an unambiguous named alias. Colliding rows keep their existing policy.
  const alias = resolveChannelAccountKey(accounts, id, channel, normalizeAccountKey);
  if (alias === undefined) {
    return undefined;
  }
  const target = normalizeAccountKey(id);
  return Object.keys(accounts).some(
    (other) => other !== alias && normalizeAccountKey(other) === target,
  )
    ? undefined
    : alias;
}

export function resolveChannelGroups(
  cfg: OpenClawConfig,
  channel: ChannelId,
  accountId?: string | null,
  normalizeAccountKey?: (key: string) => string,
): ChannelGroups | undefined {
  const channelConfig:
    | {
        accounts?: Record<string, { groups?: ChannelGroups }>;
        groups?: ChannelGroups;
      }
    | undefined = cfg.channels?.[channel];
  if (!channelConfig) {
    return undefined;
  }
  const key = resolveGroupAccountKey(
    channelConfig.accounts,
    channel,
    accountId,
    normalizeAccountKey,
  );
  // Single-account empty maps inherit; in multi-account setups they opt out.
  return mergeAccountConfig({
    channelConfig,
    accountConfig: key === undefined ? undefined : channelConfig.accounts?.[key],
    inheritEmptyKeys:
      Object.keys(channelConfig.accounts ?? {}).length > 1 ? {} : { groups: "object" },
  }).groups;
}
