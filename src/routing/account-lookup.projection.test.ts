import { expect, it } from "vitest";
import { resolveChannelGroupToolsPolicy } from "../config/group-policy.js";
import { withPluginMetadataSnapshotScope } from "../plugins/current-plugin-metadata-snapshot.js";
import {
  createPluginCache,
  invalidatePluginCacheMetadata,
  withPluginCache,
} from "../plugins/plugin-cache.js";
import {
  projectPluginMetadataSnapshot,
  rebasePluginMetadataSnapshotManifestRegistry,
  type PluginMetadataSnapshot,
} from "../plugins/plugin-metadata-snapshot.js";
import { createPluginMetadataSnapshotFixture } from "../plugins/plugin-metadata.test-support.js";

const rootTools = { deny: ["fixture"] };
const accountTools = { allow: ["fixture"] };

function groupTools(snapshot: PluginMetadataSnapshot, channel: string) {
  const cfg = {
    channels: {
      [channel]: {
        groups: { "*": { tools: rootTools } },
        accounts: {
          "Lab.West": { account: "+12025550100", groups: { room: { tools: accountTools } } },
        },
      },
    },
  };
  return withPluginMetadataSnapshotScope(snapshot, () =>
    resolveChannelGroupToolsPolicy({ cfg, channel, accountId: "lab-west", groupId: "room" }),
  );
}

it("keeps Signal's root tool deny when a projection omits its field-gated policy", () => {
  const full = createPluginMetadataSnapshotFixture({
    plugins: [
      {
        id: "signal",
        channels: ["signal"],
        channelAccountKeyPolicies: { signal: { canonicalAliasesRequireOwnField: "account" } },
      },
    ],
  });
  expect(groupTools(full, "signal")).toEqual(accountTools);
  expect(groupTools(projectPluginMetadataSnapshot(full, []), "signal")).toEqual(rootTools);
});

it.each([false, true])(
  "never recovers a disabled owner's declaration (active competitor: %s)",
  (hasCompetitor) => {
    const full = createPluginMetadataSnapshotFixture({
      plugins: [
        ...(hasCompetitor ? [{ id: "active", channels: ["fixture"] }] : []),
        {
          id: "disabled",
          channels: ["fixture"],
          origin: "global",
          channelAccountKeyPolicies: { fixture: { canonicalAliases: "always" } },
        },
      ],
    });
    const index = {
      ...full.index,
      plugins: full.index.plugins.map((plugin) =>
        plugin.pluginId === "disabled" ? { ...plugin, enabled: false } : plugin,
      ),
    };
    const rebased = rebasePluginMetadataSnapshotManifestRegistry(
      { ...full, index, registryIndex: index },
      full.manifestRegistry,
    );
    const source = hasCompetitor ? projectPluginMetadataSnapshot(rebased, ["disabled"]) : rebased;
    expect(groupTools(projectPluginMetadataSnapshot(source, []), "fixture")).toEqual(rootTools);
  },
);

it("retains the root tool deny when a projection loses its link to a replacement owner", () => {
  const cache = createPluginCache();
  const view = withPluginCache(cache, () =>
    projectPluginMetadataSnapshot(
      createPluginMetadataSnapshotFixture({
        plugins: [{ id: "replacement", channels: ["telegram"] }],
      }),
      [],
    ),
  );
  expect(groupTools(view, "telegram")).toEqual(rootTools);
  invalidatePluginCacheMetadata(cache);
  expect(groupTools(view, "telegram")).toEqual(rootTools);
});
