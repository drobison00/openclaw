import { asOptionalRecord } from "@openclaw/normalization-core/record-coerce";
import {
  normalizeLowercaseStringOrEmpty,
  normalizeOptionalString,
} from "@openclaw/normalization-core/string-coerce";
import { BUNDLED_CANONICAL_ACCOUNT_KEY_CHANNELS } from "../channels/bundled-channel-ids.generated.js";
import { isBlockedObjectKey } from "../infra/prototype-keys.js";
import { snapshotReaderSlot } from "../plugins/plugin-metadata-snapshot-readers.js";
import {
  DEFAULT_ACCOUNT_ID,
  normalizeAccountId as normalizeRoutingAccountId,
  normalizeOptionalAccountId,
} from "./account-id.js";

export type ChannelAccountKeyPolicy =
  | { canonicalAliasesRequireOwnField: string; canonicalAliases?: never }
  | { canonicalAliases: "always"; canonicalAliasesRequireOwnField?: never };

function hasOwnAliasField(value: unknown, field: string): boolean {
  const entry = asOptionalRecord(value);
  return Boolean(entry && Object.hasOwn(entry, field) && normalizeOptionalString(entry[field]));
}

export function resolveChannelAccountKeyPolicy(
  channelId: string,
): ChannelAccountKeyPolicy | undefined {
  const snapshot = snapshotReaderSlot.getCurrentPluginMetadataSnapshot?.({
    allowScopedSnapshot: true,
    allowWorkspaceScopedSnapshot: true,
  });
  if (!snapshot) {
    return BUNDLED_CANONICAL_ACCOUNT_KEY_CHANNELS.includes(channelId)
      ? { canonicalAliases: "always" }
      : undefined;
  }
  const scopedPolicy = snapshot.owners.channelAccountKeyPolicies?.get(channelId);
  if (scopedPolicy || snapshot.owners.channels.has(channelId)) {
    return scopedPolicy;
  }
  // An omitted owner can supply only its enabled, unconditional alias policy.
  // Stop at the nearest owner, even if its declaration is absent or ineligible.
  let view = snapshot;
  while (view.pluginIds) {
    const source = snapshotReaderSlot.getPluginMetadataProjectionSource?.(view);
    if (!source) {
      break;
    }
    if (source.owners.channels.has(channelId)) {
      return source.owners.enabledCanonicalAccountKeyChannels?.has(channelId)
        ? source.owners.channelAccountKeyPolicies?.get(channelId)
        : undefined;
    }
    view = source;
  }
  return undefined;
}

/** Uses the prepared channel owner policy; discovery and account state stay outside lookup. */
export function resolveChannelAccountKey<T>(
  accounts: Record<string, T> | undefined,
  accountId: string,
  channelId: string,
  normalizeAccountId: ((accountId: string) => string) | undefined,
  accountKeyPolicy: ChannelAccountKeyPolicy | undefined,
  options: { allowMissing: true },
): string;
export function resolveChannelAccountKey<T>(
  accounts: Record<string, T> | undefined,
  accountId: string,
  channelId: string,
  normalizeAccountId?: (accountId: string) => string,
  accountKeyPolicy?: ChannelAccountKeyPolicy,
  options?: { allowMissing?: boolean },
): string | undefined;
export function resolveChannelAccountKey<T>(
  accounts: Record<string, T> | undefined,
  accountId: string,
  channelId: string,
  normalizeAccountId?: (accountId: string) => string,
  accountKeyPolicy?: ChannelAccountKeyPolicy,
  options?: { allowMissing?: boolean },
): string | undefined {
  return resolveAccountKey(accounts, accountId, normalizeAccountId, accountKeyPolicy, {
    ...options,
    channelId,
  });
}

export function resolveChannelAccountEntry<T>(
  accounts: Record<string, T> | undefined,
  accountId: string,
  channelId: string,
  normalizeAccountId?: (accountId: string) => string,
  accountKeyPolicy?: ChannelAccountKeyPolicy,
): T | undefined {
  const key = resolveChannelAccountKey(
    accounts,
    accountId,
    channelId,
    normalizeAccountId,
    accountKeyPolicy,
  );
  return key === undefined ? undefined : accounts?.[key];
}

// Case-insensitive account lookup for config maps that may preserve user
// casing. Exact keys win so callers can still distinguish intentional entries.
export function resolveAccountEntry<T>(
  accounts: Record<string, T> | undefined,
  accountId: string,
): T | undefined {
  const key = resolveAccountKey(accounts, accountId);
  return key === undefined ? undefined : accounts?.[key];
}

// Lookup variant for account ids with a channel-specific normalization rule.
// Used when config keys should match the same canonical id as routing state.
export function resolveNormalizedAccountEntry<T>(
  accounts: Record<string, T> | undefined,
  accountId: string,
  normalizeAccountId: (accountId: string) => string,
  policy?: ChannelAccountKeyPolicy,
): T | undefined {
  const key = resolveAccountKey(accounts, accountId, normalizeAccountId, policy);
  return key === undefined ? undefined : accounts?.[key];
}

/** Select the stored spelling once for account readers and writers; exact keys win. */
export function resolveAccountKey<T>(
  accounts: Record<string, T> | undefined,
  accountId: string,
  normalizeAccountId?: (accountId: string) => string,
  policy?: ChannelAccountKeyPolicy,
  options?: { allowMissing?: boolean; channelId?: string },
): string | undefined {
  const effectivePolicy =
    policy ?? (options?.channelId ? resolveChannelAccountKeyPolicy(options.channelId) : undefined);
  const requiredField = effectivePolicy?.canonicalAliasesRequireOwnField;
  // Field-gated owners retain their existing canonical target and field check.
  let normalizer = requiredField === undefined ? normalizeAccountId : normalizeRoutingAccountId;
  let targetId = requiredField === undefined ? accountId : normalizeRoutingAccountId(accountId);
  if (
    options?.allowMissing &&
    (isBlockedObjectKey(normalizeLowercaseStringOrEmpty(accountId)) ||
      (normalizer && isBlockedObjectKey(normalizer(accountId))))
  ) {
    throw new Error(`Account id "${accountId}" is reserved. Choose a different account id.`);
  }
  const entries = accounts && typeof accounts === "object" ? accounts : undefined;
  if (
    entries &&
    Object.hasOwn(entries, targetId) &&
    (!normalizer || !isBlockedObjectKey(targetId))
  ) {
    return targetId;
  }
  if (effectivePolicy?.canonicalAliases === "always" && !normalizeAccountId) {
    const namedId = normalizeOptionalAccountId(accountId);
    if (namedId && namedId !== DEFAULT_ACCOUNT_ID) {
      if (entries && Object.hasOwn(entries, namedId)) {
        return namedId;
      }
      targetId = namedId;
      normalizer = normalizeRoutingAccountId;
    }
  }
  // Creation uses the owner's target id, never the spelling of a rejected alias.
  const missingKey = options?.allowMissing ? targetId : undefined;
  if (!entries) {
    return missingKey;
  }
  const normalize = normalizer ?? normalizeLowercaseStringOrEmpty;
  const normalized = normalize(targetId);
  const lowercaseTarget = normalizeLowercaseStringOrEmpty(targetId);
  let canonicalMatch: string | undefined;
  for (const key of Object.keys(entries)) {
    if (normalizer && isBlockedObjectKey(key)) {
      continue;
    }
    // Only field-gated policies give case-only matches priority over earlier aliases.
    if (requiredField !== undefined && normalizeLowercaseStringOrEmpty(key) === lowercaseTarget) {
      return key;
    }
    const candidate = normalize(key);
    if (
      (!normalizer ||
        (Boolean(normalizeOptionalAccountId(key)) && !isBlockedObjectKey(candidate))) &&
      candidate === normalized
    ) {
      if (requiredField === undefined) {
        return key;
      }
      if (canonicalMatch === undefined && hasOwnAliasField(entries[key], requiredField)) {
        canonicalMatch = key;
      }
    }
  }
  return canonicalMatch ?? missingKey;
}
