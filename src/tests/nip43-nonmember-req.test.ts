import {describe, it} from "vitest"
import {
  AuthStateEvent,
  AuthStatus,
  ClientMessageType,
  SocketEvent,
  SocketStatus,
  defaultSocketPolicies,
  isRelayClosed,
  isRelayNegErr,
  makeSocket,
  makeSocketPolicyAuth,
} from "@welshman/net"
import {Nip01Signer} from "@welshman/signer"
import {loadTestConfig} from "../testing/config.js"

describe("authenticated non-member REQ", () => {
  it("rejects REQ with restricted", async () => {
    const config = loadTestConfig()
    const signer = Nip01Signer.ephemeral()
    const socket = makeSocket(config.relayUrl, [
      ...defaultSocketPolicies,
      makeSocketPolicyAuth({sign: event => signer.sign(event)}),
    ])
    const subId = `nonmember-req-${Date.now()}`

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.cleanup()
        reject(new Error("Timed out waiting for restricted rejection"))
      }, 4000)

      const finalize = () => {
        clearTimeout(timeout)
        socket.cleanup()
      }

      const handleRejection = (reason: string | undefined) => {
        const message = reason ?? ""
        if (!message.startsWith("restricted:")) {
          finalize()
          reject(new Error(`Expected restricted rejection, got "${message}"`))
          return
        }
        finalize()
        resolve()
      }

      socket.on(SocketEvent.Receive, message => {
        if (isRelayClosed(message) && message[1] === subId) {
          handleRejection(message[2])
          return
        }

        if (isRelayNegErr(message) && message[1] === subId) {
          handleRejection(message[2])
        }
      })

      socket.auth.on(AuthStateEvent.Status, status => {
        if (status === AuthStatus.Ok) {
          socket.send([ClientMessageType.Req, subId, {kinds: [1], limit: 1}])
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
          reject(new Error("Socket closed before restricted rejection"))
        }
      })

      socket.open()
    })
  })
})
