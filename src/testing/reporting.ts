import {mkdir, readFile, writeFile} from "node:fs/promises"
import path from "node:path"

export type VitestStats = {
  total: number
  passed: number
  failed: number
  skipped: number
  todo: number
}

type EnvLoadResult = {
  status: "loaded" | "missing"
  keys: string[]
}

const pad2 = (value: number) => String(value).padStart(2, "0")
const pad3 = (value: number) => String(value).padStart(3, "0")

export const formatRunId = (date: Date) => {
  const year = date.getUTCFullYear()
  const month = pad2(date.getUTCMonth() + 1)
  const day = pad2(date.getUTCDate())
  const hours = pad2(date.getUTCHours())
  const minutes = pad2(date.getUTCMinutes())
  const seconds = pad2(date.getUTCSeconds())
  const millis = pad3(date.getUTCMilliseconds())
  return `${year}${month}${day}T${hours}${minutes}${seconds}${millis}Z`
}

export const ensureOutputDir = async (root: string, runId: string) => {
  const dir = path.join(root, runId)
  await mkdir(dir, {recursive: true})
  return dir
}

export const writeJsonFile = async (filePath: string, data: unknown) => {
  const payload = JSON.stringify(data, null, 4)
  await writeFile(filePath, `${payload}\n`, "utf8")
}

export const readJsonFile = async (filePath: string) => {
  const raw = await readFile(filePath, "utf8")
  return JSON.parse(raw) as unknown
}

export const loadEnvFile = async (envPath: string): Promise<EnvLoadResult> => {
  let raw: string
  try {
    raw = await readFile(envPath, "utf8")
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err?.code === "ENOENT") {
      return {status: "missing", keys: []}
    }
    throw error
  }

  const keys: string[] = []

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) {
      continue
    }
    let entry = trimmed
    if (entry.startsWith("export ")) {
      entry = entry.slice("export ".length).trim()
    }
    const index = entry.indexOf("=")
    if (index <= 0) {
      continue
    }
    const key = entry.slice(0, index).trim()
    let value = entry.slice(index + 1).trim()
    if (!key) {
      continue
    }
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) {
      process.env[key] = value
      keys.push(key)
    }
  }

  return {status: "loaded", keys}
}

export const summarizeVitestReport = (report: unknown): VitestStats | null => {
  if (!report || typeof report !== "object") {
    return null
  }

  const data = report as {
    numTotalTests?: number
    numPassedTests?: number
    numFailedTests?: number
    numPendingTests?: number
    numSkippedTests?: number
    numTodoTests?: number
    testResults?: Array<{
      assertionResults?: Array<{status?: string}>
    }>
  }

  if (typeof data.numTotalTests === "number") {
    return {
      total: data.numTotalTests ?? 0,
      passed: data.numPassedTests ?? 0,
      failed: data.numFailedTests ?? 0,
      skipped: (data.numPendingTests ?? 0) + (data.numSkippedTests ?? 0),
      todo: data.numTodoTests ?? 0,
    }
  }

  if (!Array.isArray(data.testResults)) {
    return null
  }

  const stats: VitestStats = {total: 0, passed: 0, failed: 0, skipped: 0, todo: 0}

  const increment = (statusRaw: string | undefined) => {
    const status = (statusRaw ?? "").toLowerCase()
    stats.total += 1

    if (status === "passed") {
      stats.passed += 1
      return
    }
    if (status === "failed") {
      stats.failed += 1
      return
    }
    if (status === "todo") {
      stats.todo += 1
      return
    }

    stats.skipped += 1
  }

  for (const fileResult of data.testResults) {
    if (!fileResult || !Array.isArray(fileResult.assertionResults)) {
      continue
    }
    for (const assertion of fileResult.assertionResults) {
      increment(assertion?.status)
    }
  }

  return stats
}
