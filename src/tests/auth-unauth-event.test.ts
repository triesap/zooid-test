import {describe, it} from "vitest"
import {ClientMessageType, Socket, SocketEvent, SocketStatus, isRelayAuth, isRelayOk} from "@welshman/net"
import {makeEvent} from "@welshman/util"
import {Nip01Signer} from "@welshman/signer"
import {loadTestConfig} from "../testing/config.js"

describe("unauthenticated EVENT", () => {
  it("rejects EVENT with auth-required", async () => {
    const config = loadTestConfig()
    const socket = new Socket(config.relayUrl)
    const signer = Nip01Signer.ephemeral()
    const signed = await signer.sign(
      makeEvent(1, {content: `unauth-event-${Date.now()}`}),
    )

    const eventMessage = [ClientMessageType.Event, signed] as const

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.cleanup()
        reject(new Error("Timed out waiting for auth-required rejection"))
      }, 3000)

      let sent = false
      const sendEvent = () => {
        if (sent) return
        sent = true
        socket.send(eventMessage)
      }

      const finalize = () => {
        clearTimeout(timeout)
        socket.cleanup()
      }

      socket.on(SocketEvent.Receive, message => {
        if (isRelayAuth(message)) {
          sendEvent()
          return
        }

        if (isRelayOk(message) && message[1] === signed.id) {
          const reason = message[3] ?? ""
          if (!reason.startsWith("auth-required:")) {
            finalize()
            reject(new Error(`Expected auth-required rejection, got "${reason}"`))
            return
          }
          finalize()
          resolve()
        }
      })

      socket.on(SocketEvent.Status, status => {
        if (status === SocketStatus.Open) {
          setTimeout(sendEvent, 150)
        }
        if ([SocketStatus.Closed, SocketStatus.Error].includes(status)) {
          finalize()
          reject(new Error("Socket closed before auth-required rejection"))
        }
      })

      socket.open()
    })
  })
})
