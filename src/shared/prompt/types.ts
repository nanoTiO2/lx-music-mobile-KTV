export type PromptAdvanceMode = 'sequential_tap' | 'jk_relay'

export type PromptDisplayMode = 'single' | 'double' | 'triple' | 'marquee'

export type PromptMirrorMode = 'none' | 'horizontal' | 'vertical' | 'both'

export type PromptAlignment = 'left' | 'center' | 'right'

export type PromptTransportType = 'wifi_websocket' | 'public_webrtc' | 'bluetooth'

export type PromptOwnerKey = 'J' | 'K'

export interface PromptCue {
  id: string
  text: string
  startMs?: number | null
  endMs?: number | null
  sourceLine?: number | null
}

export interface CueDocument {
  id: string
  title: string
  sourceType: 'lrc' | 'srt' | 'ass' | 'txt' | 'paste' | 'demo'
  cues: PromptCue[]
  rawText: string
  createdAt: string
}

export interface PromptStyle {
  mode: PromptDisplayMode
  mirror: PromptMirrorMode
  fontScale: number
  fontColor: string
  align: PromptAlignment
}

export interface PromptLatencyMetrics {
  pingMs: number
  packetLossRate: number
  signalQuality: 'excellent' | 'good' | 'fair' | 'poor' | 'offline'
}

export interface DisplayDevice {
  id: string
  name: string
  transport: PromptTransportType
  isPrimary: boolean
  isConnected: boolean
  metrics: PromptLatencyMetrics
}

export interface PromptSnapshot {
  revision: number
  mode: PromptAdvanceMode
  activeCueIndex: number | null
  nextCueIndex: number
  ownerKey: PromptOwnerKey | null
  pressedKeys: Record<PromptOwnerKey, boolean>
  displayState: 'idle' | 'showing' | 'cleared'
  style: PromptStyle
}

export interface PromptState extends PromptSnapshot {
  document: CueDocument
  undoStack: PromptUndoEntry[]
}

export interface PromptUndoEntry {
  activeCueIndex: number | null
  nextCueIndex: number
  ownerKey: PromptOwnerKey | null
  pressedKeys: Record<PromptOwnerKey, boolean>
  displayState: 'idle' | 'showing' | 'cleared'
}

export type PromptCommand =
  | { type: 'SHOW_CURRENT' }
  | { type: 'ADVANCE' }
  | { type: 'CLEAR_SCREEN' }
  | { type: 'UNDO' }
  | { type: 'SET_MODE', mode: PromptAdvanceMode }
  | { type: 'SET_STYLE', style: Partial<PromptStyle> }
  | { type: 'KEY_DOWN', key: PromptOwnerKey }
  | { type: 'KEY_UP', key: PromptOwnerKey }
  | { type: 'LOAD_DOCUMENT', document: CueDocument }

export const DEFAULT_PROMPT_STYLE: PromptStyle = {
  mode: 'double',
  mirror: 'none',
  fontScale: 1,
  fontColor: '#f6f7fb',
  align: 'center',
}

export const DEFAULT_PRESSED_KEYS: Record<PromptOwnerKey, boolean> = {
  J: false,
  K: false,
}

