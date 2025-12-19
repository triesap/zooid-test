import {afterAll, beforeAll, describe, expect, it} from "vitest"
import {PublishStatus} from "@welshman/net"
import {makeEvent} from "@welshman/util"
import {createTestClient, type TestClient} from "../testing/client.js"
import {loadTestConfig, type TestConfig} from "../testing/config.js"

describe("kind 0 metadata", () => {
  let client: TestClient
  let config: TestConfig

  beforeAll(() => {
    config = loadTestConfig()
    client = createTestClient(config)
  })

  afterAll(() => {
    client?.close()
  })

  it("publishes and reads metadata", async () => {
    const event = await client.signer.sign(
      makeEvent(0, {content: JSON.stringify(config.metadata)}),
    )
    expect(event.pubkey).toBe(config.pubkey)
    const result = await client.publishEvent(event)

    if (result.status !== PublishStatus.Success) {
      throw new Error(`Publish failed (${result.status}): ${result.detail}`)
    }

    const stored = await client.fetchEvent(event.id)

    expect(stored?.id).toBe(event.id)
    expect(stored?.pubkey).toBe(event.pubkey)
    expect(stored?.content).toBe(event.content)
  })
})
