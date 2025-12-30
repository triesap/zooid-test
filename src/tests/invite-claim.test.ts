import {afterAll, beforeAll, describe, expect, it} from "vitest"
import {createTestClient, type TestClient} from "../testing/client.js"
import {loadTestConfig, type TestConfig} from "../testing/config.js"

const RELAY_INVITE = 28935

describe("relay invite claim", () => {
  let client: TestClient
  let config: TestConfig

  beforeAll(() => {
    config = loadTestConfig()
    client = createTestClient(config)
  })

  afterAll(() => {
    client?.close()
  })

  it("returns a claim tag for admins", async () => {
    const invites = await client.fetchEvents([{kinds: [RELAY_INVITE]}])

    const invite = invites.find(event => event.tags?.some(tag => tag[0] === "claim"))

    expect(invite).toBeTruthy()

    const claimTag = invite?.tags?.find(tag => tag[0] === "claim")

    expect(claimTag?.[1]).toBeTruthy()
  })
})
