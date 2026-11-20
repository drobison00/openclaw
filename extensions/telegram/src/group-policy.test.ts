import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import { describe, expect, it } from "vitest";
import {
  resolveTelegramGroupToolPolicy,
  resolveTelegramGroupRequireMention,
} from "./group-policy.js";

describe("resolveTelegramGroupRequireMention", () => {
  const cfg = {
    channels: {
      telegram: {
        groups: { "*": { requireMention: true } },
        accounts: {
          Work: {
            groups: {
              "-100123": {
                requireMention: false,
                topics: { "7": { requireMention: true } },
              },
            },
          },
        },
      },
    },
  } as OpenClawConfig;

  it("reads groups from a mixed-case account key", () => {
    expect(resolveTelegramGroupRequireMention({ cfg, groupId: "-100123", accountId: "work" })).toBe(
      false,
    );
    expect(
      resolveTelegramGroupRequireMention({
        cfg,
        groupId: "-100123:topic:7",
        accountId: "work",
      }),
    ).toBe(true);
  });
});

it.each(["ops.team", "Ops Team", "ops-team"])("uses the group tool deny stored under %s", (key) => {
  const cfg: OpenClawConfig = {
    channels: {
      telegram: {
        groups: { "*": { tools: { allow: ["read"] } } },
        accounts: { [key]: { groups: { "-1001": { tools: { deny: ["read"] } } } } },
      },
    },
  };
  expect(resolveTelegramGroupToolPolicy({ cfg, accountId: "ops-team", groupId: "-1001" })).toEqual({
    deny: ["read"],
  });
});
