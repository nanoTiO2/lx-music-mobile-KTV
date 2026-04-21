import { Platform, Vibration } from 'react-native'
import { playHaptic as nativePlayHaptic } from '@/utils/nativeModules/utils'

export type HapticKind =
  | 'selection'
  | 'song'
  | 'play'
  | 'pause'
  | 'prev'
  | 'next'
  | 'success'
  | 'drag'
  | 'dragCommit'
  | 'modeListLoop'
  | 'modeRandom'
  | 'modeOrder'
  | 'modeSingleLoop'
  | 'modeSingle'

const FALLBACK_PATTERN: Record<HapticKind, number | number[]> = {
  selection: 12,
  song: [0, 10, 12, 16],
  play: [0, 16, 18, 8],
  pause: [0, 18, 28, 22],
  prev: [0, 18, 20, 10],
  next: [0, 10, 14, 18],
  success: [0, 16, 18, 20],
  drag: 8,
  dragCommit: [0, 10, 12, 10],
  modeListLoop: [0, 10, 16, 10],
  modeRandom: [0, 10, 10, 10, 10, 14],
  modeOrder: [0, 16],
  modeSingleLoop: [0, 10, 14, 18],
  modeSingle: [0, 24],
}

export const playHaptic = (kind: HapticKind = 'selection') => {
  if (Platform.OS != 'android') return
  void nativePlayHaptic(kind).catch(() => {
    try {
      Vibration.vibrate(FALLBACK_PATTERN[kind])
    } catch {}
  })
}
