import { fileURLToPath } from "node:url";
import { withPluginMetadataSnapshotScope } from "../../src/plugins/current-plugin-metadata-snapshot.js";
import { loadPluginManifest } from "../../src/plugins/manifest.js";
import { projectPluginMetadataSnapshot } from "../../src/plugins/plugin-metadata-snapshot.js";
import { createPluginMetadataSnapshotFixture } from "../../src/plugins/plugin-metadata.test-support.js";

/** Run the same channel operation directly or under a view that omits its owner. */
export function withChannelAccountKeyScope<T>(
  scope: "direct" | "projected",
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
  const snapshot = createPluginMetadataSnapshotFixture({ plugins: [loaded.manifest] });
  return withPluginMetadataSnapshotScope(projectPluginMetadataSnapshot(snapshot, []), run);
}
