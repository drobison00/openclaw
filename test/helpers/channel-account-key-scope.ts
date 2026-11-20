import { fileURLToPath } from "node:url";
import { withPluginMetadataSnapshotScope } from "../../src/plugins/current-plugin-metadata-snapshot.js";
import { loadPluginManifest } from "../../src/plugins/manifest.js";
import {
  createPluginCache,
  invalidatePluginCacheMetadata,
  withPluginCache,
} from "../../src/plugins/plugin-cache.js";
import {
  projectPluginMetadataSnapshot,
  restorePluginMetadataSnapshot,
} from "../../src/plugins/plugin-metadata-snapshot.js";
import { createPluginMetadataSnapshotFixture } from "../../src/plugins/plugin-metadata.test-support.js";

/** Run the same channel operation directly or under a view that omits its owner. */
export function withChannelAccountKeyScope<T>(
  scope: "direct" | "projected" | "restored" | "invalidated",
  pluginId: string,
  run: () => T,
): T {
  if (scope === "direct") {
    return run();
  }
  const root = fileURLToPath(new URL(`../../extensions/${pluginId}/`, import.meta.url));
  const loaded = loadPluginManifest(root);
  if (!loaded.ok) {
    throw new Error(loaded.error);
  }
  const cache = createPluginCache();
  const view = withPluginCache(cache, () =>
    projectPluginMetadataSnapshot(
      createPluginMetadataSnapshotFixture({ plugins: [loaded.manifest] }),
      [],
    ),
  );
  if (scope === "restored") {
    const { normalizePluginId: _normalizePluginId, ...portable } = view;
    return withPluginMetadataSnapshotScope(
      restorePluginMetadataSnapshot(structuredClone(portable)),
      run,
    );
  }
  if (scope === "invalidated") {
    invalidatePluginCacheMetadata(cache);
  }
  return withPluginMetadataSnapshotScope(view, run);
}
