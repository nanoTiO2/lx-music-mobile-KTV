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
const PROFILE_DISPLAY_RXP = /(?:^|\n)\[\d{1,2}:\d{1,2}(?:\.\d{1,3})?](?:调号|拍速|节拍|分析时间)：[^\n]*/g

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
    .replace(PROFILE_DISPLAY_RXP, '')
    .replace(PROFILE_LRC_RXP, '')
    .replace(PROFILE_HEADER_RXP, '')
    .replace(/^\s*\n/, '')
  const analyzedAt = payload.updatedAt.replace('T', ' ').replace(/\.\d+Z?$/, '').replace(/Z$/, '')
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64')
  const metadataLines = [
    `[${PROFILE_KEY_TAG}:${payload.majorKey}]`,
    `[${PROFILE_BPM_TAG}:${Math.round(payload.bpm)} BPM]`,
    `[${PROFILE_BEAT_TAG}:${payload.beatIntervalMs}ms/${payload.firstBeatOffsetMs}ms]`,
    `[${PROFILE_ANALYSIS_TAG}:${analyzedAt}]`,
    `[${PROFILE_LRC_TAG}:${encoded}]`,
  ]
  const lines = cleanBody.split(/\r\n|\n|\r/)
  const usedDisplayTimes = new Set<number>()
  for (const line of lines) {
    const match = /^\[(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?]/.exec(line.trim())
    if (!match) continue
    const minutes = parseInt(match[1], 10)
    const seconds = parseInt(match[2], 10)
    const fractionText = match[3] ?? '0'
    const ms = parseInt(fractionText.padEnd(3, '0').slice(0, 3), 10)
    usedDisplayTimes.add(minutes * 60_000 + seconds * 1_000 + ms)
  }
  const displayCandidates = [0, 140, 280, 420, 560, 700, 840, 980]
  const pickDisplayTime = () => {
    for (const candidate of displayCandidates) {
      if ([...usedDisplayTimes].every(used => Math.abs(used - candidate) >= 90)) {
        usedDisplayTimes.add(candidate)
        return candidate
      }
    }
    let fallback = 980
    while ([...usedDisplayTimes].some(used => Math.abs(used - fallback) < 45) && fallback > 10) fallback -= 20
    usedDisplayTimes.add(Math.max(fallback, 0))
    return Math.max(fallback, 0)
  }
  const formatDisplayTime = (ms: number) => {
    const minutes = Math.floor(ms / 60_000)
    const seconds = Math.floor((ms % 60_000) / 1_000)
    const hundredths = Math.floor((ms % 1_000) / 10)
    return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}]`
  }
  const displayLines = [
    `${formatDisplayTime(pickDisplayTime())}调号：${payload.majorKey}`,
    `${formatDisplayTime(pickDisplayTime())}拍速：${Math.round(payload.bpm)} BPM`,
    `${formatDisplayTime(pickDisplayTime())}节拍：${payload.beatIntervalMs}ms/${payload.firstBeatOffsetMs}ms`,
    `${formatDisplayTime(pickDisplayTime())}分析时间：${analyzedAt}`,
  ]
  const nextLines = [
    ...metadataLines,
    ...displayLines,
    ...lines,
  ]
  return `${hasBom ? '\ufeff' : ''}${nextLines.join('\n').replace(/\n{3,}/g, '\n\n')}`
}
