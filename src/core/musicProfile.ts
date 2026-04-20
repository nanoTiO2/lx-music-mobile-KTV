import { analyzeMixerMusicProfile } from '@/utils/nativeModules/mixer'
import { existsFile, readFile, writeFile } from '@/utils/fs'

export interface MusicProfile {
  bpm: number
  beatIntervalMs: number
  firstBeatOffsetMs: number
  confidence: number
  analyzedDurationMs: number
  majorKey: string
  keyConfidence: number
}

interface StoredMusicProfile extends MusicProfile {
  updatedAt: string
  sourcePath: string
}

const profileCache = new Map<string, Promise<MusicProfile>>()
const PROFILE_LRC_TAG = 'lx_music_profile'
const PROFILE_BPM_TAG = 'bpm'
const PROFILE_KEY_TAG = 'key'
const PROFILE_BEAT_TAG = 'beat'
const PROFILE_ANALYSIS_TAG = 'analysis_time'
const PROFILE_LRC_RXP = new RegExp(`(?:^|\\n\\s*)\\[${PROFILE_LRC_TAG}:([^\\]]+)]\\s*`, 'i')
const PROFILE_HEADER_RXP = /(?:^|\n\s*)\[(key|bpm|beat|analysis_time):([^\]]+)]\s*/ig

export const getMusicProfilePath = (musicInfo: LX.Player.PlayMusic | LX.Music.MusicInfoLocal | null | undefined) => {
  if (!musicInfo || 'progress' in musicInfo || musicInfo.source != 'local') return ''
  return musicInfo.meta.originFilePath?.trim() || musicInfo.meta.filePath?.trim() || ''
}

export const getMusicProfileCachePath = (filePath: string) => {
  const path = filePath.trim()
  if (!path) return ''
  return `${path}.lx-profile.json`
}

const getMusicProfileLyricPath = (filePath: string) => {
  const path = filePath.trim()
  if (!path) return ''
  const dotIndex = path.lastIndexOf('.')
  return dotIndex > -1 ? `${path.substring(0, dotIndex)}.lrc` : `${path}.lrc`
}

const normalizeMusicProfile = (data: Partial<StoredMusicProfile> | null | undefined) => {
  if (!data) return null
  if (
    typeof data.bpm != 'number' ||
    typeof data.beatIntervalMs != 'number' ||
    typeof data.firstBeatOffsetMs != 'number' ||
    typeof data.confidence != 'number' ||
    typeof data.analyzedDurationMs != 'number' ||
    typeof data.majorKey != 'string' ||
    typeof data.keyConfidence != 'number'
  ) return null
  return {
    bpm: data.bpm,
    beatIntervalMs: data.beatIntervalMs,
    firstBeatOffsetMs: data.firstBeatOffsetMs,
    confidence: data.confidence,
    analyzedDurationMs: data.analyzedDurationMs,
    majorKey: data.majorKey,
    keyConfidence: data.keyConfidence,
  } satisfies MusicProfile
}

const getEmbeddedMusicProfile = async(filePath: string) => {
  const lyricPath = getMusicProfileLyricPath(filePath)
  if (!lyricPath) return null
  if (!(await existsFile(lyricPath).catch(() => false))) return null
  try {
    const raw = await readFile(lyricPath)
    const matched = PROFILE_LRC_RXP.exec(raw)
    if (!matched) return null
    const decoded = Buffer.from(matched[1], 'base64').toString('utf-8')
    return normalizeMusicProfile(JSON.parse(decoded) as Partial<StoredMusicProfile>)
  } catch {
    return null
  }
}

export const getCachedMusicProfile = async(filePath: string) => {
  const embeddedProfile = await getEmbeddedMusicProfile(filePath)
  if (embeddedProfile) return embeddedProfile
  const cachePath = getMusicProfileCachePath(filePath)
  if (!cachePath) return null
  if (!(await existsFile(cachePath).catch(() => false))) return null
  try {
    const raw = await readFile(cachePath)
    return normalizeMusicProfile(JSON.parse(raw) as Partial<StoredMusicProfile>)
  } catch {
    return null
  }
}

const persistMusicProfileToLyric = async(filePath: string, payload: StoredMusicProfile) => {
  const lyricPath = getMusicProfileLyricPath(filePath)
  if (!lyricPath) return
  if (!(await existsFile(lyricPath).catch(() => false))) return
  const raw = await readFile(lyricPath)
  const hasBom = raw.startsWith('\ufeff')
  const cleanBody = (hasBom ? raw.slice(1) : raw)
    .replace(PROFILE_LRC_RXP, '')
    .replace(PROFILE_HEADER_RXP, '')
    .replace(/^\s*\n/, '')
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64')
  const metadataLines = [
    `[${PROFILE_KEY_TAG}:${payload.majorKey}]`,
    `[${PROFILE_BPM_TAG}:${Math.round(payload.bpm)} BPM]`,
    `[${PROFILE_BEAT_TAG}:${payload.beatIntervalMs}ms/${payload.firstBeatOffsetMs}ms]`,
    `[${PROFILE_ANALYSIS_TAG}:${payload.updatedAt}]`,
    `[${PROFILE_LRC_TAG}:${encoded}]`,
  ]
  const lines = cleanBody.split(/\r\n|\n|\r/)
  let insertIndex = 0
  while (insertIndex < lines.length && /^\[(?!\d{1,2}:)[^\]]+]/.test(lines[insertIndex].trim())) insertIndex++
  const nextLines = [
    ...lines.slice(0, insertIndex),
    ...metadataLines,
    ...lines.slice(insertIndex),
  ]
  const nextContent = `${hasBom ? '\ufeff' : ''}${nextLines.join('\n').replace(/\n{3,}/g, '\n\n')}`
  await writeFile(lyricPath, nextContent)
}

const persistMusicProfile = async(filePath: string, profile: MusicProfile) => {
  const cachePath = getMusicProfileCachePath(filePath)
  if (!cachePath) return
  const payload: StoredMusicProfile = {
    ...profile,
    sourcePath: filePath,
    updatedAt: new Date().toISOString(),
  }
  await writeFile(cachePath, JSON.stringify(payload))
  await persistMusicProfileToLyric(filePath, payload).catch(() => {})
}

export const getMusicProfile = async(filePath: string, maxAnalyzeMs: number = 90_000) => {
  const path = filePath.trim()
  if (!path) throw new Error('file path is empty')
  let task = profileCache.get(path)
  if (!task) {
    task = analyzeMixerMusicProfile(path, maxAnalyzeMs)
      .then(async profile => {
        await persistMusicProfile(path, profile).catch(() => {})
        profileCache.delete(path)
        return profile
      })
      .catch(err => {
        profileCache.delete(path)
        throw err
      })
    profileCache.set(path, task)
  }
  return task
}

export const clearMusicProfileCache = (filePath?: string) => {
  if (filePath) profileCache.delete(filePath)
  else profileCache.clear()
}
