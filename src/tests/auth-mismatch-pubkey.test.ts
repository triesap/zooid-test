import {describe, it} from "vitest"
import {
  AuthStateEvent,
  AuthStatus,
  ClientMessageType,
  SocketEvent,
  SocketStatus,
  defaultSocketPolicies,
  isRelayOk,
  makeSocket,
  makeSocketPolicyAuth,
} from "@welshman/net"
import {makeEvent} from "@welshman/util"
import {Nip01Signer} from "@welshman/signer"
import {loadSecondaryConfig, loadTestConfig} from "../testing/config.js"

describe("authenticated pubkey mismatch", () => {
  it("rejects events signed by a different pubkey", async () => {
    const config = loadTestConfig()
    const secondary = loadSecondaryConfig(config.relayUrl)
    const adminSigner = Nip01Signer.fromSecret(config.secretKey)
    const otherSigner = Nip01Signer.fromSecret(secondary.secretKey)

    const signed = await otherSigner.sign(
      makeEvent(1, {content: `mismatch-event-${Date.now()}`}),
    )

    const socket = makeSocket(config.relayUrl, [
      ...defaultSocketPolicies,
      makeSocketPolicyAuth({sign: event => adminSigner.sign(event)}),
    ])

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.cleanup()
        reject(new Error("Timed out waiting for restricted rejection"))
      }, 4000)

      const finalize = () => {
        clearTimeout(timeout)
        socket.cleanup()
      }

      socket.on(SocketEvent.Receive, message => {
        if (isRelayOk(message) && message[1] === signed.id) {
          const ok = message[2]
          const reason = message[3] ?? ""
          if (ok || !reason.startsWith("restricted:")) {
            finalize()
            reject(new Error(`Expected restricted rejection, got "${reason}"`))
            return
          }
          finalize()
          resolve()
        }
      })

      socket.auth.on(AuthStateEvent.Status, status => {
        if (status === AuthStatus.Ok) {
          socket.send([ClientMessageType.Event, signed])
          return
        }

        if ([AuthStatus.Forbidden, AuthStatus.DeniedSignature].includes(status)) {
          finalize()
          reject(new Error(`Auth failed (${status})`))
        }
      })

      socket.on(SocketEvent.Status, status => {
        if ([SocketStatus.Closed, SocketStatus.Error].includes(status)) {
          finalize()
          reject(new Error("Socket closed before event rejection"))
        }
      })

      socket.open()
    })
  })
})
