import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { ScrollView, TouchableOpacity, View } from 'react-native'
import Popup, { type PopupType } from '@/components/common/Popup'
import Text from '@/components/common/Text'
import { BorderWidths } from '@/theme'
import { useTheme } from '@/store/theme/hook'
import { usePlayMusicInfo } from '@/store/player/hook'
import settingState from '@/store/setting/state'
import { scaleSizeW } from '@/utils/pixelRatio'
import { confirmDialog, createStyle, toast } from '@/utils/tools'
import { getCachedMusicProfile, getMusicProfile, getMusicProfilePath, type MusicProfile } from '@/core/musicProfile'
import { getMusicUrl as getOnlineMusicUrl } from '@/core/music/online'
import { downloadFile, existsFile, mkdir, privateStorageDirectoryPath, writeFile } from '@/utils/fs'
import SettingPitch from './SettingPopup/settings/SettingPitch'
import SettingPlaybackRate from './SettingPopup/settings/SettingPlaybackRate'
import ButtonPrimary from '@/components/common/ButtonPrimary'
import { updateSetting } from '@/core/common'
import { useSettingValue } from '@/store/setting/hook'
import { setPitch, setPlaybackRate, updateMetaData } from '@/plugins/player'
import { setPlaybackRate as setLyricPlaybackRate } from '@/core/lyric'
import playerState from '@/store/player/state'
import { playHaptic } from '@/utils/haptics'
import Slider, { type SliderProps } from '@/components/common/Slider'
import { getSystemVolume, setSystemVolume } from '@/utils/nativeModules/utils'
import { parseCueDocumentByExtension } from '@/shared/prompt/document'

const BTN_SIZES = {
  vertical: {
    width: scaleSizeW(42),
    marginLeft: 5,
    marginBottom: 0,
  },
  horizontal: {
    width: scaleSizeW(54),
    marginLeft: 0,
    marginBottom: 0,
  },
} as const
const ANALYZE_MAX_MS = 90_000
const FULL_ANALYZE_MAX_MS = 3_600_000
const ANALYZE_TICK_MS = 250
const ONLINE_PROFILE_DIR = `${privateStorageDirectoryPath}/lxmusic_profile_cache`
const ANALYZE_PHASES = {
  quick: ['准备音频', '识别节拍', '识别调号', '整理结果', '写回歌词'],
  full: ['准备全曲音频', '检测节拍网格', '识别调号与音区', '整理全曲结果', '写回歌词'],
} as const
const ANALYZE_VISUAL_MAX_MS = {
  quick: 55_000,
  full: 180_000,
} as const

const sanitizeName = (name: string) => name.replace(/[\\/:*?"<>|]/g, '_').trim() || `track_${Date.now()}`
const NOTE_TO_SEMITONE: Record<string, number> = {
  C: 0,
  'B#': 0,
  'C#': 1,
  Db: 1,
  D: 2,
  'D#': 3,
  Eb: 3,
  E: 4,
  Fb: 4,
  F: 5,
  'E#': 5,
  'F#': 6,
  Gb: 6,
  G: 7,
  'G#': 8,
  Ab: 8,
  A: 9,
  'A#': 10,
  Bb: 10,
  B: 11,
  Cb: 11,
}
const SEMITONE_TO_MAJOR_SYSTEM_NOTE = ['C', '#C', 'D', 'bE', 'E', 'F', '#F', 'G', '#G', 'A', 'bB', 'B'] as const
const SEMITONE_TO_FLAT_NOTE = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const
const DEGREE_LABELS = ['1', 'b2', '2', 'b3', '3', '4', '#4', '5', 'b6', '6', 'b7', '7'] as const
const DIATONIC_QUALITY_BY_DEGREE: Record<string, 'major' | 'minor' | 'dim'> = {
  '1': 'major',
  '2': 'minor',
  '3': 'minor',
  '4': 'major',
  '5': 'major',
  '6': 'minor',
  '7': 'dim',
}

type ParsedCueLine = {
  startMs: number
  text: string
}

type ChordSegment = NonNullable<MusicProfile['chordSegments']>[number]

type SheetMode = 'chord' | 'degree' | 'jianpu'

type SheetBeatCell = {
  startMs: number
  chordText: string
  degreeText: string
  jianpuText: string
  lyricText: string
}

type PitchSlotInfo = {
  startMs: number
  endMs: number
  token: string
}

type SheetBlock = {
  id: string
  startMs: number
  label: string
  beats: SheetBeatCell[]
  lyricLine: string
}

type WaveMarker = {
  id: string
  title: string
  timeMs: number
  midi: number
  noteText: string
  anchorText: string
}

const flatToChinese = (value: string) => value.replace(/Bb/g, 'bB').replace(/Eb/g, 'bE').replace(/Ab/g, 'bA').replace(/Db/g, 'bD').replace(/Gb/g, 'bG')

const normalizeChordSpelling = (value: string) => {
  const trimmed = value.trim()
  const matched = /^([A-G](?:#|b)?)(.*)$/.exec(trimmed)
  if (!matched) return trimmed
  const [, root, suffix] = matched
  const needsSharp = /^m(?!aj)|dim|m7|m9|m11|m13/i.test(suffix)
  if (!needsSharp) return trimmed
  const uncommonMinorRoots: Record<string, string> = {
    Ab: 'G#',
    Db: 'C#',
    Gb: 'F#',
    Cb: 'B',
  }
  return `${uncommonMinorRoots[root] ?? root}${suffix}`
}

const semitoneToDisplayNote = (semitone: number) => flatToChinese(SEMITONE_TO_FLAT_NOTE[((semitone % 12) + 12) % 12])
const semitoneToMajorSystemDisplayNote = (semitone: number) => SEMITONE_TO_MAJOR_SYSTEM_NOTE[((semitone % 12) + 12) % 12]

const normalizeDisplayKeyLabel = (value?: string | null) => {
  if (!value) return '未分析'
  const normalized = flatToChinese(value.trim())
  const minorMatched = /^([#b]?[A-G])m$/i.exec(normalized.replace(/^b([A-G])$/i, 'b$1'))
  if (minorMatched) return `${minorMatched[1]}小调`
  const majorMatched = /^([#b]?[A-G])$/i.exec(normalized)
  if (majorMatched) return `${majorMatched[1]}调`
  return normalized
}

const getAbsoluteTonicName = (profile: MusicProfile | null) => {
  if (profile?.keyTonic) return flatToChinese(profile.keyTonic)
  const display = profile?.majorKey?.trim()
  if (!display) return ''
  const minorMatched = /^([#b]?[A-G])(?:m|小调)$/i.exec(display)
  if (minorMatched) return flatToChinese(minorMatched[1])
  const majorMatched = /^([#b]?[A-G])(?:调)?$/i.exec(display)
  if (majorMatched) return flatToChinese(majorMatched[1])
  const zhMatched = /^([#b]?[A-G]).*$/.exec(display)
  return zhMatched ? flatToChinese(zhMatched[1]) : ''
}

const getMajorSystemDisplayKeyLabel = (profile: MusicProfile | null) => {
  const tonicName = getAbsoluteTonicName(profile)
  if (!tonicName) return '未分析'
  const tonicSemi = NOTE_TO_SEMITONE[tonicName.replace(/^b([A-G])$/, (_, note: string) => `${note}b`)]
    ?? NOTE_TO_SEMITONE[tonicName]
  if (tonicSemi == null) return normalizeDisplayKeyLabel(profile?.majorKey)
  const majorSystemSemi = profile?.keyMode == 'minor' ? tonicSemi + 3 : tonicSemi
  return `${semitoneToMajorSystemDisplayNote(majorSystemSemi)}调`
}

const getMajorSystemTonicName = (profile: MusicProfile | null) => {
  const tonicName = getAbsoluteTonicName(profile)
  if (!tonicName) return ''
  const tonicSemi = NOTE_TO_SEMITONE[tonicName.replace(/^b([A-G])$/, (_, note: string) => `${note}b`)]
    ?? NOTE_TO_SEMITONE[tonicName]
  if (tonicSemi == null) return tonicName
  return profile?.keyMode == 'minor' ? semitoneToDisplayNote(tonicSemi + 3) : tonicName
}

const getChordRoot = (label: string) => {
  const matched = /^([A-G](?:#|b)?)/.exec(label.trim())
  return matched ? matched[1] : ''
}

const isMinorChord = (label: string) => /m(?!aj)/i.test(label)
const isDiminishedChord = (label: string) => /dim|o/.test(label)

const getChordDegreeInfo = (label: string, tonicName: string) => {
  const root = getChordRoot(label)
  const rootSemi = NOTE_TO_SEMITONE[root]
  const tonicSemi = NOTE_TO_SEMITONE[tonicName.replace(/^b([A-G])$/, (_, note: string) => `${note}b`)]
    ?? NOTE_TO_SEMITONE[tonicName]
  if (rootSemi == null || tonicSemi == null) return null
  const interval = (rootSemi - tonicSemi + 12) % 12
  const degree = DEGREE_LABELS[interval]
  const diatonicQuality = DIATONIC_QUALITY_BY_DEGREE[degree]
  return {
    degree,
    diatonicQuality,
  }
}

const formatChordDisplayLabel = (label: string, tonicName: string) => {
  const matched = /^([A-G](?:#|b)?)(.*)$/.exec(label.trim())
  const normalizedLabel = flatToChinese(normalizeChordSpelling(label))
  const normalizedRoot = matched ? flatToChinese(matched[1]) : getChordRoot(normalizedLabel) || normalizedLabel
  const suffix = matched?.[2] ?? ''
  const simpleLabel = isMinorChord(suffix) || isDiminishedChord(suffix) ? `${normalizedRoot}m` : normalizedRoot
  const degreeInfo = getChordDegreeInfo(simpleLabel, tonicName)
  if (!degreeInfo) return { title: simpleLabel, suffix: '', functionHint: '' }
  if (simpleLabel.endsWith('m')) return { title: simpleLabel, suffix: `${degreeInfo.degree}m`, functionHint: '' }
  return { title: simpleLabel, suffix: '', functionHint: degreeInfo.degree }
}

const splitSimpleChord = (label: string) => {
  const normalized = flatToChinese(normalizeChordSpelling(label))
  const matched = /^([A-G](?:#|b)?)(.*)$/.exec(normalized.trim())
  if (!matched) return { root: normalized, quality: '' }
  const suffix = matched[2] || ''
  const quality = /dim|o/i.test(suffix)
    ? 'dim'
    : /^m(?!aj)/i.test(suffix)
      ? 'm'
      : ''
  return {
    root: flatToChinese(matched[1]),
    quality,
  }
}

const transposeSimpleChord = (label: string, semitoneOffset: number) => {
  const { root, quality } = splitSimpleChord(label)
  const rootSemi = NOTE_TO_SEMITONE[root.replace(/^b([A-G])$/, (_, note: string) => `${note}b`)] ?? NOTE_TO_SEMITONE[root]
  if (rootSemi == null) return `${root}${quality}`
  return `${semitoneToDisplayNote(rootSemi + semitoneOffset)}${quality}`
}

const degreeTextForChord = (label: string, tonicName: string) => {
  const { root, quality } = splitSimpleChord(label)
  const normalizedRoot = root.replace(/^b([A-G])$/, (_, note: string) => `${note}b`)
  const normalizedTonic = tonicName.replace(/^b([A-G])$/, (_, note: string) => `${note}b`)
  const rootSemi = NOTE_TO_SEMITONE[normalizedRoot] ?? NOTE_TO_SEMITONE[root]
  const tonicSemi = NOTE_TO_SEMITONE[normalizedTonic] ?? NOTE_TO_SEMITONE[tonicName]
  if (rootSemi == null || tonicSemi == null) return ''
  const interval = (rootSemi - tonicSemi + 12) % 12
  const degree = DEGREE_LABELS[interval]
  if (quality == 'dim') return `${degree}dim`
  if (quality == 'm') return `${degree}m`
  return degree
}

const intervalToJianpu = (interval: number) => {
  const map: Record<number, string> = {
    0: '1',
    1: '#1',
    2: '2',
    3: '#2',
    4: '3',
    5: '4',
    6: '#4',
    7: '5',
    8: '#5',
    9: '6',
    10: '#6',
    11: '7',
  }
  return map[((interval % 12) + 12) % 12] || '-'
}

const buildJianpuLine = (
  text: string,
  lineStartMs: number,
  lineEndMs: number,
  pitchTrack: NonNullable<MusicProfile['pitchTrack']>,
  tonicName: string,
) => {
  if (!pitchTrack.length) return ''
  const tonicSemi = NOTE_TO_SEMITONE[tonicName.replace(/^b([A-G])$/, (_, note: string) => `${note}b`)] ?? NOTE_TO_SEMITONE[tonicName]
  if (tonicSemi == null) return ''
  const visibleChars = Array.from(text)
  const pitchChars = visibleChars.filter(char => char.trim()).length
  if (!pitchChars) return ''
  let charIndex = 0
  return visibleChars.map(char => {
    if (!char.trim()) return '   '
    const ratio = (charIndex + 0.5) / pitchChars
    const targetMs = lineStartMs + ratio * Math.max(1, lineEndMs - lineStartMs)
    charIndex += 1
    const nearest = pitchTrack.reduce((prev, frame) => {
      if (!prev) return frame
      return Math.abs(frame.timeMs - targetMs) < Math.abs(prev.timeMs - targetMs) ? frame : prev
    }, null as NonNullable<MusicProfile['pitchTrack']>[number] | null)
    if (!nearest) return ' - '
    const degree = intervalToJianpu(Math.round(nearest.midi) - tonicSemi)
    return degree.length == 1 ? ` ${degree} ` : `${degree} `
  }).join('').trimEnd()
}

const formatTime = (ms?: number | null) => typeof ms == 'number' && Number.isFinite(ms)
  ? `${(ms / 1000).toFixed(2)}s`
  : '-'

const formatLrcTime = (ms: number) => {
  const total = Math.max(0, ms)
  const minutes = Math.floor(total / 60_000)
  const seconds = Math.floor((total % 60_000) / 1000)
  const hundredths = Math.floor((total % 1000) / 10)
  return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}]`
}

const getProfileDetailPath = (filePath: string) => `${filePath}.lx-profile-detail.json`

const getChordLrcPath = (filePath: string) => {
  const dotIndex = filePath.lastIndexOf('.')
  return dotIndex > -1 ? `${filePath.slice(0, dotIndex)}.lx-chords.lrc` : `${filePath}.lx-chords.lrc`
}

const normalizePitchLabel = (value?: string | null) => {
  if (!value) return '未分析'
  const matched = /^([A-G])(#|b)?(-?\d+)?$/.exec(value.trim())
  if (!matched) return flatToChinese(value)
  const [, note, accidental = '', octave = ''] = matched
  const display = accidental == '#'
    ? `#${note}`
    : accidental == 'b'
      ? `b${note}`
      : note
  return `${display}${octave}`
}

const parseLyricCues = (rawLyric: string): ParsedCueLine[] => {
  if (!rawLyric.trim()) return []
  const doc = parseCueDocumentByExtension('current.lrc', rawLyric)
  return doc.cues
    .filter(cue => typeof cue.startMs == 'number' && cue.text.trim())
    .map(cue => ({
      startMs: cue.startMs as number,
      text: cue.text.trim(),
    }))
}

const extractLyricTextLines = (rawLyric: string) => {
  if (!rawLyric.trim()) return []
  return rawLyric
    .split(/\r?\n/)
    .map(line => line
      .replace(/\[[^\]]*]/g, '')
      .replace(/\{.*?\}/g, '')
      .replace(/\\N/gi, '\n')
      .trim())
    .flatMap(line => line.split('\n').map(item => item.trim()))
    .filter(line => line && !/^(调号|拍速|节拍|分析时间|最高音)：/.test(line))
}

const buildFallbackCueLines = (profile: MusicProfile | null, rawLyric: string) => {
  const lyricLines = extractLyricTextLines(rawLyric)
  const durationMs = Math.max(
    profile?.analyzedDurationMs ?? 0,
    ...(profile?.chordSegments ?? []).map(segment => segment.endMs),
  )
  if (!durationMs || !lyricLines.length) return []
  return lyricLines.map((text, index) => ({
    startMs: lyricLines.length <= 1
      ? 0
      : Math.round((index / Math.max(1, lyricLines.length - 1)) * durationMs),
    text,
  }))
}

const buildChordLrc = (profile: MusicProfile, rawLyric: string) => {
  const chordSegments = profile.chordSegments ?? []
  if (!chordSegments.length) return ''
  const cues = parseLyricCues(rawLyric)
  const tonicName = getMajorSystemTonicName(profile)
  const lines = [
    '[ti:LX Chord Draft]',
    `[ar:${normalizeDisplayKeyLabel(profile.majorKey)}${profile.timeSignature ? ` / ${profile.timeSignature}` : ''}]`,
  ]
  if (!cues.length) {
    chordSegments.forEach(segment => {
      const display = formatChordDisplayLabel(segment.label, tonicName)
      lines.push(`${formatLrcTime(segment.startMs)}${display.title}`)
    })
    return lines.join('\n')
  }
  cues.forEach(cue => {
    const matched = chordSegments.find(segment => cue.startMs >= segment.startMs && cue.startMs < segment.endMs)
      ?? chordSegments.reduce((prev, segment) => {
        if (!prev) return segment
        return Math.abs(segment.startMs - cue.startMs) < Math.abs(prev.startMs - cue.startMs) ? segment : prev
      }, null as ChordSegment | null)
    if (!matched) return
    const display = formatChordDisplayLabel(matched.label, tonicName)
    lines.push(`${formatLrcTime(cue.startMs)}${display.title} | ${cue.text}`)
  })
  return lines.join('\n')
}

type TextPlacement = {
  start: number
  text: string
}

type SheetAnchor = {
  startMs: number
  text: string
  isInstrumental?: boolean
}

const layoutTextPlacements = (length: number, placements: TextPlacement[]) => {
  const safeLength = Math.max(1, length)
  const chars = new Array(safeLength).fill(' ')
  let nextFreeIndex = 0
  placements
    .filter(item => item.text.trim())
    .sort((left, right) => left.start - right.start || right.text.length - left.text.length)
    .forEach(item => {
      const maxStart = Math.max(0, safeLength - item.text.length)
      const desiredStart = Math.max(0, Math.min(maxStart, item.start))
      const safeStart = Math.max(desiredStart, Math.min(maxStart, nextFreeIndex))
      if (safeStart >= safeLength) return
      for (let index = 0; index < item.text.length && safeStart + index < safeLength; index += 1) {
        chars[safeStart + index] = item.text[index]
      }
      nextFreeIndex = Math.min(safeLength, safeStart + item.text.length + 1)
    })
  return chars.join('').replace(/\s+$/g, '')
}

const getMeterBeatCount = (timeSignature?: MusicProfile['timeSignature']) => {
  switch (timeSignature) {
    case '3/4': return 3
    case '6/8': return 6
    case '4/4':
    default:
      return 4
  }
}

const getJianpuSubdivisionCount = (timeSignature?: MusicProfile['timeSignature']) => {
  switch (timeSignature) {
    case '6/8':
      return 1
    case '3/4':
    case '4/4':
    default:
      return 2
  }
}

const formatInstrumentLabel = (startMs: number, profile: MusicProfile | null) => {
  const beatIntervalMs = Math.max(1, Math.round(profile?.beatIntervalMs || 600))
  const firstBeatOffsetMs = Math.max(0, Math.round(profile?.firstBeatOffsetMs || 0))
  const meterBeatCount = getMeterBeatCount(profile?.timeSignature)
  const beatsFromStart = Math.max(0, Math.round((startMs - firstBeatOffsetMs) / beatIntervalMs))
  const barIndex = Math.floor(beatsFromStart / meterBeatCount) + 1
  const beatIndex = (beatsFromStart % meterBeatCount) + 1
  return `间奏 第${barIndex}小节 第${beatIndex}拍`
}

const getProfileDurationMs = (profile: MusicProfile | null) => Math.max(
  profile?.analyzedDurationMs ?? 0,
  ...(profile?.chordSegments ?? []).map(segment => segment.endMs),
)

const buildBeatBoundaries = (profile: MusicProfile | null) => {
  const durationMs = getProfileDurationMs(profile)
  if (!profile || !durationMs) return []
  const beatIntervalMs = Math.max(1, Math.round(profile.beatIntervalMs || 600))
  const firstBeatOffsetMs = Math.max(0, Math.round(profile.firstBeatOffsetMs || 0))
  const beatTimes: number[] = []
  for (let timeMs = Math.min(firstBeatOffsetMs, durationMs); timeMs <= durationMs + beatIntervalMs; timeMs += beatIntervalMs) {
    beatTimes.push(timeMs)
  }
  if (!beatTimes.length || beatTimes[0] > 0) beatTimes.unshift(0)
  return beatTimes
}

const findSegmentForRange = (segments: ChordSegment[], startMs: number, endMs: number) => {
  let bestSegment: ChordSegment | null = null
  let bestOverlap = 0
  segments.forEach(segment => {
    const overlap = Math.min(endMs, segment.endMs) - Math.max(startMs, segment.startMs)
    if (overlap > bestOverlap) {
      bestOverlap = overlap
      bestSegment = segment
    }
  })
  if (bestSegment) return bestSegment
  return segments
    .filter(segment => segment.startMs <= startMs)
    .sort((left, right) => right.startMs - left.startMs)[0] ?? null
}

const buildPitchSlots = (
  beatTimes: number[],
  pitchTrack: NonNullable<MusicProfile['pitchTrack']>,
  tonicName: string,
  timeSignature?: MusicProfile['timeSignature'],
) => {
  if (!pitchTrack.length) return new Map<number, PitchSlotInfo[]>()
  const tonicSemi = NOTE_TO_SEMITONE[tonicName.replace(/^b([A-G])$/, (_, note: string) => `${note}b`)] ?? NOTE_TO_SEMITONE[tonicName]
  if (tonicSemi == null) return new Map<number, PitchSlotInfo[]>()

  const subdivisionCount = getJianpuSubdivisionCount(timeSignature)
  const slotMap = new Map<number, PitchSlotInfo[]>()
  let frameIndex = 0
  let previousToken = ''

  for (let beatIndex = 0; beatIndex < beatTimes.length - 1; beatIndex += 1) {
    const beatStartMs = beatTimes[beatIndex]
    const beatEndMs = beatTimes[beatIndex + 1]
    const beatDurationMs = Math.max(1, beatEndMs - beatStartMs)
    const slots: PitchSlotInfo[] = []

    for (let slotIndex = 0; slotIndex < subdivisionCount; slotIndex += 1) {
      const startMs = beatStartMs + beatDurationMs * slotIndex / subdivisionCount
      const endMs = beatStartMs + beatDurationMs * (slotIndex + 1) / subdivisionCount
      const energyMap = new Map<number, number>()

      while (frameIndex < pitchTrack.length && pitchTrack[frameIndex].timeMs < startMs) frameIndex += 1
      let scanIndex = frameIndex
      while (scanIndex < pitchTrack.length && pitchTrack[scanIndex].timeMs < endMs) {
        const midi = Math.round(pitchTrack[scanIndex].midi)
        const weight = Math.max(0.05, pitchTrack[scanIndex].weight ?? 0.12)
        energyMap.set(midi, (energyMap.get(midi) || 0) + weight)
        scanIndex += 1
      }

      let token = '0'
      let bestMidi: number | null = null
      let bestWeight = 0
      energyMap.forEach((weight, midi) => {
        if (weight > bestWeight) {
          bestWeight = weight
          bestMidi = midi
        }
      })
      if (bestMidi != null) token = intervalToJianpu(bestMidi - tonicSemi)
      if (token != '0' && token == previousToken) token = '-'
      if (token != '-') previousToken = token == '0' ? '' : token

      slots.push({
        startMs,
        endMs,
        token,
      })
    }

    slotMap.set(beatIndex, slots)
  }

  return slotMap
}

const simplifyBeatCells = (cells: SheetBeatCell[]) => {
  if (cells.length <= 2) return cells
  const next = cells.map(cell => ({ ...cell }))
  const groupChord = (target: SheetBeatCell[]) => {
    const groups: Array<{ start: number, end: number, chord: string }> = []
    let start = 0
    while (start < target.length) {
      let end = start + 1
      while (end < target.length && target[end].chordText == target[start].chordText) end += 1
      groups.push({ start, end, chord: target[start].chordText })
      start = end
    }
    return groups
  }

  let groups = groupChord(next)
  while (groups.length > 3) {
    const bridgeGroup = groups.find((group, index) => index > 0 && index < groups.length - 1 && group.end - group.start == 1)
    if (!bridgeGroup) break
    const groupIndex = groups.indexOf(bridgeGroup)
    const prev = groups[groupIndex - 1]
    const currentCell = next[bridgeGroup.start]
    const leftDistance = Math.abs((NOTE_TO_SEMITONE[getChordRoot(prev.chord)] ?? 0) - (NOTE_TO_SEMITONE[getChordRoot(currentCell.chordText)] ?? 0))
    const right = groups[groupIndex + 1]
    const rightDistance = Math.abs((NOTE_TO_SEMITONE[getChordRoot(right.chord)] ?? 0) - (NOTE_TO_SEMITONE[getChordRoot(currentCell.chordText)] ?? 0))
    const replacement = leftDistance <= rightDistance ? next[prev.start] : next[right.start]
    next[bridgeGroup.start] = {
      ...next[bridgeGroup.start],
      chordText: replacement.chordText,
      degreeText: replacement.degreeText,
    }
    groups = groupChord(next)
  }
  return next
}

const buildBeatLyricFragments = (text: string, beatCount: number) => {
  const normalized = text.trim()
  if (!normalized) return Array.from({ length: beatCount }, () => '')
  if (normalized.startsWith('间奏')) {
    return [normalized, ...Array.from({ length: Math.max(0, beatCount - 1) }, () => '')]
  }
  const words = normalized.split(/\s+/).filter(Boolean)
  if (words.length > 1) {
    const fragments = Array.from({ length: beatCount }, () => '')
    words.forEach((word, index) => {
      const targetIndex = Math.min(beatCount - 1, Math.floor(index / Math.max(1, words.length) * beatCount))
      fragments[targetIndex] = fragments[targetIndex] ? `${fragments[targetIndex]} ${word}` : word
    })
    return fragments
  }
  const chars = Array.from(normalized)
  const fragments = Array.from({ length: beatCount }, () => '')
  chars.forEach((char, index) => {
    const targetIndex = Math.min(beatCount - 1, Math.floor(index / Math.max(1, chars.length) * beatCount))
    fragments[targetIndex] += char
  })
  return fragments
}

const buildJianpuMeasureText = (block: SheetBlock) => {
  const notes = block.beats.map(beat => (beat.jianpuText || '--').replace(/0/g, '·'))
  return `${block.label} | ${notes.join(' ')} |`
}

const buildJianpuLyricText = (block: SheetBlock) => {
  const lyrics = block.beats.map(beat => beat.lyricText || ' ')
  return `   | ${lyrics.join('  ')} |`
}

const buildCompactBarLabel = (barIndex: number, beatCount: number) => `${String(barIndex).padStart(2, '0')}|${Array.from({ length: beatCount }, (_, index) => index + 1).join('')}`

const buildBarAnchors = (profile: MusicProfile | null): SheetAnchor[] => {
  if (!profile) return []
  const beatIntervalMs = Math.max(1, Math.round(profile.beatIntervalMs || 600))
  const meterBeatCount = getMeterBeatCount(profile.timeSignature)
  const barIntervalMs = Math.max(beatIntervalMs, beatIntervalMs * meterBeatCount)
  const firstBeatOffsetMs = Math.max(0, Math.round(profile.firstBeatOffsetMs || 0))
  const durationMs = Math.max(
    profile.analyzedDurationMs || 0,
    ...(profile.chordSegments ?? []).map(segment => segment.endMs),
  )
  if (!durationMs) return []
  const anchors: SheetAnchor[] = []
  for (let startMs = Math.min(firstBeatOffsetMs, durationMs); startMs < durationMs; startMs += barIntervalMs) {
    anchors.push({
      startMs,
      text: formatInstrumentLabel(startMs, profile),
      isInstrumental: true,
    })
  }
  if (!anchors.length || anchors[0].startMs > 0) {
    anchors.unshift({
      startMs: 0,
      text: formatInstrumentLabel(0, profile),
      isInstrumental: true,
    })
  }
  return anchors
}

const buildSheetAnchors = (profile: MusicProfile | null, cues: ParsedCueLine[], rawLyric: string) => {
  const durationMs = Math.max(
    profile?.analyzedDurationMs ?? 0,
    ...(profile?.chordSegments ?? []).map(segment => segment.endMs),
  )
  if (!durationMs) return []
  const lyricAnchors = (cues.length >= 2 ? cues : buildFallbackCueLines(profile, rawLyric))
    .map(cue => ({
      startMs: cue.startMs,
      text: cue.text,
      isInstrumental: false,
    }))
  const allAnchors = [...buildBarAnchors(profile)]
  const beatIntervalMs = Math.max(1, Math.round(profile?.beatIntervalMs || 600))
  const fillerStepMs = beatIntervalMs * getMeterBeatCount(profile?.timeSignature)
  lyricAnchors.forEach(anchor => {
    const existingIndex = allAnchors.findIndex(item => Math.abs(item.startMs - anchor.startMs) <= Math.max(120, beatIntervalMs / 2))
    if (existingIndex >= 0) allAnchors[existingIndex] = anchor
    else allAnchors.push(anchor)
  })

  const deduped = allAnchors
    .sort((left, right) => left.startMs - right.startMs)
    .filter((anchor, index, list) => {
      if (index == 0) return true
      const prev = list[index - 1]
      return Math.abs(prev.startMs - anchor.startMs) > Math.max(120, fillerStepMs / 3) || prev.text != anchor.text
    })
    .filter(anchor => anchor.startMs <= durationMs)
  return deduped
}

const buildSheetBlocks = (profile: MusicProfile | null, cues: ParsedCueLine[], rawLyric: string, capoSemitone: number): SheetBlock[] => {
  if (!profile?.chordSegments?.length) return []
  const beatTimes = buildBeatBoundaries(profile)
  if (beatTimes.length < 2) return []
  const tonicName = getMajorSystemTonicName(profile)
  const pitchTrack = profile.pitchTrack ?? []
  const meterBeatCount = getMeterBeatCount(profile.timeSignature)
  const lyricAnchors = buildSheetAnchors(profile, cues, rawLyric)
  const pitchSlotMap = buildPitchSlots(beatTimes, pitchTrack, tonicName, profile.timeSignature)
  const blocks: SheetBlock[] = []
  for (let beatIndex = 0, barIndex = 1; beatIndex < beatTimes.length - 1; beatIndex += meterBeatCount, barIndex += 1) {
    const beats: SheetBeatCell[] = []
    const blockStart = beatTimes[beatIndex]
    const blockEnd = beatTimes[Math.min(beatTimes.length - 1, beatIndex + meterBeatCount)]
    for (let offset = 0; offset < meterBeatCount && beatIndex + offset < beatTimes.length - 1; offset += 1) {
      const startMs = beatTimes[beatIndex + offset]
      const endMs = beatTimes[beatIndex + offset + 1]
      const segment = findSegmentForRange(profile.chordSegments!, startMs, endMs)
      const chordText = segment ? transposeSimpleChord(segment.label, -capoSemitone) : '--'
      const degreeText = segment ? degreeTextForChord(segment.label, tonicName) || '--' : '--'
      const jianpuText = (pitchSlotMap.get(beatIndex + offset) ?? []).map(slot => slot.token).join('') || '--'
      beats.push({
        startMs,
        chordText,
        degreeText,
        jianpuText,
        lyricText: '',
      })
    }
    if (!beats.length) continue
    const simplifiedBeats = simplifyBeatCells(beats)
    const lyricLine = lyricAnchors
      .filter(anchor => !anchor.isInstrumental && anchor.startMs >= blockStart && anchor.startMs < blockEnd)
      .map(anchor => anchor.text.trim())
      .filter(Boolean)
      .join(' / ')
      || lyricAnchors
        .filter(anchor => anchor.isInstrumental && anchor.startMs >= blockStart && anchor.startMs < blockEnd)
        .map(anchor => anchor.text.trim())
        .filter(Boolean)[0]
      || ''
    const lyricFragments = buildBeatLyricFragments(lyricLine, simplifiedBeats.length)
    blocks.push({
      id: `${blockStart}_${barIndex}`,
      startMs: blockStart,
      label: buildCompactBarLabel(barIndex, beats.length),
      beats: simplifiedBeats.map((beat, index) => ({
        ...beat,
        lyricText: lyricFragments[index] || '',
      })),
      lyricLine,
    })
  }
  return blocks.map(block => {
    return {
      ...block,
    }
  })
}

const deriveAnalyzePhaseText = (scope: 'quick' | 'full', progress: number) => {
  const phases = ANALYZE_PHASES[scope]
  const index = Math.min(phases.length - 1, Math.floor(Math.max(0, Math.min(0.999, progress)) * phases.length))
  return phases[index]
}

const getNearestCueText = (cues: ParsedCueLine[], targetMs?: number | null) => {
  if (typeof targetMs != 'number' || !Number.isFinite(targetMs) || !cues.length) return formatTime(targetMs)
  const matched = cues.reduce((prev, cue) => {
    if (!prev) return cue
    return Math.abs(cue.startMs - targetMs) < Math.abs(prev.startMs - targetMs) ? cue : prev
  }, null as ParsedCueLine | null)
  return matched?.text || formatTime(targetMs)
}

const getMarkerOffset = (timeMs: number, durationMs: number) => {
  const ratio = Math.max(0, Math.min(1, timeMs / Math.max(1, durationMs)))
  if (ratio > 0.82) return -126
  if (ratio > 0.68) return -96
  if (ratio < 0.18) return -10
  if (ratio < 0.32) return -26
  return -58
}

const getMarkerVerticalOffset = (midi: number, pitchMin: number, pitchMax: number) => {
  const ratio = (midi - pitchMin) / Math.max(1, pitchMax - pitchMin)
  if (ratio < 0.18) return -88
  if (ratio < 0.28) return -68
  if (ratio > 0.84) return -6
  return -30
}

const buildWaveMarkers = (profile: MusicProfile | null, cues: ParsedCueLine[]): WaveMarker[] => {
  if (!profile) return []
  const result: WaveMarker[] = []
  if (typeof profile.highestMidi == 'number' && typeof profile.highestTimeMs == 'number') {
    result.push({
      id: 'highest',
      title: '最高音',
      timeMs: profile.highestTimeMs,
      midi: profile.highestMidi,
      noteText: normalizePitchLabel(profile.highestNote),
      anchorText: getNearestCueText(cues, profile.highestTimeMs),
    })
  }
  if (typeof profile.lowestMidi == 'number' && typeof profile.lowestTimeMs == 'number') {
    result.push({
      id: 'lowest',
      title: '最低音',
      timeMs: profile.lowestTimeMs,
      midi: profile.lowestMidi,
      noteText: normalizePitchLabel(profile.lowestNote),
      anchorText: getNearestCueText(cues, profile.lowestTimeMs),
    })
  }
  return result
}

const getOnlineAnalyzePath = (musicInfo: LX.Music.MusicInfo) => {
  const ext = musicInfo.source == 'local' ? musicInfo.meta.ext.trim() || 'mp3' : 'mp3'
  return `${ONLINE_PROFILE_DIR}/${sanitizeName(`${musicInfo.source}_${musicInfo.id}_${musicInfo.name}_${musicInfo.singer}`)}.${ext}`
}

export default memo(({ direction }: {
  direction: 'vertical' | 'horizontal'
}) => {
  const theme = useTheme()
  const popupRef = useRef<PopupType>(null)
  const detailPopupRef = useRef<PopupType>(null)
  const chordPopupRef = useRef<PopupType>(null)
  const playMusicInfo = usePlayMusicInfo()
  const [visible, setVisible] = useState(false)
  const [detailVisible, setDetailVisible] = useState(false)
  const [chordVisible, setChordVisible] = useState(false)
  const [sheetMode, setSheetMode] = useState<SheetMode>('chord')
  const [capoSemitone, setCapoSemitone] = useState(0)
  const [profile, setProfile] = useState<MusicProfile | null>(null)
  const [loading, setLoading] = useState(false)
  const [analyzeScope, setAnalyzeScope] = useState<'quick' | 'full'>('quick')
  const [progress, setProgress] = useState(0)
  const [progressText, setProgressText] = useState('')
  const [systemVolume, setSystemVolumeState] = useState(0.5)
  const [sliderValue, setSliderValue] = useState(50)
  const [isSystemVolumeSliding, setSystemVolumeSliding] = useState(false)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const mountedRef = useRef(true)
  const pitchSemitones = useSettingValue('player.pitchSemitones')
  const playbackRate = useSettingValue('player.playbackRate')
  const musicInfo = playMusicInfo.musicInfo && !('progress' in playMusicInfo.musicInfo) ? playMusicInfo.musicInfo : null
  const localProfilePath = useMemo(() => getMusicProfilePath(musicInfo), [musicInfo])
  const onlineAnalyzePath = useMemo(() => {
    if (!musicInfo || localProfilePath) return ''
    return getOnlineAnalyzePath(musicInfo)
  }, [localProfilePath, musicInfo])
  const profilePath = localProfilePath || onlineAnalyzePath
  const latestProfilePathRef = useRef(profilePath)
  const rawLyric = playerState.musicInfo.rawlrc || playerState.musicInfo.lrc || ''
  const lyricCues = useMemo(() => parseLyricCues(rawLyric), [rawLyric])
  const sheetBlocks = useMemo(() => buildSheetBlocks(profile, lyricCues, rawLyric, capoSemitone), [profile, lyricCues, rawLyric, capoSemitone])
  const waveMarkers = useMemo(() => buildWaveMarkers(profile, lyricCues), [profile, lyricCues])

  useEffect(() => {
    latestProfilePathRef.current = profilePath
  }, [profilePath])

  useEffect(() => {
    let canceled = false
    setProfile(null)
    if (!profilePath) return
    void getCachedMusicProfile(profilePath).then(result => {
      if (canceled) return
      if (result) setProfile(result)
    })
    return () => {
      canceled = true
    }
  }, [profilePath])

  useEffect(() => {
    return () => {
      mountedRef.current = false
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!visible) return
    void getSystemVolume().then(value => {
      const nextValue = Math.max(0, Math.min(1, value))
      setSystemVolumeState(nextValue)
      setSliderValue(Math.round(nextValue * 100))
    }).catch(() => {})
  }, [visible])

  if (!musicInfo) return null

  const btnStyle = BTN_SIZES[direction]
  const label = loading ? '分析中' : getMajorSystemDisplayKeyLabel(profile)
  const bpmText = profile ? `${Math.round(profile.bpm)} BPM` : '未分析'
  const displayKeyText = getMajorSystemDisplayKeyLabel(profile)
  const tonicText = getMajorSystemTonicName(profile) || '未分析'
  const highestNoteText = profile?.highestNote
    ? `${normalizePitchLabel(profile.highestNote)}${typeof profile.highestFreqHz == 'number' ? ` / ${profile.highestFreqHz.toFixed(1)} Hz` : ''}`
    : '未分析'
  const lowestNoteText = profile?.lowestNote
    ? `${normalizePitchLabel(profile.lowestNote)}${typeof profile.lowestFreqHz == 'number' ? ` / ${profile.lowestFreqHz.toFixed(1)} Hz` : ''}`
    : '未分析'
  const averageNoteText = profile?.averageNote ? normalizePitchLabel(profile.averageNote) : '未分析'
  const commonHighText = profile?.commonHighNote
    ? normalizePitchLabel(profile.commonHighNote)
    : profile?.dominantHighNote
      ? normalizePitchLabel(profile.dominantHighNote)
      : '未分析'
  const commonLowText = profile?.commonLowNote
    ? normalizePitchLabel(profile.commonLowNote)
    : profile?.dominantLowNote
      ? normalizePitchLabel(profile.dominantLowNote)
      : '未分析'
  const hasFullAnalysis = profile?.analysisScope == 'full'
  const waveformSamples = profile?.waveformSamples?.length ? profile.waveformSamples : new Array(48).fill(0.24)
  const pitchValues = [
    profile?.highestMidi,
    profile?.lowestMidi,
    profile?.averageMidi,
    profile?.commonHighMidi,
    profile?.commonLowMidi,
  ].filter((value): value is number => typeof value == 'number' && Number.isFinite(value))
  const pitchMin = pitchValues.length ? Math.min(...pitchValues) - 2 : 45
  const pitchMax = pitchValues.length ? Math.max(...pitchValues) + 2 : 80
  const getPitchTop = (midi?: number | null) => {
    if (typeof midi != 'number' || !Number.isFinite(midi)) return '50%'
    const ratio = 1 - ((midi - pitchMin) / Math.max(1, pitchMax - pitchMin))
    return `${Math.max(0, Math.min(1, ratio)) * 100}%`
  }
  const getMarkerLeft = (timeMs: number) => `${Math.max(0, Math.min(1, timeMs / Math.max(1, profile?.analyzedDurationMs || timeMs || 1))) * 100}%`
const activeSheetTitle = sheetMode == 'chord' ? '和弦' : sheetMode == 'degree' ? '级数' : '简谱'

  const ensureAnalyzePath = async() => {
    if (localProfilePath) return localProfilePath
    const onlineMusicInfo = musicInfo as LX.Music.MusicInfoOnline
    await mkdir(ONLINE_PROFILE_DIR).catch(() => {})
    if (!await existsFile(onlineAnalyzePath).catch(() => false)) {
      setProgressText('下载在线音频中')
      const url = await getOnlineMusicUrl({
        musicInfo: onlineMusicInfo,
        quality: settingState.setting['player.playQuality'],
        isRefresh: true,
        allowToggleSource: true,
        onToggleSource: () => {},
      })
      await downloadFile(url, onlineAnalyzePath, {
        connectionTimeout: 20000,
        readTimeout: 30000,
      }).promise
    }
    return onlineAnalyzePath
  }

  const persistExtendedArtifacts = async(taskPath: string, result: MusicProfile) => {
    await writeFile(getProfileDetailPath(taskPath), JSON.stringify(result, null, 2))
    const chordLrc = buildChordLrc(result, rawLyric)
    if (chordLrc) await writeFile(getChordLrcPath(taskPath), chordLrc)
  }

  const handleAnalyze = (scope: 'quick' | 'full') => {
    if (loading) return
    const analyzeMaxMs = scope == 'full' ? FULL_ANALYZE_MAX_MS : ANALYZE_MAX_MS
    setAnalyzeScope(scope)
    setLoading(true)
    setProgress(0.02)
    setProgressText(scope == 'full' ? '准备全曲音频' : '准备音频')
    const startTime = Date.now()
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime
      const visualMaxMs = ANALYZE_VISUAL_MAX_MS[scope]
      const nextProgress = Math.min(0.9, elapsed / visualMaxMs)
      setProgress(nextProgress)
      setProgressText(deriveAnalyzePhaseText(scope, nextProgress))
    }, ANALYZE_TICK_MS)
    void ensureAnalyzePath().then(async taskPath => {
      latestProfilePathRef.current = taskPath
      setProgressText(scope == 'full' ? '识别调号、节拍和音区中' : '识别调号与节拍中')
      const result = await getMusicProfile(taskPath, analyzeMaxMs)
      if (!mountedRef.current || latestProfilePathRef.current != taskPath) return
      if (timerRef.current) clearInterval(timerRef.current)
      timerRef.current = null
      setProgress(0.98)
      setProgressText('写回歌词与缓存')
      await persistExtendedArtifacts(taskPath, result).catch(() => {})
      setProfile(result)
      setProgress(1)
      setProgressText('分析完成')
      playHaptic('success')
      toast(scope == 'full'
        ? (localProfilePath ? '全曲分析完成，结果已更新到歌词/缓存' : '全曲分析完成，已更新在线歌曲缓存')
        : (localProfilePath ? '分析完成，结果已写入歌词/缓存' : '分析完成，已缓存在线歌曲调号'))
    }).catch(err => {
      if (!mountedRef.current) return
      if (timerRef.current) clearInterval(timerRef.current)
      timerRef.current = null
      setProgress(0)
      setProgressText('')
      toast((err as Error).message || '调号分析失败')
    }).finally(() => {
      if (!mountedRef.current) return
      setLoading(false)
    })
  }

  const handleAnalyzePress = (scope: 'quick' | 'full') => {
    if (scope == 'full' && hasFullAnalysis) {
      void confirmDialog({
        title: '重新全曲分析',
        message: '再次分析会覆盖当前全曲结果，是否继续？',
      }).then(confirm => {
        if (!confirm) return
        handleAnalyze('full')
      })
      return
    }
    handleAnalyze(scope)
  }

  const handleOpen = () => {
    if (visible) popupRef.current?.setVisible(true)
    else {
      setVisible(true)
      requestAnimationFrame(() => {
        popupRef.current?.setVisible(true)
      })
    }
  }

  const handleOpenDetail = () => {
    if (!profile) {
      toast('请先完成分析')
      return
    }
    if (detailVisible) detailPopupRef.current?.setVisible(true)
    else {
      setDetailVisible(true)
      requestAnimationFrame(() => {
        detailPopupRef.current?.setVisible(true)
      })
    }
  }

  const handleOpenChord = () => {
    if (!hasFullAnalysis) {
      toast('请先完成全曲分析')
      return
    }
    if (chordVisible) chordPopupRef.current?.setVisible(true)
    else {
      setChordVisible(true)
      requestAnimationFrame(() => {
        chordPopupRef.current?.setVisible(true)
      })
    }
  }

  const jumpToTime = (timeMs: number) => {
    const seconds = Math.max(0, timeMs / 1000)
    global.app_event.setProgress(seconds, playerState.progress.maxPlayTime || undefined)
    toast(`已跳转到 ${formatTime(timeMs)}`)
  }

  const handlePitchStep = (delta: number) => {
    const nextValue = Math.max(-12, Math.min(12, pitchSemitones + delta))
    if (nextValue == pitchSemitones) return
    playHaptic('selection')
    void setPitch(nextValue).then(() => {
      updateSetting({ 'player.pitchSemitones': nextValue })
    }).catch(() => {
      toast('升降调设置失败')
    })
  }

  const handlePitchReset = () => {
    if (pitchSemitones == 0) return
    playHaptic('selection')
    void setPitch(0).then(() => {
      updateSetting({ 'player.pitchSemitones': 0 })
    }).catch(() => {
      toast('升降调设置失败')
    })
  }

  const handlePlaybackRateStep = (delta: number) => {
    const nextRate = Math.max(0.6, Math.min(2, parseFloat((playbackRate + delta).toFixed(2))))
    if (nextRate == playbackRate) return
    playHaptic('selection')
    void setPlaybackRate(nextRate).then(() => {
      void setLyricPlaybackRate(nextRate)
      void updateMetaData(playerState.musicInfo, playerState.isPlay, playerState.lastLyric, true)
      updateSetting({ 'player.playbackRate': nextRate })
    }).catch(() => {
      toast('播放速率设置失败')
    })
  }

  const handlePlaybackRateReset = () => {
    if (playbackRate == 1) return
    playHaptic('selection')
    void setPlaybackRate(1).then(() => {
      void setLyricPlaybackRate(1)
      void updateMetaData(playerState.musicInfo, playerState.isPlay, playerState.lastLyric, true)
      updateSetting({ 'player.playbackRate': 1 })
    }).catch(() => {
      toast('播放速率设置失败')
    })
  }

  const applySystemVolume = (value: number) => {
    const nextValue = Math.max(0, Math.min(100, Math.round(value)))
    setSliderValue(nextValue)
    setSystemVolumeSliding(false)
    playHaptic('selection')
    void setSystemVolume(nextValue / 100).then(result => {
      const actualValue = Math.max(0, Math.min(1, result))
      setSystemVolumeState(actualValue)
      setSliderValue(Math.round(actualValue * 100))
    }).catch(() => {
      toast('系统音量调整失败')
    })
  }

  const handleSystemVolumeStart: SliderProps['onSlidingStart'] = () => {
    setSystemVolumeSliding(true)
  }

  const handleSystemVolumeChange: SliderProps['onValueChange'] = value => {
    setSliderValue(Math.round(value))
  }

  const handleSystemVolumeComplete: SliderProps['onSlidingComplete'] = value => {
    playHaptic('dragCommit')
    applySystemVolume(value)
  }

  const stepSystemVolume = (delta: number) => {
    applySystemVolume((isSystemVolumeSliding ? sliderValue : Math.round(systemVolume * 100)) + delta)
  }

  return (
    <>
      <TouchableOpacity
        style={{
          ...styles.btn,
          width: btnStyle.width,
          marginLeft: btnStyle.marginLeft,
          marginBottom: btnStyle.marginBottom,
          borderColor: theme['c-border-background'],
        }}
        activeOpacity={0.7}
        onPress={handleOpen}
      >
        <Text
          numberOfLines={1}
          size={direction == 'vertical' ? 11 : 12}
          color={loading ? theme['c-500'] : theme['c-font-label']}
        >
          {label}
        </Text>
      </TouchableOpacity>
      {visible ? (
        <Popup ref={popupRef} title="调号 / 节拍">
          <ScrollView style={styles.popup}>
            <View onStartShouldSetResponder={() => true}>
              <View style={{ ...styles.row, borderBottomColor: theme['c-border-background'] }}>
                <Text style={styles.rowIndex}>1.</Text>
                <Text style={styles.rowLabel}>调号</Text>
                <Text color={theme['c-font']}>{displayKeyText}</Text>
              </View>
              <View style={{ ...styles.row, borderBottomColor: theme['c-border-background'] }}>
                <Text style={styles.rowIndex}>2.</Text>
                <Text style={styles.rowLabel}>拍速</Text>
                <Text color={theme['c-font']}>{bpmText}</Text>
              </View>
              <View style={{ ...styles.row, borderBottomColor: theme['c-border-background'] }}>
                <Text style={styles.rowIndex}>3.</Text>
                <Text style={styles.rowLabel}>最高音</Text>
                <Text color={theme['c-font']}>{highestNoteText}</Text>
              </View>
              <View style={{ ...styles.row, borderBottomColor: theme['c-border-background'] }}>
                <Text style={styles.rowIndex}>4.</Text>
                <Text style={styles.rowLabel}>分析</Text>
                <ButtonPrimary disabled={loading} onPress={() => { handleAnalyzePress('quick') }}>{loading && analyzeScope == 'quick' ? '快速分析中' : '快速分析'}</ButtonPrimary>
              </View>
              <View style={{ ...styles.row, borderBottomColor: theme['c-border-background'] }}>
                <Text style={styles.rowIndex}>5.</Text>
                <Text style={styles.rowLabel}>全曲</Text>
                <View style={styles.actionGroup}>
                  <TouchableOpacity
                    activeOpacity={0.8}
                    style={{
                      ...styles.actionBtn,
                      backgroundColor: hasFullAnalysis ? '#bbc5cf' : theme['c-button-background'],
                    }}
                    onPress={() => { handleAnalyzePress('full') }}
                  >
                    <Text color={hasFullAnalysis ? '#243444' : theme['c-button-font']} size={12}>
                      {loading && analyzeScope == 'full' ? '全曲分析中' : hasFullAnalysis ? '重跑全曲分析' : '全曲分析'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    activeOpacity={0.8}
                    style={{
                      ...styles.actionBtn,
                      backgroundColor: hasFullAnalysis ? '#e9cb8a' : '#d7dce3',
                    }}
                    onPress={handleOpenChord}
                  >
                    <Text color={hasFullAnalysis ? '#56390d' : '#6b7381'} size={12}>和弦展示</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <View style={{ ...styles.row, borderBottomColor: theme['c-border-background'] }}>
                <Text style={styles.rowIndex}>6.</Text>
                <Text style={styles.rowLabel}>详情</Text>
                <ButtonPrimary disabled={!profile} onPress={handleOpenDetail}>查看二级分析</ButtonPrimary>
              </View>
              {loading ? (
                <View style={{ ...styles.progressWrap, borderBottomColor: theme['c-border-background'] }}>
                  <View style={styles.progressBarBg}>
                    <View style={{ ...styles.progressBarActive, width: `${Math.max(4, Math.round(progress * 100))}%`, backgroundColor: theme['c-primary-font-active'] }} />
                  </View>
                  <Text size={12} color={theme['c-font-label']}>{`${Math.round(progress * 100)}% · ${progressText || deriveAnalyzePhaseText(analyzeScope, progress)}`}</Text>
                </View>
              ) : null}
              <View style={{ ...styles.row, borderBottomColor: theme['c-border-background'] }}>
                <Text style={styles.rowIndex}>7.</Text>
                <Text style={styles.rowLabel}>升降调</Text>
                <Text color={theme['c-font']}>{`${pitchSemitones > 0 ? '+' : ''}${pitchSemitones} st`}</Text>
              </View>
              <View style={styles.quickBtnRow}>
                <TouchableOpacity style={styles.quickBtn} onPress={() => { handlePitchStep(-1) }}>
                  <Text color="#f6f6f6" size={13}>-1</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.quickBtn} onPress={handlePitchReset}>
                  <Text color="#f6f6f6" size={13}>复位</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.quickBtn} onPress={() => { handlePitchStep(1) }}>
                  <Text color="#f6f6f6" size={13}>+1</Text>
                </TouchableOpacity>
              </View>
              <SettingPitch />
              <View style={{ ...styles.row, borderBottomColor: theme['c-border-background'] }}>
                <Text style={styles.rowIndex}>8.</Text>
                <Text style={styles.rowLabel}>播放速率</Text>
                <Text color={theme['c-font']}>{`${playbackRate.toFixed(2)}x`}</Text>
              </View>
              <View style={styles.quickBtnRow}>
                <TouchableOpacity style={styles.quickBtn} onPress={() => { handlePlaybackRateStep(-0.1) }}>
                  <Text color="#f6f6f6" size={13}>-0.1</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.quickBtn} onPress={handlePlaybackRateReset}>
                  <Text color="#f6f6f6" size={13}>复位</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.quickBtn} onPress={() => { handlePlaybackRateStep(0.1) }}>
                  <Text color="#f6f6f6" size={13}>+0.1</Text>
                </TouchableOpacity>
              </View>
              <SettingPlaybackRate />
              <View style={{ ...styles.row, borderBottomColor: theme['c-border-background'] }}>
                <Text style={styles.rowIndex}>9.</Text>
                <Text style={styles.rowLabel}>系统音量</Text>
                <Text color={theme['c-font']}>{`${isSystemVolumeSliding ? sliderValue : Math.round(systemVolume * 100)}%`}</Text>
              </View>
              <View style={styles.quickBtnRow}>
                <TouchableOpacity style={styles.quickBtn} onPress={() => { stepSystemVolume(-8) }}>
                  <Text color="#f6f6f6" size={13}>-8%</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.quickBtn} onPress={() => { applySystemVolume(50) }}>
                  <Text color="#f6f6f6" size={13}>50%</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.quickBtn} onPress={() => { stepSystemVolume(8) }}>
                  <Text color="#f6f6f6" size={13}>+8%</Text>
                </TouchableOpacity>
              </View>
              <Slider
                minimumValue={0}
                maximumValue={100}
                onSlidingStart={handleSystemVolumeStart}
                onValueChange={handleSystemVolumeChange}
                onSlidingComplete={handleSystemVolumeComplete}
                step={1}
                value={isSystemVolumeSliding ? sliderValue : Math.round(systemVolume * 100)}
              />
            </View>
          </ScrollView>
        </Popup>
      ) : null}
      {detailVisible ? (
        <Popup ref={detailPopupRef} title="全曲分析详情">
          <ScrollView style={styles.popup}>
            <View onStartShouldSetResponder={() => true}>
              <View style={styles.summaryCard}>
                <Text color="#243444" size={13}>{`调号：${displayKeyText}`}</Text>
                <Text color="#243444" size={13}>{`拍速：${bpmText}`}</Text>
                <Text color="#243444" size={13}>{`节拍：${profile?.timeSignature || '未分析'}`}</Text>
                <Text color="#243444" size={13}>{`平均音区：${averageNoteText}`}</Text>
                <Text color="#243444" size={13}>{`常见高音区：${commonHighText}`}</Text>
                <Text color="#243444" size={13}>{`常见低音区：${commonLowText}`}</Text>
              </View>
              <View style={styles.waveCard}>
                <View style={styles.waveChart}>
                  <View style={{ ...styles.rangeLine, top: getPitchTop(profile?.commonHighMidi) as never, borderColor: '#9a5c1a' }}>
                    <Text style={{ ...styles.rangeText, color: '#9a5c1a' }}>{`常见高音 ${commonHighText}`}</Text>
                  </View>
                  <View style={{ ...styles.rangeLine, top: getPitchTop(profile?.averageMidi) as never, borderColor: '#235a76' }}>
                    <Text style={{ ...styles.rangeText, color: '#235a76' }}>{`平均音区 ${averageNoteText}`}</Text>
                  </View>
                  <View style={{ ...styles.rangeLine, top: getPitchTop(profile?.commonLowMidi) as never, borderColor: '#35663d' }}>
                    <Text style={{ ...styles.rangeText, color: '#35663d' }}>{`常见低音 ${commonLowText}`}</Text>
                  </View>
                  <View style={styles.waveBars}>
                    {waveformSamples.map((sample, index) => (
                      <View
                        key={`wave_${index}`}
                        style={{
                          ...styles.waveBar,
                          height: `${Math.max(8, sample * 100)}%`,
                          backgroundColor: index % 2 ? '#85a8cb' : '#678fb7',
                        }}
                      />
                    ))}
                  </View>
                  {waveMarkers.map(marker => (
                    <TouchableOpacity
                      key={marker.id}
                      activeOpacity={0.85}
                      style={{
                        ...styles.markerWrap,
                        left: getMarkerLeft(marker.timeMs) as never,
                        top: getPitchTop(marker.midi) as never,
                        marginLeft: getMarkerOffset(marker.timeMs, profile?.analyzedDurationMs || 1),
                        marginTop: getMarkerVerticalOffset(marker.midi, pitchMin, pitchMax),
                      }}
                      onPress={() => { jumpToTime(marker.timeMs) }}
                    >
                      <View style={{ ...styles.markerDot, backgroundColor: marker.id == 'highest' ? '#b84e21' : '#1b7559' }} />
                      <View style={styles.markerCallout}>
                        <Text color="#1e2b38" size={12}>{`${marker.title} ${marker.noteText}`}</Text>
                        <Text color="#576575" size={11} numberOfLines={2}>{marker.anchorText}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.tipText} color={theme['c-font-label']}>点击最高音或最低音标记，可直接跳转到该句歌词位置。</Text>
              </View>
              <View style={{ ...styles.summaryCard, backgroundColor: '#fff4e6', borderColor: '#e3c79a' }}>
                <Text color="#6b4912" size={13}>{`最高音：${highestNoteText}`}</Text>
                <Text color="#6b4912" size={13}>{`最低音：${lowestNoteText}`}</Text>
                <Text color="#6b4912" size={13}>{`主音体系：${tonicText}`}</Text>
                <Text color="#6b4912" size={13}>{`分析范围：${hasFullAnalysis ? '全曲分析结果' : '快速分析结果'}`}</Text>
              </View>
            </View>
          </ScrollView>
        </Popup>
      ) : null}
      {chordVisible ? (
        <Popup ref={chordPopupRef} title="歌词对齐和弦稿">
          <ScrollView style={styles.popup}>
            <View onStartShouldSetResponder={() => true}>
              <View style={{ ...styles.summaryCard, backgroundColor: '#f7f0e1', borderColor: '#d9c499' }}>
                <Text color="#5b4218" size={13}>{`${displayKeyText} / ${bpmText} / ${profile?.timeSignature || '未分析'}`}</Text>
                <Text color="#5b4218" size={12}>{`当前模式：${activeSheetTitle}  Capo：${capoSemitone}`}</Text>
                <View style={styles.sheetControlRow}>
                  <TouchableOpacity style={{ ...styles.sheetModeBtn, backgroundColor: sheetMode == 'chord' ? '#8f6230' : '#f4e3c4' }} onPress={() => { setSheetMode('chord') }}>
                    <Text color={sheetMode == 'chord' ? '#f7f7f7' : '#5b4218'} size={12}>和弦</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={{ ...styles.sheetModeBtn, backgroundColor: sheetMode == 'degree' ? '#8f6230' : '#f4e3c4' }} onPress={() => { setSheetMode('degree') }}>
                    <Text color={sheetMode == 'degree' ? '#f7f7f7' : '#5b4218'} size={12}>级数</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={{ ...styles.sheetModeBtn, backgroundColor: sheetMode == 'jianpu' ? '#8f6230' : '#f4e3c4' }} onPress={() => { setSheetMode('jianpu') }}>
                    <Text color={sheetMode == 'jianpu' ? '#f7f7f7' : '#5b4218'} size={12}>简谱</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.sheetControlRow}>
                  <TouchableOpacity style={styles.capoBtn} onPress={() => { setCapoSemitone(value => Math.max(0, value - 1)) }}>
                    <Text color="#5b4218" size={12}>Capo -1</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.capoBtn} onPress={() => { setCapoSemitone(0) }}>
                    <Text color="#5b4218" size={12}>Capo 归零</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.capoBtn} onPress={() => { setCapoSemitone(value => Math.min(7, value + 1)) }}>
                    <Text color="#5b4218" size={12}>Capo +1</Text>
                  </TouchableOpacity>
                </View>
              </View>
              {sheetBlocks.length ? (
                <View style={styles.sheetList}>
                  {sheetMode == 'jianpu' ? (
                    <View style={styles.jianpuList}>
                      {sheetBlocks.map(block => (
                        <TouchableOpacity key={block.id} activeOpacity={0.85} style={styles.jianpuCard} onPress={() => { jumpToTime(block.startMs) }}>
                          <Text style={styles.jianpuLine} color="#1f2f3d">{buildJianpuMeasureText(block)}</Text>
                          <Text style={styles.jianpuLyricLine} color="#5a6470">{buildJianpuLyricText(block)}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : (
                    <>
                      <View style={styles.sheetHeaderRow}>
                        <Text style={styles.sheetBarHeader} color="#6b5328">节</Text>
                        <View style={styles.sheetBeatGrid}>
                          {Array.from({ length: getMeterBeatCount(profile?.timeSignature) }, (_, index) => (
                            <View key={`header_${index}`} style={styles.sheetHeaderCell}>
                              <Text style={styles.sheetHeaderText} color="#6b5328">{index + 1}</Text>
                            </View>
                          ))}
                        </View>
                      </View>
                      {sheetBlocks.map(block => (
                        <TouchableOpacity key={block.id} activeOpacity={0.85} style={styles.sheetCard} onPress={() => { jumpToTime(block.startMs) }}>
                          <View style={styles.sheetGridRow}>
                            <Text style={styles.sheetBarLabel} color="#6b5328">{block.label.split('|')[0]}</Text>
                            <View style={styles.sheetBeatGrid}>
                              {block.beats.map((beat, index) => (
                                <View key={`${block.id}_${index}`} style={styles.sheetBeatCell}>
                                  <Text style={styles.sheetBeatText} color="#182838">
                                    {sheetMode == 'chord' ? beat.chordText : beat.degreeText}
                                  </Text>
                                  {beat.lyricText ? <Text style={styles.sheetCellLyric} color="#5d6670" numberOfLines={2}>{beat.lyricText}</Text> : null}
                                </View>
                              ))}
                            </View>
                          </View>
                        </TouchableOpacity>
                      ))}
                    </>
                  )}
                </View>
              ) : (
                <Text color={theme['c-font-label']}>当前没有可展示的歌词对齐和弦。</Text>
              )}
            </View>
          </ScrollView>
        </Popup>
      ) : null}
    </>
  )
})

const styles = createStyle({
  btn: {
    minHeight: scaleSizeW(28),
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: BorderWidths.normal,
    borderRadius: 14,
    paddingHorizontal: 6,
    shadowOpacity: 1,
    textShadowRadius: 1,
  },
  popup: {
    flexShrink: 1,
    flexGrow: 0,
    paddingLeft: 15,
    paddingRight: 15,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 10,
    borderBottomWidth: BorderWidths.normal,
  },
  rowIndex: {
    width: 22,
  },
  rowLabel: {
    flex: 1,
  },
  progressWrap: {
    paddingTop: 10,
    paddingBottom: 10,
    borderBottomWidth: BorderWidths.normal,
    gap: 8,
  },
  progressBarBg: {
    height: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  progressBarActive: {
    height: '100%',
    borderRadius: 999,
  },
  quickBtnRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    marginBottom: 8,
  },
  quickBtn: {
    flex: 1,
    minHeight: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#274863',
    borderWidth: 1,
    borderColor: '#183044',
  },
  actionGroup: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    minHeight: 34,
    borderRadius: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryCard: {
    marginTop: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#d4dce6',
    backgroundColor: '#f3f6fa',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  waveCard: {
    marginTop: 14,
    marginBottom: 12,
  },
  waveChart: {
    height: 220,
    borderRadius: 18,
    backgroundColor: '#edf4fb',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#cad8e7',
    justifyContent: 'flex-end',
  },
  waveBars: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 18,
    bottom: 18,
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 10,
    gap: 2,
  },
  waveBar: {
    flex: 1,
    borderRadius: 999,
    alignSelf: 'flex-end',
  },
  rangeLine: {
    position: 'absolute',
    left: 10,
    right: 10,
    borderTopWidth: 1,
    borderStyle: 'dashed',
  },
  rangeText: {
    position: 'absolute',
    top: -18,
    right: 0,
    fontSize: 11,
  },
  markerWrap: {
    position: 'absolute',
    marginTop: -12,
    width: 112,
  },
  markerDot: {
    width: 12,
    height: 12,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: '#fbfdff',
    marginBottom: 4,
  },
  markerCallout: {
    width: 106,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderWidth: 1,
    borderColor: '#d4dce5',
  },
  tipText: {
    marginTop: 8,
  },
  sheetControlRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  sheetModeBtn: {
    flex: 1,
    minHeight: 34,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  capoBtn: {
    flex: 1,
    minHeight: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f4e3c4',
  },
  sheetList: {
    gap: 10,
    paddingTop: 14,
    paddingBottom: 18,
  },
  sheetHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sheetBarHeader: {
    width: 42,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '700',
  },
  sheetCard: {
    borderRadius: 12,
    backgroundColor: '#f8f1e3',
    borderWidth: 1,
    borderColor: '#decda8',
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  jianpuList: {
    gap: 10,
    paddingTop: 14,
    paddingBottom: 18,
  },
  jianpuCard: {
    borderRadius: 12,
    backgroundColor: '#fffaf0',
    borderWidth: 1,
    borderColor: '#d8c59c',
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  jianpuLine: {
    fontFamily: 'monospace',
    fontSize: 14,
    lineHeight: 22,
    fontWeight: '700',
  },
  jianpuLyricLine: {
    marginTop: 4,
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
  },
  sheetGridRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
  },
  sheetBarLabel: {
    width: 42,
    fontFamily: 'monospace',
    fontSize: 14,
    lineHeight: 52,
    fontWeight: '700',
    textAlign: 'center',
  },
  sheetBeatGrid: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
  },
  sheetHeaderCell: {
    flex: 1,
    minHeight: 24,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d4c095',
    backgroundColor: '#f3e7c8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetHeaderText: {
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: '700',
  },
  sheetBeatCell: {
    flex: 1,
    minHeight: 52,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d4c095',
    backgroundColor: '#fff8ec',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  sheetBeatText: {
    fontFamily: 'monospace',
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
  },
  sheetCellLyric: {
    marginTop: 3,
    fontSize: 10,
    lineHeight: 12,
    textAlign: 'center',
  },
})
