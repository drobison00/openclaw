import { describe, expect, it } from "vitest";
import { resolveAccountKey as key } from "../plugin-sdk/account-resolution.js";
import { withPluginMetadataSnapshotScope } from "../plugins/current-plugin-metadata-snapshot.js";
import { projectPluginMetadataSnapshot } from "../plugins/plugin-metadata-snapshot.js";
import { createPluginMetadataSnapshotFixture } from "../plugins/plugin-metadata.test-support.js";
import { normalizeAccountId as normalizeRoutingAccountId } from "./account-id.js";
import { resolveAccountEntry, resolveNormalizedAccountEntry } from "./account-lookup.js";

describe("SDK resolveAccountKey channel context", () => {
  const accounts = { "Work Phone": { account: "+12025550103" } };
  const phone = { channelId: "phone" };
  const snapshot = createPluginMetadataSnapshotFixture({
    plugins: [
      {
        id: "phone-owner",
        channels: ["phone"],
        channelAccountKeyPolicies: { phone: { canonicalAliasesRequireOwnField: "account" } },
      },
    ],
  });

  it("selects the prepared policy without changing plain or explicit-policy lookups", () => {
    withPluginMetadataSnapshotScope(snapshot, () => {
      expect(key(accounts, "work-phone")).toBeUndefined();
      expect(key(accounts, "WORK PHONE")).toBe("Work Phone");
      expect(key(accounts, "work-phone", undefined, undefined, phone)).toBe("Work Phone");
      expect(
        key(accounts, "work-phone", undefined, undefined, {
          channelId: "other",
        }),
      ).toBeUndefined();
      expect(
        key(accounts, "work-phone", undefined, { canonicalAliasesRequireOwnField: "token" }, phone),
      ).toBeUndefined();
      expect(key(accounts, "work-phone", normalizeRoutingAccountId)).toBe("Work Phone");
      expect(key(accounts, "work-phone", () => "different", undefined, phone)).toBe("Work Phone");
    });
  });

  it("ranks exact, case-only, then canonical keys under the selected owner's policy", () => {
    const canonical = { canonicalAliases: "always" } as const;
    const aliases = { "Work.Phone": {}, "Work Phone": {} };
    const select = (entries: Record<string, object>, id: string) =>
      key(entries, "work-phone", undefined, undefined, { channelId: id });
    const owner = createPluginMetadataSnapshotFixture({
      plugins: [
        {
          id: "fixture",
          channels: ["chat", "signal", "telegram"],
          channelAccountKeyPolicies: {
            chat: canonical,
            signal: { canonicalAliasesRequireOwnField: "account" },
          },
        },
      ],
    });
    withPluginMetadataSnapshotScope(owner, () => {
      expect(select(aliases, "chat")).toBe("Work.Phone");
      const withCase = { ...aliases, "WORK-PHONE": {} };
      expect(select(withCase, "chat")).toBe("WORK-PHONE");
      expect(select({ ...withCase, "work-phone": {} }, "chat")).toBe("work-phone");
      expect(select(aliases, "signal")).toBeUndefined();
      expect(select({ ...aliases, "Work Phone": { account: "+12025550100" } }, "signal")).toBe(
        "Work Phone",
      );
      expect(select(aliases, "telegram")).toBeUndefined();
    });
  });

  it("recovers omitted owners while honoring a scoped owner's missing declaration", () => {
    const full = createPluginMetadataSnapshotFixture({
      plugins: [
        {
          id: "declaring",
          channels: ["telegram", "external"],
          channelAccountKeyPolicies: {
            telegram: { canonicalAliases: "always" },
            external: { canonicalAliases: "always" },
          },
        },
        { id: "replacement", channels: ["telegram"] },
      ],
    });
    const replacement = projectPluginMetadataSnapshot(full, ["replacement"]);
    const empty = projectPluginMetadataSnapshot(replacement, []);
    for (const view of [replacement, empty]) {
      withPluginMetadataSnapshotScope(view, () => {
        expect(key(accounts, "work-phone", undefined, undefined, { channelId: "external" })).toBe(
          "Work Phone",
        );
        expect(
          key(accounts, "work-phone", undefined, undefined, { channelId: "telegram" }),
        ).toBeUndefined();
      });
    }
  });

  it("uses channel policy for missing targets and rejects reserved creation through the public entry", () => {
    withPluginMetadataSnapshotScope(snapshot, () => {
      const missing = { ...phone, allowMissing: true };
      expect(key(undefined, "New Phone", undefined, undefined, missing)).toBe("new-phone");
      expect(
        key(undefined, "New Phone", undefined, undefined, {
          allowMissing: true,
        }),
      ).toBe("New Phone");
      for (const accountId of ["constructor", "__proto__", "prototype"]) {
        expect(() => key(accounts, accountId, undefined, undefined, missing)).toThrow(
          `Account id "${accountId}" is reserved`,
        );
      }
    });
  });
});

it("resolves an exact account key", () => {
  expect(resolveAccountEntry({ default: { id: "default" } }, "default")).toEqual({ id: "default" });
});

it("ignores prototype-chain values", () => {
  expect(
    resolveAccountEntry(Object.create({ default: { id: "polluted" } }), "default"),
  ).toBeUndefined();
});
it("resolves normalized account keys with a custom normalizer", () => {
  expect(
    resolveNormalizedAccountEntry({ "Ops Team": { id: "ops" } }, "ops-team", (id) =>
      id.trim().toLowerCase().replaceAll(" ", "-"),
    ),
  ).toEqual({ id: "ops" });
});

it.each([
  ["blocked raw keys", "__proto__", "default", normalizeRoutingAccountId],
  [
    "keys normalizing to blocked keys",
    "constructor ",
    "constructor",
    (id: string) => id.trim().toLowerCase(),
  ],
  ["invalid raw keys via default fallback", "constructor ", "default", normalizeRoutingAccountId],
] as const)("does not resolve %s", (_name, rawKey, accountId, normalize) => {
  expect(
    resolveNormalizedAccountEntry({ [rawKey]: { id: "blocked" } }, accountId, normalize),
  ).toBeUndefined();
});
