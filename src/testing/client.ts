import {always} from "@welshman/lib"
import {
  defaultSocketPolicies,
  makeSocketPolicyAuth,
  makeSocket,
  Pool,
  publish,
  request,
  type PublishResult,
} from "@welshman/net"
import {Nip01Signer} from "@welshman/signer"
import type {Filter, SignedEvent, TrustedEvent} from "@welshman/util"
import type {TestConfig} from "./config.js"

export type TestClient = {
  relayUrl: string
  signer: Nip01Signer
  publishEvent: (event: SignedEvent) => Promise<PublishResult>
  fetchEvents: (filters: Filter[]) => Promise<TrustedEvent[]>
  fetchEvent: (id: string) => Promise<TrustedEvent | undefined>
  close: () => void
}

export const createTestClient = (config: TestConfig): TestClient => {
  const signer = Nip01Signer.fromSecret(config.secretKey)
  const policies = [
    ...defaultSocketPolicies,
    makeSocketPolicyAuth({sign: event => signer.sign(event), shouldAuth: always(true)}),
  ]
  const pool = new Pool({
    makeSocket: url => makeSocket(url, policies),
  })
  const context = {pool}

  const publishEvent = async (event: SignedEvent) => {
    const results = await publish({event, relays: [config.relayUrl], context})
    return results[config.relayUrl]
  }

  const fetchEvents = async (filters: Filter[]) => {
    return request({
      relays: [config.relayUrl],
      filters,
      context,
      autoClose: true,
      signal: AbortSignal.timeout(8000),
      isEventValid: () => true,
    })
  }

  const fetchEvent = async (id: string) => {
    const events = await fetchEvents([{ids: [id]}])

    return events.find(event => event.id === id)
  }

  return {
    relayUrl: config.relayUrl,
    signer,
    publishEvent,
    fetchEvents,
    fetchEvent,
    close: () => pool.clear(),
  }
}
