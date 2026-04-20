import type { PortableMusicProfile } from '@/shared/musicProfileTag'

export interface DesktopAudioAdapter {
  load(filePath: string): Promise<void>
  play(): Promise<void>
  pause(): Promise<void>
  stop(): Promise<void>
  seekTo(positionMs: number): Promise<void>
  setRate(rate: number): Promise<void>
  setPitch(semitones: number): Promise<void>
  getPosition(): Promise<number>
  getDuration(): Promise<number>
  analyzeMusicProfile(filePath: string, maxAnalyzeMs: number): Promise<PortableMusicProfile>
}

export interface DesktopWindowAdapter {
  enterFullscreen(): Promise<void>
  exitFullscreen(): Promise<void>
  setAlwaysOnTop(enabled: boolean): Promise<void>
  setBackgroundColor(color: string): Promise<void>
}

export interface DesktopFileAdapter {
  readText(path: string): Promise<string>
  writeText(path: string, data: string): Promise<void>
  exists(path: string): Promise<boolean>
  pickAudioFiles(): Promise<string[]>
  pickLyricFile(): Promise<string | null>
}

export interface DesktopPortContext {
  audio: DesktopAudioAdapter
  window: DesktopWindowAdapter
  files: DesktopFileAdapter
}
