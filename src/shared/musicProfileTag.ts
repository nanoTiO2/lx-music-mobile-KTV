export interface PortableMusicProfile {
  bpm: number
  beatIntervalMs: number
  firstBeatOffsetMs: number
  confidence: number
  analyzedDurationMs: number
  majorKey: string
  keyConfidence: number
}

export interface StoredPortableMusicProfile extends PortableMusicProfile {
  updatedAt: string
  sourcePath: string
}

export const PROFILE_LRC_TAG = 'lx_music_profile'
export const PROFILE_BPM_TAG = 'bpm'
export const PROFILE_KEY_TAG = 'key'
export const PROFILE_BEAT_TAG = 'beat'
export const PROFILE_ANALYSIS_TAG = 'analysis_time'

export const PROFILE_LRC_RXP = new RegExp(`(?:^|\\n\\s*)\\[${PROFILE_LRC_TAG}:([^\\]]+)]\\s*`, 'i')
export const PROFILE_HEADER_RXP = /(?:^|\n\s*)\[(key|bpm|beat|analysis_time):([^\]]+)]\s*/ig

export const normalizePortableMusicProfile = (data: Partial<StoredPortableMusicProfile> | null | undefined) => {
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
  } satisfies PortableMusicProfile
}

export const decodePortableMusicProfileFromLrc = (raw: string) => {
  const matched = PROFILE_LRC_RXP.exec(raw)
  if (!matched) return null
  try {
    const decoded = Buffer.from(matched[1], 'base64').toString('utf-8')
    return normalizePortableMusicProfile(JSON.parse(decoded) as Partial<StoredPortableMusicProfile>)
  } catch {
    return null
  }
}

export const injectPortableMusicProfileIntoLrc = (raw: string, payload: StoredPortableMusicProfile) => {
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
  return `${hasBom ? '\ufeff' : ''}${nextLines.join('\n').replace(/\n{3,}/g, '\n\n')}`
}
