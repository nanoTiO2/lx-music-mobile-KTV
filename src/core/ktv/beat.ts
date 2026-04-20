import { existsFile, mkdir, privateStorageDirectoryPath, readFile, writeFile } from '@/utils/fs'
import { stringMd5 } from 'react-native-quick-md5'
import { analyzeMixerBeatGrid, isMixerAvailable } from '@/utils/nativeModules/mixer'

export interface BeatGrid {
  bpm: number
  beatIntervalMs: number
  firstBeatOffsetMs: number
  confidence: number
  analyzedDurationMs: number
}

const CACHE_DIR = `${privateStorageDirectoryPath}/ktv-beat-cache`
const memoryCache = new Map<string, Promise<BeatGrid | null> | BeatGrid | null>()

const getCachePath = (filePath: string) => `${CACHE_DIR}/${stringMd5(filePath)}.json`

const readCache = async(filePath: string): Promise<BeatGrid | null> => {
  const cachePath = getCachePath(filePath)
  if (!await existsFile(cachePath)) return null
  const raw = await readFile(cachePath).catch(() => '')
  if (!raw) return null
  try {
    return JSON.parse(raw) as BeatGrid
  } catch {
    return null
  }
}

const writeCache = async(filePath: string, grid: BeatGrid) => {
  await mkdir(CACHE_DIR).catch(() => {})
  await writeFile(getCachePath(filePath), JSON.stringify(grid)).catch(() => {})
}

export const getBeatGrid = async(filePath: string): Promise<BeatGrid | null> => {
  const cached = memoryCache.get(filePath)
  if (cached instanceof Promise) return cached
  if (cached !== undefined) return cached

  const task = (async() => {
    if (!isMixerAvailable()) return null
    const diskCached = await readCache(filePath)
    if (diskCached) return diskCached
    const analyzed = await analyzeMixerBeatGrid(filePath).catch(() => null)
    if (!analyzed) return null
    const grid: BeatGrid = {
      bpm: analyzed.bpm,
      beatIntervalMs: analyzed.beatIntervalMs,
      firstBeatOffsetMs: analyzed.firstBeatOffsetMs,
      confidence: analyzed.confidence,
      analyzedDurationMs: analyzed.analyzedDurationMs,
    }
    await writeCache(filePath, grid)
    return grid
  })()

  memoryCache.set(filePath, task)
  const result = await task
  memoryCache.set(filePath, result)
  return result
}

export const prewarmBeatGrid = async(filePath: string) => {
  void getBeatGrid(filePath)
}

export const getNextBeatSwitchTime = ({
  nowMs,
  guardMs,
  grid,
}: {
  nowMs: number
  guardMs?: number
  grid: BeatGrid | null
}) => {
  const fallback = Math.max(nowMs + (guardMs ?? 120), nowMs + 120)
  if (!grid || grid.beatIntervalMs < 200 || grid.confidence < 0.08) return fallback
  const safeNowMs = Math.max(0, nowMs)
  const safeGuardMs = Math.max(60, guardMs ?? 120)
  const beatIntervalMs = Math.round(grid.beatIntervalMs)
  const offsetMs = Math.max(0, Math.round(grid.firstBeatOffsetMs))
  // Beat analysis can produce an outlier first-beat offset. If the next beat is too far away,
  // fall back to a short aligned switch instead of making the user wait indefinitely.
  if (safeNowMs <= offsetMs) {
    const initialDelay = offsetMs - safeNowMs
    return initialDelay > Math.max(beatIntervalMs * 2, 1200) ? fallback : offsetMs
  }
  const steps = Math.ceil((safeNowMs + safeGuardMs - offsetMs) / beatIntervalMs)
  const nextBeat = offsetMs + Math.max(1, steps) * beatIntervalMs
  return nextBeat - safeNowMs > Math.max(beatIntervalMs * 2, 1200) ? fallback : nextBeat
}
