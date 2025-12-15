import {readFile} from "node:fs/promises"
import {existsSync} from "node:fs"
import {spawn} from "node:child_process"
import {fileURLToPath} from "node:url"
import path from "node:path"
import process from "node:process"
import {z} from "zod"
import {getPubkey} from "@welshman/util"

type ParsedArgs = {
  identity?: string
  relay?: string
  help: boolean
  vitestArgs: string[]
}

const usage = `zooid-test

Usage:
  pnpm test -- --identity <name> --relay <wss://relay> [vitest args]

Options:
  -i, --identity <name>  Identity key to use from identity.json
  -r, --relay <url>      Relay websocket URL to test
  -h, --help             Show this help

Examples:
  pnpm test -- --identity admin --relay ws://localhost:3334
  pnpm test -- --identity admin --relay wss://relay.example -t "kind 1"
`

const parseArgs = (args: string[]): ParsedArgs => {
  const parsed: ParsedArgs = {help: false, vitestArgs: []}
  let inVitestArgs = false

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]

    if (arg === "--") {
      if (i === 0 && !inVitestArgs) {
        continue
      }
      inVitestArgs = true
      continue
    }

    if (inVitestArgs) {
      parsed.vitestArgs.push(arg)
      continue
    }

    if (arg === "-h" || arg === "--help") {
      parsed.help = true
      continue
    }

    if (arg === "-i" || arg === "--identity") {
      const value = args[i + 1]
      if (!value || value.startsWith("-")) {
        throw new Error("Missing value for --identity")
      }
      parsed.identity = value
      i += 1
      continue
    }

    if (arg.startsWith("--identity=")) {
      parsed.identity = arg.slice("--identity=".length)
      continue
    }

    if (arg === "-r" || arg === "--relay") {
      const value = args[i + 1]
      if (!value || value.startsWith("-")) {
        throw new Error("Missing value for --relay")
      }
      parsed.relay = value
      i += 1
      continue
    }

    if (arg.startsWith("--relay=")) {
      parsed.relay = arg.slice("--relay=".length)
      continue
    }

    parsed.vitestArgs.push(arg)
  }

  return parsed
}

const formatZodIssues = (issues: z.ZodIssue[]) =>
  issues
    .map(issue => {
      const location = issue.path.length > 0 ? issue.path.join(".") : "(root)"
      return `- ${location}: ${issue.message}`
    })
    .join("\n")

const loadIdentities = async (identityPath: string) => {
  const raw = await readFile(identityPath, "utf8").catch(error => {
    throw new Error(`Failed to read identity file at ${identityPath}: ${String(error)}`)
  })

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`Identity file contains invalid JSON: ${String(error)}`)
  }

  const identitySchema = z
    .object({
      secret_key: z
        .string()
        .regex(/^[0-9a-f]{64}$/i, "secret_key must be 64 hex characters"),
      public_key: z
        .string()
        .regex(/^[0-9a-f]{64}$/i, "public_key must be 64 hex characters"),
      kind_0_metadata: z
        .record(z.string(), z.unknown())
        .refine(value => !Array.isArray(value), "kind_0_metadata must be an object")
        .optional(),
    })
    .passthrough()
    .refine(data => getPubkey(data.secret_key) === data.public_key, {
      message: "public_key does not match secret_key",
      path: ["public_key"],
    })

  const identitiesSchema = z.record(identitySchema)
  const result = identitiesSchema.safeParse(parsed)

  if (!result.success) {
    throw new Error(`Identity file schema mismatch:\n${formatZodIssues(result.error.issues)}`)
  }

  return result.data
}

const resolveIdentity = (
  identities: Record<
    string,
    {secret_key: string; public_key: string; kind_0_metadata?: Record<string, unknown>}
  >,
  requested?: string,
) => {
  const available = Object.keys(identities).sort()

  if (requested) {
    const identity = identities[requested]
    if (!identity) {
      throw new Error(
        `Identity "${requested}" not found in identity.json. Available identities: ${available.join(
          ", ",
        )}`,
      )
    }
    return {name: requested, identity}
  }

  if (available.length === 1) {
    const name = available[0]
    return {name, identity: identities[name]}
  }

  throw new Error(
    `No identity specified. Use --identity <name>. Available identities: ${available.join(", ")}`,
  )
}

const buildVitestArgs = (args: string[]) => {
  const wantsWatch = args.includes("--watch") || args.includes("-w")
  const hasRun = args.includes("run") || args.includes("--run")

  if (wantsWatch || hasRun) {
    return args
  }

  return ["run", ...args]
}

const main = async () => {
  const parsed = parseArgs(process.argv.slice(2))

  if (parsed.help) {
    console.log(usage)
    return
  }

  const scriptDir = path.dirname(fileURLToPath(import.meta.url))
  const packageRoot = path.resolve(scriptDir, "..")
  const identityPath = path.join(packageRoot, "identity.json")

  const identities = await loadIdentities(identityPath)
  const requestedIdentity = parsed.identity || process.env.ZOOID_TEST_IDENTITY
  const {name: identityName, identity} = resolveIdentity(identities, requestedIdentity)

  const relay = parsed.relay || process.env.ZOOID_TEST_RELAY
  if (!relay) {
    throw new Error("Relay URL missing. Provide --relay <url> or set ZOOID_TEST_RELAY.")
  }

  const metadata = identity.kind_0_metadata || {name: identityName}
  const metadataJson = JSON.stringify(metadata)
  const env = {
    ...process.env,
    ZOOID_TEST_IDENTITY: identityName,
    ZOOID_TEST_SECRET: identity.secret_key,
    ZOOID_TEST_PUBKEY: identity.public_key,
    ZOOID_TEST_RELAY: relay,
    ZOOID_TEST_METADATA: metadataJson,
  }

  console.log("identity", identity)

  const binName = process.platform === "win32" ? "vitest.cmd" : "vitest"
  const vitestPath = path.join(packageRoot, "node_modules", ".bin", binName)

  if (!existsSync(vitestPath)) {
    throw new Error(`vitest not found at ${vitestPath}. Run pnpm install in zooid-test.`)
  }

  const vitestArgs = buildVitestArgs(parsed.vitestArgs)
  const child = spawn(vitestPath, vitestArgs, {
    cwd: packageRoot,
    stdio: "inherit",
    env,
  })

  child.on("error", error => {
    console.error(`Error: Failed to launch vitest. ${String(error)}`)
    process.exit(1)
  })

  child.on("exit", code => {
    process.exit(code ?? 1)
  })
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Error: ${message}`)
  process.exit(1)
})
