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

const requireEnv = (key: string) => {
  const value = process.env[key]
  if (!value) {
    throw new Error(
      `Missing ${key}. Run pnpm test -- --identity <name> --relay <url> to configure the test runner.`,
    )
  }
  return value
}

const parseMetadata = (raw: string | undefined) => {
  if (!raw) {
    throw new Error(
      "Missing ZOOID_TEST_METADATA. Ensure identity.json includes metadata and re-run the CLI.",
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(
      `ZOOID_TEST_METADATA must be valid JSON. Re-run the CLI to regenerate metadata. ${String(
        error,
      )}`,
    )
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      "ZOOID_TEST_METADATA must be a JSON object. Re-run the CLI to regenerate metadata.",
    )
  }

  return parsed as Record<string, unknown>
}

export const loadTestConfig = (): TestConfig => {
  const relayUrl = requireEnv("ZOOID_TEST_RELAY")
  const identityName = requireEnv("ZOOID_TEST_IDENTITY")
  const secretKey = requireEnv("ZOOID_TEST_SECRET")
  const pubkey = requireEnv("ZOOID_TEST_PUBKEY")
  const metadata = parseMetadata(process.env.ZOOID_TEST_METADATA)

  const result = testConfigSchema.safeParse({
    relayUrl,
    identityName,
    secretKey,
    pubkey,
    metadata,
  })

  if (!result.success) {
    const details = result.error.issues
      .map(issue => `${issue.path.join(".") || "config"}: ${issue.message}`)
      .join("; ")
    throw new Error(`Invalid test config. ${details}`)
  }

  return result.data
}
