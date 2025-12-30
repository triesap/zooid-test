import {describe, it} from "vitest"
import {Socket, SocketEvent, SocketStatus, isRelayAuth} from "@welshman/net"
import {loadTestConfig} from "../testing/config.js"

describe("NIP-42 auth challenge", () => {
  it("emits AUTH immediately after connect", async () => {
    const config = loadTestConfig()
    const socket = new Socket(config.relayUrl)

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.cleanup()
        reject(new Error("Timed out waiting for AUTH challenge"))
      }, 3000)

      const finalize = () => {
        clearTimeout(timeout)
        socket.cleanup()
      }

      socket.on(SocketEvent.Receive, message => {
        if (isRelayAuth(message)) {
          finalize()
          resolve()
        }
      })

      socket.on(SocketEvent.Status, status => {
        if ([SocketStatus.Closed, SocketStatus.Error].includes(status)) {
          finalize()
          reject(new Error("Socket closed before AUTH challenge"))
        }
      })

      socket.open()
    })
  })
})
