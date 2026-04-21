export interface PortableMusicProfile {
  bpm: number
  beatIntervalMs: number
  firstBeatOffsetMs: number
  confidence: number
  analyzedDurationMs: number
  analysisScope?: 'quick' | 'full'
  majorKey: string
  keyConfidence: number
  keyMode?: 'major' | 'minor'
  keyTonic?: string
  highestNote?: string
  highestMidi?: number
  highestFreqHz?: number
  highestTimeMs?: number
  dominantHighNote?: string
  dominantLowNote?: string
  averageNote?: string
  averageMidi?: number
  commonHighNote?: string
  commonHighMidi?: number
  commonLowNote?: string
  commonLowMidi?: number
  lowestNote?: string
  lowestMidi?: number
  lowestFreqHz?: number
  lowestTimeMs?: number
  timeSignature?: '4/4' | '3/4' | '6/8'
  waveformSamples?: number[]
  pitchTrack?: Array<{
    timeMs: number
    midi: number
  }>
  chordSegments?: Array<{
    startMs: number
    endMs: number
    label: string
    confidence: number
  }>
}

export interface StoredPortableMusicProfile extends PortableMusicProfile {
  updatedAt: string
  sourcePath: string
}

export const PROFILE_LRC_TAG = 'lx_music_profile'
export const PROFILE_BPM_TAG = 'bpm'
export const PROFILE_KEY_TAG = 'key'
const PROFILE_DISPLAY_RXP = /(?:^|\n)\[\d{1,2}:\d{1,2}(?:\.\d{1,3})?](?:调号|拍速|节拍|分析时间|最高音)：[^\n]*/g

export const PROFILE_LRC_RXP = new RegExp(`(?:^|\\n\\s*)\\[${PROFILE_LRC_TAG}:([^\\]]+)]\\s*`, 'i')
export const PROFILE_HEADER_RXP = /(?:^|\n\s*)\[(key|bpm|beat|analysis_time|highest_note|highest_freq):([^\]]+)]\s*/ig

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
    analysisScope: data.analysisScope == 'full' ? 'full' : data.analysisScope == 'quick' ? 'quick' : undefined,
    majorKey: data.majorKey,
    keyConfidence: data.keyConfidence,
    keyMode: data.keyMode == 'minor' ? 'minor' : data.keyMode == 'major' ? 'major' : undefined,
    keyTonic: typeof data.keyTonic == 'string' ? data.keyTonic : undefined,
    highestNote: typeof data.highestNote == 'string' ? data.highestNote : undefined,
    highestMidi: typeof data.highestMidi == 'number' ? data.highestMidi : undefined,
    highestFreqHz: typeof data.highestFreqHz == 'number' ? data.highestFreqHz : undefined,
    highestTimeMs: typeof data.highestTimeMs == 'number' ? data.highestTimeMs : undefined,
    dominantHighNote: typeof data.dominantHighNote == 'string' ? data.dominantHighNote : undefined,
    dominantLowNote: typeof data.dominantLowNote == 'string' ? data.dominantLowNote : undefined,
    averageNote: typeof data.averageNote == 'string' ? data.averageNote : undefined,
    averageMidi: typeof data.averageMidi == 'number' ? data.averageMidi : undefined,
    commonHighNote: typeof data.commonHighNote == 'string' ? data.commonHighNote : undefined,
    commonHighMidi: typeof data.commonHighMidi == 'number' ? data.commonHighMidi : undefined,
    commonLowNote: typeof data.commonLowNote == 'string' ? data.commonLowNote : undefined,
    commonLowMidi: typeof data.commonLowMidi == 'number' ? data.commonLowMidi : undefined,
    lowestNote: typeof data.lowestNote == 'string' ? data.lowestNote : undefined,
    lowestMidi: typeof data.lowestMidi == 'number' ? data.lowestMidi : undefined,
    lowestFreqHz: typeof data.lowestFreqHz == 'number' ? data.lowestFreqHz : undefined,
    lowestTimeMs: typeof data.lowestTimeMs == 'number' ? data.lowestTimeMs : undefined,
    timeSignature: data.timeSignature == '3/4' || data.timeSignature == '6/8' || data.timeSignature == '4/4'
      ? data.timeSignature
      : undefined,
    waveformSamples: Array.isArray(data.waveformSamples)
      ? data.waveformSamples.filter(item => typeof item == 'number' && Number.isFinite(item)).map(item => Math.max(0, Math.min(1, item)))
      : undefined,
    pitchTrack: Array.isArray(data.pitchTrack)
      ? data.pitchTrack
        .filter(item => item && typeof item.timeMs == 'number' && typeof item.midi == 'number')
        .map(item => ({
          timeMs: item.timeMs,
          midi: item.midi,
        }))
      : undefined,
    chordSegments: Array.isArray(data.chordSegments)
      ? data.chordSegments
        .filter(item => item && typeof item.startMs == 'number' && typeof item.endMs == 'number' && typeof item.label == 'string')
        .map(item => ({
          startMs: item.startMs,
          endMs: item.endMs,
          label: item.label,
          confidence: typeof item.confidence == 'number' ? item.confidence : 0,
        }))
      : undefined,
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
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64')
  const metadataLines = [
    `[${PROFILE_KEY_TAG}:${payload.majorKey}]`,
    `[${PROFILE_BPM_TAG}:${Math.round(payload.bpm)} BPM]`,
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
  ]
  const nextLines = [
    ...metadataLines,
    ...displayLines,
    ...lines,
  ]
  return `${hasBom ? '\ufeff' : ''}${nextLines.join('\n').replace(/\n{3,}/g, '\n\n')}`
}
