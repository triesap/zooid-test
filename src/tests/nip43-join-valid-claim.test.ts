import {afterAll, beforeAll, describe, expect, it} from "vitest"
import {PublishStatus} from "@welshman/net"
import {makeEvent} from "@welshman/util"
import {createTestClient, type TestClient} from "../testing/client.js"
import {loadSecondaryConfig, loadTestConfig, type TestConfig} from "../testing/config.js"

const RELAY_JOIN = 28934
const RELAY_INVITE = 28935
const AUTH_PROBE_KIND = 20000

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const triggerAuth = async (client: TestClient) => {
  const probeEvent = await client.signer.sign(
    makeEvent(AUTH_PROBE_KIND, {
      content: `zooid-test auth probe ${new Date().toISOString()}`,
    }),
  )
  const result = await client.publishEvent(probeEvent)
  if (result.status === PublishStatus.Timeout) {
    throw new Error("Auth probe timed out before join.")
  }
  await sleep(150)
}

const getInviteClaim = async (client: TestClient, adminPubkey: string) => {
  const invites = await client.fetchEvents([{kinds: [RELAY_INVITE]}])
  const candidates = invites.filter(
    event =>
      event.tags?.some(tag => tag[0] === "p" && tag[1] === adminPubkey) &&
      event.tags?.some(tag => tag[0] === "claim"),
  )
  const invite = candidates.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0]
  const claimTag = invite?.tags?.find(tag => tag[0] === "claim")

  if (!claimTag?.[1]) {
    throw new Error("Invite claim not found for relay admin.")
  }

  return claimTag[1]
}

const isInviteRetryable = (detail: string) => detail.toLowerCase().includes("invite code")

const joinWithClaimRetry = async (
  admin: TestClient,
  member: TestClient,
  adminPubkey: string,
  attempts = 3,
) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const claim = await getInviteClaim(admin, adminPubkey)
    const joinEvent = await member.signer.sign(makeEvent(RELAY_JOIN, {tags: [["claim", claim]]}))
    const result = await member.publishEvent(joinEvent)

    if (result.status === PublishStatus.Success) {
      return result
    }

    const detail = result.detail ?? ""
    if (detail.toLowerCase().includes("duplicate")) {
      return result
    }

    if (isInviteRetryable(detail) && attempt < attempts - 1) {
      await sleep(150)
      continue
    }

    throw new Error(`Join failed (${result.status}): ${detail || "unknown error"}`)
  }

  throw new Error("Join failed after retries due to invalid invite code.")
}

describe("relay join with valid claim", () => {
  let adminClient: TestClient
  let memberClient: TestClient
  let adminConfig: TestConfig
  let memberConfig: TestConfig

  beforeAll(() => {
    adminConfig = loadTestConfig()
    memberConfig = loadSecondaryConfig(adminConfig.relayUrl)
    adminClient = createTestClient(adminConfig)
    memberClient = createTestClient(memberConfig)
  })

  afterAll(() => {
    adminClient?.close()
    memberClient?.close()
  })

  it("accepts a join request with a valid claim", async () => {
    await triggerAuth(memberClient)
    const result = await joinWithClaimRetry(
      adminClient,
      memberClient,
      adminConfig.pubkey,
    )

    if (result.status === PublishStatus.Success) {
      expect(result.status).toBe(PublishStatus.Success)
      return
    }

    expect(result.detail.toLowerCase()).toContain("duplicate")
  })
})
