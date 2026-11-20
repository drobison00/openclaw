import { resolveChannelConfigWrites } from "openclaw/plugin-sdk/channel-config-writes";
import { createPluginRuntimeMock } from "openclaw/plugin-sdk/channel-test-helpers";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withChannelAccountKeyScope } from "../../../test/helpers/channel-account-key-scope.js";
import { TlonConfigSchema } from "./config-schema.js";
import { resolveChannelAuthorization } from "./monitor/authorization.js";
import { prepareTlonGroupAdmission } from "./monitor/mentions.js";
import {
  resolveTlonCommandAuthorizationWithIngress,
  isDmAllowedWithIngress,
  isGroupInviteAllowed,
  isBotMentioned,
  extractMessageText,
} from "./monitor/utils.js";
import { setTlonRuntime } from "./runtime.js";
import { resolveTlonAccount } from "./types.js";

beforeEach(() => setTlonRuntime(createPluginRuntimeMock()));

describe.each([
  { label: "DM allowlist", isAllowed: isDmAllowedWithIngress },
  { label: "group invite allowlist", isAllowed: isGroupInviteAllowed },
])("Security: $label", ({ isAllowed }) => {
  it.each([
    ["partial matches", ["~zod-extra", "~extra-zod"], ["~zod"], false],
    ["empty allowlist", ["~zod", "~sampel-palnet"], [], false],
    ["absent allowlist", ["~zod", "~sampel-palnet"], undefined, false],
    ["normalized whitespace", ["~zod", " ~zod "], [" ~zod ", "~bus"], true],
  ] satisfies Array<[string, string[], string[] | undefined, boolean]>)(
    "checks %s",
    async (_name, senders, allowlist, allowed) => {
      for (const sender of senders) {
        expect(await isAllowed(sender, allowlist)).toBe(allowed);
      }
    },
  );
});

it.each([
  ["~zod", "zod", true],
  ["~nec", "~zod", false],
] as const)("authorizes %s with owner %s: %s", async (senderShip, ownerShip, authorized) => {
  const { commandAccess } = await resolveTlonCommandAuthorizationWithIngress({
    senderShip,
    ownerShip,
  });
  expect(commandAccess).toMatchObject({
    requested: true,
    authorized,
    shouldBlockControlCommand: false,
  });
  if (authorized) {
    expect(commandAccess.reasonCode).toBe("command_authorized");
  }
});

const zod = { ship: "~zod" };
it.each([
  [[["@ALL"], [zod, ","], [{ bold: [zod] }], [{ strike: [zod] }], ["nimbus:"]], true],
  [[["nimbus,"], ["x ", { italics: [zod] }, "."], ["x ", zod, "?"], [{ bold: ["nimbus"] }]], true],
  [[[{ "inline-code": "a`b" }, " ", zod, " hi ", { "inline-code": "c" }]], true],
  [[["~zod-extra"], ["my~zodfriend"], [{ "inline-code": "ping ~zod, now" }], ["nimbusy"]], false],
  [[["https://tlon.io/~zod"], ["prenimbus"], [], { block: { code: { code: "~zod, hi" } } }], false],
] as const)("detects mentions in Story %j", (stories, expected) => {
  for (const story of stories) {
    const content = Array.isArray(story) ? [{ inline: story }] : [story];
    expect(isBotMentioned(extractMessageText(content, true), "~zod", "nimbus")).toBe(expected);
  }
});

const implicitMentions = { threadParticipation: false };
const namedAccountChannel = {
  defaultAuthorizedShips: ["~nec"],
  accounts: { "Ops.Team": { implicitMentions } },
};

function threadAdmission(cfg: OpenClawConfig, accountId: string, explicit: boolean) {
  return prepareTlonGroupAdmission({
    cfg,
    account: { accountId },
    api: { scry: async () => ({}) },
    channelNest: "chat/~host/general",
    senderShip: "~nec",
    isOwner: () => false,
    botShipName: "~zod",
    botNickname: null,
    messageContent: [{ inline: [explicit ? "~zod follow up" : "follow up"] }],
    messageSeal: { "parent-id": "1234" },
    isThreadReply: true,
    hasParticipatedInThread: (parentId) => parentId === "1234",
    getSettings: () => ({}),
    runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
  });
}

it.each([
  { label: "absent channel", cfg: {}, explicit: false, senderAllowed: false },
  {
    label: "channel opt-out",
    cfg: { channels: { tlon: { implicitMentions } } },
    explicit: true,
    senderAllowed: false,
  },
  {
    label: "sibling account opt-out",
    cfg: { channels: { tlon: namedAccountChannel } },
    explicit: false,
    senderAllowed: true,
  },
  {
    label: "channel and sibling opt-outs",
    cfg: { channels: { tlon: { ...namedAccountChannel, implicitMentions } } },
    explicit: true,
    senderAllowed: true,
  },
])(
  "checks the default account's thread mention with $label",
  async ({ cfg, explicit, senderAllowed }) => {
    const admission = await threadAdmission(cfg, "default", explicit);
    expect(admission.senderAllowed).toBe(senderAllowed);
    expect(admission.mentionDecision).toMatchObject({
      shouldSkip: false,
      ...(explicit
        ? { effectiveWasMentioned: true }
        : { matchedImplicitMentionKinds: ["bot_thread_participant"] }),
    });
  },
);

it("keeps the root ship's admission and write policy for a default-shaped alias", async () => {
  const tlon = {
    ship: "~zod",
    defaultAuthorizedShips: ["~nec"],
    implicitMentions,
    configWrites: false,
    accounts: {
      "Default.": {
        ship: "~bus",
        implicitMentions: { threadParticipation: true },
        configWrites: true,
      },
    },
  };
  expect(TlonConfigSchema.safeParse(tlon).success).toBe(true);
  const cfg = { channels: { tlon } };
  const account = resolveTlonAccount(cfg, "default");
  expect(account.ship).toBe(tlon.ship);
  const admission = await threadAdmission(cfg, account.accountId, false);
  expect(admission.senderAllowed).toBe(true);
  expect(admission.mentionDecision.shouldSkip).toBe(true);
  expect(admission.isAdmissionAllowed()).toBe(false);
  expect(resolveChannelConfigWrites({ cfg, channelId: "tlon", accountId: account.accountId })).toBe(
    false,
  );
});

it.each(["default", "DEFAULT"])(
  "honors admission and write restrictions on accounts.%s",
  async (key) => {
    const tlon = {
      ship: "~zod",
      defaultAuthorizedShips: ["~nec"],
      configWrites: true,
      implicitMentions: { threadParticipation: true },
      accounts: { [key]: { ship: "~bus", configWrites: false, implicitMentions } },
    };
    expect(TlonConfigSchema.safeParse(tlon).success).toBe(true);
    const cfg = { channels: { tlon } };
    const account = resolveTlonAccount(cfg, "default");
    expect(account.ship).toBe(tlon.ship);
    const admission = await threadAdmission(cfg, account.accountId, false);
    expect(admission.senderAllowed).toBe(true);
    expect(admission.isAdmissionAllowed()).toBe(false);
    expect(
      resolveChannelConfigWrites({ cfg, channelId: "tlon", accountId: account.accountId }),
    ).toBe(false);
  },
);

it.each(["direct", "projected"] as const)(
  "honors the named account's thread participation opt-out (%s)",
  async (scope) => {
    const cfg = { channels: { tlon: namedAccountChannel } };
    const admission = await withChannelAccountKeyScope(scope, "tlon", () =>
      threadAdmission(cfg, "ops-team", false),
    );
    expect(admission.senderAllowed).toBe(true);
    expect(admission.mentionDecision.shouldSkip).toBe(true);
    expect(admission.isAdmissionAllowed()).toBe(false);
  },
);

it.each([
  [{ sect: null }, "@all"],
  [{ ship: "~zod" }, "~zod"],
] as const)("extracts mention %j", (mention, expected) => {
  expect(extractMessageText([{ inline: [mention] }])).toBe(expected);
});

it("handles malformed message content safely", () => {
  for (const content of [null, undefined, [], [{}], "not an array"]) {
    expect(extractMessageText(content)).toBe("");
  }
});

describe("Security: Channel Authorization Logic", () => {
  const channelNest = "chat/~zod/test";
  const channelConfig = (
    rule: { mode?: "restricted"; allowedShips: string[] },
    defaultAuthorizedShips?: string[],
  ) => ({
    channels: {
      tlon: {
        defaultAuthorizedShips,
        authorization: { channelRules: { [channelNest]: rule } },
      },
    },
  });

  it.each([
    ["unconfigured channel", {}],
    ["explicit empty allowlist overriding defaults", channelConfig({ allowedShips: [] }, ["~zod"])],
  ] as const)("restricts %s", (_name, cfg) => {
    expect(resolveChannelAuthorization(cfg, channelNest)).toEqual({
      mode: "restricted",
      allowedShips: [],
    });
  });

  it("prefers settings channel rules over conflicting file configuration", () => {
    expect(
      resolveChannelAuthorization(
        channelConfig({ mode: "restricted", allowedShips: ["~zod"] }),
        channelNest,
        { channelRules: { [channelNest]: { mode: "open", allowedShips: ["~bus"] } } },
      ),
    ).toEqual({ mode: "open", allowedShips: ["~bus"] });
  });
});

it("empty strings are not valid ships", async () => {
  expect(await isDmAllowedWithIngress("", ["~zod"])).toBe(false);
  expect(await isDmAllowedWithIngress("~zod", [""])).toBe(false);
});
