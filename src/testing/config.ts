import {z} from "zod"

export const testConfigSchema = z.object({
  relayUrl: z.string().min(1, "relayUrl is required"),
  identityName: z.string().min(1, "identityName is required"),
  secretKey: z.string().min(1, "secretKey is required"),
  pubkey: z.string().min(1, "pubkey is required"),
  metadata: z
    .record(z.unknown())
    .refine(value => !Array.isArray(value), "metadata must be an object"),
})

export type TestConfig = z.infer<typeof testConfigSchema>

const requireEnv = (key: string, hint?: string) => {
  const value = process.env[key]
  if (!value) {
    throw new Error(
      `Missing ${key}. ${hint ?? "Run pnpm test -- --identity <name> --relay <url> to configure the test runner."}`,
    )
  }
  return value
}

const parseMetadata = (raw: string | undefined, keyName: string, hint?: string) => {
  if (!raw) {
    throw new Error(
      `Missing ${keyName}. ${hint ?? "Ensure identity.json includes metadata and re-run the CLI."}`,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(
      `${keyName} must be valid JSON. Re-run the CLI to regenerate metadata. ${String(error)}`,
    )
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${keyName} must be a JSON object. Re-run the CLI to regenerate metadata.`)
  }

  return parsed as Record<string, unknown>
}

const validateConfig = (data: {
  relayUrl: string
  identityName: string
  secretKey: string
  pubkey: string
  metadata: Record<string, unknown>
}): TestConfig => {
  const result = testConfigSchema.safeParse(data)

  if (!result.success) {
    const details = result.error.issues
      .map(issue => `${issue.path.join(".") || "config"}: ${issue.message}`)
      .join("; ")
    throw new Error(`Invalid test config. ${details}`)
  }

  return result.data
}

export const loadTestConfig = (): TestConfig => {
  const relayUrl = requireEnv("ZOOID_TEST_RELAY")
  const identityName = requireEnv("ZOOID_TEST_IDENTITY")
  const secretKey = requireEnv("ZOOID_TEST_SECRET")
  const pubkey = requireEnv("ZOOID_TEST_PUBKEY")
  const metadata = parseMetadata(process.env.ZOOID_TEST_METADATA, "ZOOID_TEST_METADATA")

  return validateConfig({relayUrl, identityName, secretKey, pubkey, metadata})
}

export const loadSecondaryConfig = (relayUrl: string): TestConfig => {
  const hint =
    "Run pnpm test -- --identity <admin> --identity2 <member> --relay <url> to configure the test runner."
  const identityName = requireEnv("ZOOID_TEST_IDENTITY2", hint)
  const secretKey = requireEnv("ZOOID_TEST_SECRET2", hint)
  const pubkey = requireEnv("ZOOID_TEST_PUBKEY2", hint)
  const metadata = parseMetadata(process.env.ZOOID_TEST_METADATA2, "ZOOID_TEST_METADATA2", hint)

  return validateConfig({relayUrl, identityName, secretKey, pubkey, metadata})
}
