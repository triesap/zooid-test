import {afterAll, beforeAll, describe, expect, it} from "vitest"
import {PublishStatus} from "@welshman/net"
import {makeEvent} from "@welshman/util"
import {createTestClient, type TestClient} from "../testing/client.js"
import {loadSecondaryConfig, loadTestConfig, type TestConfig} from "../testing/config.js"

const RELAY_JOIN = 28934
const RELAY_INVITE = 28935
const RELAY_MEMBERS = 13534
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
  await triggerAuth(client)
  const invites = await client.fetchEvents([{kinds: [RELAY_INVITE]}])
  const withClaim = invites.filter(event => event.tags?.some(tag => tag[0] === "claim"))
  const candidates = withClaim.filter(event =>
    event.tags?.some(tag => tag[0] === "p" && tag[1] === adminPubkey),
  )
  const pool = candidates.length ? candidates : withClaim
  const invite = pool.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0]
  const claimTag = invite?.tags?.find(tag => tag[0] === "claim")

  if (!claimTag?.[1]) {
    throw new Error(`Invite claim not found (invites: ${invites.length}).`)
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
    let claim: string
    try {
      claim = await getInviteClaim(admin, adminPubkey)
    } catch (error) {
      if (attempt < attempts - 1) {
        await sleep(150)
        continue
      }
      throw error
    }
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

const hasMember = async (client: TestClient, pubkey: string) => {
  const lists = await client.fetchEvents([{kinds: [RELAY_MEMBERS]}])
  return lists.some(event => event.tags?.some(tag => tag[0] === "member" && tag[1] === pubkey))
}

const waitForMember = async (client: TestClient, pubkey: string) => {
  const deadline = Date.now() + 3000

  while (Date.now() < deadline) {
    if (await hasMember(client, pubkey)) {
      return
    }
    await sleep(150)
  }

  throw new Error("Member was not added to RELAY_MEMBERS list.")
}

const ensureMemberJoined = async (
  admin: TestClient,
  member: TestClient,
  adminPubkey: string,
  memberPubkey: string,
) => {
  if (await hasMember(admin, memberPubkey)) {
    return
  }

  await triggerAuth(member)
  await joinWithClaimRetry(admin, member, adminPubkey)
  await waitForMember(admin, memberPubkey)
}

describe("relay members list", () => {
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

  it("includes joined members", async () => {
    await ensureMemberJoined(
      adminClient,
      memberClient,
      adminConfig.pubkey,
      memberConfig.pubkey,
    )

    const listed = await hasMember(adminClient, memberConfig.pubkey)
    expect(listed).toBe(true)
  })
})
