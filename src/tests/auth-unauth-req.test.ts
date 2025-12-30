import {describe, it} from "vitest"
import {
  ClientMessageType,
  Socket,
  SocketEvent,
  SocketStatus,
  isRelayAuth,
  isRelayClosed,
  isRelayNegErr,
} from "@welshman/net"
import {loadTestConfig} from "../testing/config.js"

describe("unauthenticated REQ", () => {
  it("rejects REQ with auth-required", async () => {
    const config = loadTestConfig()
    const socket = new Socket(config.relayUrl)
    const subId = `unauth-req-${Date.now()}`
    const reqMessage = [ClientMessageType.Req, subId, {kinds: [1], limit: 1}] as const

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.cleanup()
        reject(new Error("Timed out waiting for auth-required rejection"))
      }, 3000)

      let sent = false
      const sendReq = () => {
        if (sent) return
        sent = true
        socket.send(reqMessage)
      }

      const finalize = () => {
        clearTimeout(timeout)
        socket.cleanup()
      }

      const handleRejection = (reason: string | undefined) => {
        const message = reason ?? ""
        if (!message.startsWith("auth-required:")) {
          finalize()
          reject(new Error(`Expected auth-required rejection, got "${message}"`))
          return
        }
        finalize()
        resolve()
      }

      socket.on(SocketEvent.Receive, message => {
        if (isRelayAuth(message)) {
          sendReq()
          return
        }

        if (isRelayClosed(message) && message[1] === subId) {
          handleRejection(message[2])
          return
        }

        if (isRelayNegErr(message) && message[1] === subId) {
          handleRejection(message[2])
        }
      })

      socket.on(SocketEvent.Status, status => {
        if (status === SocketStatus.Open) {
          setTimeout(sendReq, 150)
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
