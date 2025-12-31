import {afterAll, beforeAll, describe, expect, it} from "vitest"
import {PublishStatus} from "@welshman/net"
import {DELETE, makeEvent, type MakeEventOpts, type SignedEvent} from "@welshman/util"
import {createTestClient, type TestClient} from "../testing/client.js"
import {loadSecondaryConfig, loadTestConfig, type TestConfig} from "../testing/config.js"

const RELAY_JOIN = 28934
const RELAY_INVITE = 28935
const RELAY_MEMBERS = 13534
const AUTH_PROBE_KIND = 20000

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const withNonce = (tags: string[][] = []) => [
  ...tags,
  ["nonce", Math.random().toString(36).slice(2)],
]

const makeUniqueEvent = (kind: number, opts: MakeEventOpts = {}) =>
  makeEvent(kind, {...opts, tags: withNonce(opts.tags ?? [])})

const publishOrThrow = async (client: TestClient, event: SignedEvent) => {
  const result = await client.publishEvent(event)
  if (result.status !== PublishStatus.Success) {
    throw new Error(`Publish failed (${result.status}): ${result.detail}`)
  }
}

const waitForDeletion = async (client: TestClient, id: string) => {
  const deadline = Date.now() + 3000

  while (Date.now() < deadline) {
    const found = await client.fetchEvent(id)
    if (!found) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, 150))
  }

  throw new Error("Expected event to be deleted, but it still exists.")
}

const waitForPresence = async (client: TestClient, id: string) => {
  const deadline = Date.now() + 3000

  while (Date.now() < deadline) {
    const found = await client.fetchEvent(id)
    if (found) {
      return
    }
    await sleep(150)
  }

  throw new Error("Expected event to exist, but it was not found.")
}

const getInviteClaim = async (client: TestClient, adminPubkey: string) => {
  await triggerAuth(client)
  const invites = await client.fetchEvents([
    {
      kinds: [RELAY_INVITE],
    },
  ])

  const withClaim = invites.filter(event => event.tags?.some(tag => tag[0] === "claim"))
  const candidates = withClaim.filter(event =>
    event.tags?.some(tag => tag[0] === "p" && tag[1] === adminPubkey),
  )
  const pool = candidates.length ? candidates : withClaim
  const invite = pool.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0]
  const claimTag = invite?.tags?.find(tag => tag[0] === "claim")

  if (!claimTag || !claimTag[1]) {
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

const triggerAuth = async (client: TestClient) => {
  const probeEvent = await client.signer.sign(
    makeUniqueEvent(AUTH_PROBE_KIND, {
      content: `zooid-test auth probe ${new Date().toISOString()}`,
    }),
  )
  const result = await client.publishEvent(probeEvent)
  if (result.status === PublishStatus.Timeout) {
    throw new Error("Auth probe timed out before join.")
  }
  await sleep(150)
}

const hasMember = async (client: TestClient, pubkey: string) => {
  const lists = await client.fetchEvents([{kinds: [RELAY_MEMBERS]}])
  return lists.some(event => event.tags?.some(tag => tag[0] === "member" && tag[1] === pubkey))
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

  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    if (await hasMember(admin, memberPubkey)) {
      return
    }
    await sleep(150)
  }

  throw new Error("Invite accepted but member_1 was not added to the relay members list.")
}

describe("kind 5 deletion", () => {
  let adminClient: TestClient
  let memberClient: TestClient
  let adminConfig: TestConfig
  let memberConfig: TestConfig

  beforeAll(async () => {
    adminConfig = loadTestConfig()
    memberConfig = loadSecondaryConfig(adminConfig.relayUrl)
    adminClient = createTestClient(adminConfig)
    memberClient = createTestClient(memberConfig)
    await ensureMemberJoined(
      adminClient,
      memberClient,
      adminConfig.pubkey,
      memberConfig.pubkey,
    )
  })

  afterAll(() => {
    adminClient?.close()
    memberClient?.close()
  })

  it("adds member_1 via relay invite workflow", async () => {
    await ensureMemberJoined(
      adminClient,
      memberClient,
      adminConfig.pubkey,
      memberConfig.pubkey,
    )
  })

  it("deletes a prior kind 1 event", async () => {
    const original = await memberClient.signer.sign(
      makeUniqueEvent(1, {content: `zooid-test delete ${new Date().toISOString()}`}),
    )

    await publishOrThrow(memberClient, original)

    const fetched = await memberClient.fetchEvent(original.id)
    expect(fetched?.id).toBe(original.id)

    const deletion = await memberClient.signer.sign(
      makeUniqueEvent(DELETE, {content: "zooid-test delete", tags: [["e", original.id]]}),
    )

    await publishOrThrow(memberClient, deletion)

    await waitForDeletion(memberClient, original.id)
  })

  it("deletes multiple targets in one request", async () => {
    const eventA = await memberClient.signer.sign(
      makeUniqueEvent(1, {content: `zooid-test delete multi A ${Date.now()}`}),
    )
    const eventB = await memberClient.signer.sign(
      makeUniqueEvent(1, {content: `zooid-test delete multi B ${Date.now()}`}),
    )

    await publishOrThrow(memberClient, eventA)
    await publishOrThrow(memberClient, eventB)

    const deletion = await memberClient.signer.sign(
      makeUniqueEvent(DELETE, {tags: [["e", eventA.id], ["e", eventB.id]]}),
    )

    await publishOrThrow(memberClient, deletion)

    await waitForDeletion(memberClient, eventA.id)
    await waitForDeletion(memberClient, eventB.id)
  })

  it("deletes valid targets even if a prior tag is missing", async () => {
    const event = await memberClient.signer.sign(
      makeUniqueEvent(1, {content: `zooid-test delete missing tag ${Date.now()}`}),
    )
    await publishOrThrow(memberClient, event)

    const deletion = await memberClient.signer.sign(
      makeUniqueEvent(DELETE, {tags: [["e", "missing-id"], ["e", event.id]]}),
    )

    await publishOrThrow(memberClient, deletion)

    await waitForDeletion(memberClient, event.id)
  })

  it("deletes addressable events via a tag", async () => {
    const identifier = `zooid-test-addr-${Date.now()}`
    const event = await memberClient.signer.sign(
      makeUniqueEvent(30001, {
        content: `zooid-test addressable ${Date.now()}`,
        tags: [["d", identifier]],
      }),
    )

    await publishOrThrow(memberClient, event)

    const address = `${event.kind}:${event.pubkey}:${identifier}`
    const deletion = await memberClient.signer.sign(
      makeUniqueEvent(DELETE, {tags: [["a", address]]}),
    )

    await publishOrThrow(memberClient, deletion)

    await waitForDeletion(memberClient, event.id)
  })

  it("rejects mixed-author deletes and preserves all targets", async () => {
    const memberEvent = await memberClient.signer.sign(
      makeUniqueEvent(1, {content: `zooid-test member event ${Date.now()}`}),
    )
    const adminEvent = await adminClient.signer.sign(
      makeUniqueEvent(1, {content: `zooid-test admin event ${Date.now()}`}),
    )

    await publishOrThrow(memberClient, memberEvent)
    await publishOrThrow(adminClient, adminEvent)

    const deletion = await memberClient.signer.sign(
      makeUniqueEvent(DELETE, {tags: [["e", memberEvent.id], ["e", adminEvent.id]]}),
    )
    const deletionResult = await memberClient.publishEvent(deletion)

    expect(deletionResult.status).toBe(PublishStatus.Failure)
    expect(deletionResult.detail).toContain("blocked")

    await waitForPresence(memberClient, memberEvent.id)
    await waitForPresence(memberClient, adminEvent.id)
  })
})
