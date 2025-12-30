import {afterAll, beforeAll, describe, expect, it} from "vitest"
import {PublishStatus} from "@welshman/net"
import {makeEvent} from "@welshman/util"
import {createTestClient, type TestClient} from "../testing/client.js"
import {loadSecondaryConfig, loadTestConfig, type TestConfig} from "../testing/config.js"

const RELAY_JOIN = 28934
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

describe("relay join with invalid claim", () => {
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

  it("rejects a join request with an invalid claim", async () => {
    await triggerAuth(memberClient)
    const joinEvent = await memberClient.signer.sign(
      makeEvent(RELAY_JOIN, {tags: [["claim", "invalid"]]}),
    )
    const result = await memberClient.publishEvent(joinEvent)

    expect(result.status).toBe(PublishStatus.Failure)
    expect(result.detail.toLowerCase()).toContain("invalid")
  })
})
