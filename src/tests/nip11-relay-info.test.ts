import {describe, expect, it} from "vitest"
import {loadTestConfig} from "../testing/config.js"

const toHttpUrl = (relayUrl: string) => relayUrl.replace(/^ws/, "http")

const loadRelayInfo = async (relayUrl: string) => {
  const response = await fetch(toHttpUrl(relayUrl), {
    headers: {
      Accept: "application/nostr+json",
    },
    signal: AbortSignal.timeout(8000),
  })

  if (!response.ok) {
    throw new Error(`NIP-11 response failed with ${response.status}`)
  }

  return response.json()
}

describe("NIP-11 relay info", () => {
  it("returns supported_nips including core features", async () => {
    const config = loadTestConfig()
    const info = await loadRelayInfo(config.relayUrl)

    expect(info).toBeTruthy()
    expect(Array.isArray(info.supported_nips)).toBe(true)

    const supported = (info.supported_nips as Array<number | string>)
      .map(value => Number(value))
      .filter(value => Number.isFinite(value))

    expect(supported).toContain(11)
    expect(supported).toContain(42)
  })
})
