import { Platform, Vibration } from 'react-native'
import { playHaptic as nativePlayHaptic } from '@/utils/nativeModules/utils'

export type HapticKind = 'selection' | 'play' | 'pause' | 'next' | 'success' | 'drag'

const FALLBACK_PATTERN: Record<HapticKind, number | number[]> = {
  selection: 12,
  play: [0, 16, 18, 8],
  pause: [0, 18, 24, 18],
  next: [0, 12, 16, 18],
  success: [0, 16, 18, 20],
  drag: 8,
}

export const playHaptic = (kind: HapticKind = 'selection') => {
  if (Platform.OS != 'android') return
  void nativePlayHaptic(kind).catch(() => {
    try {
      Vibration.vibrate(FALLBACK_PATTERN[kind])
    } catch {}
  })
}
