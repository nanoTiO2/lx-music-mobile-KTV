import { NativeModules } from 'react-native'

const { MixerModule } = NativeModules as {
  MixerModule?: {
    startTransition: (
      fromPath: string,
      toPath: string,
      positionMs: number,
      playWhenReady: boolean,
      switchAtMs: number,
      fadeDurationMs: number,
      volume: number,
      fromGain: number,
      toGain: number
    ) => Promise<boolean>
    play: () => Promise<boolean>
    pause: () => Promise<boolean>
    stop: () => Promise<boolean>
    release: () => Promise<boolean>
    seekTo: (positionMs: number) => Promise<boolean>
    getPosition: () => Promise<number>
    getDuration: () => Promise<number>
    setOutputVolume: (volume: number) => Promise<boolean>
    setTrackGains: (activeGain: number, standbyGain: number) => Promise<boolean>
    setPlaybackRate: (rate: number) => Promise<boolean>
    setPitch: (pitch: number) => Promise<boolean>
    isActive: () => Promise<boolean>
    analyzeBeatGrid: (filePath: string, maxAnalyzeMs: number) => Promise<{
      bpm: number
      beatIntervalMs: number
      firstBeatOffsetMs: number
      confidence: number
      analyzedDurationMs: number
    }>
    analyzeMusicProfile: (filePath: string, maxAnalyzeMs: number) => Promise<{
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
    }>
  }
}

const state = {
  active: false,
  musicId: '',
}

const ensureModule = () => {
  if (!MixerModule) throw new Error('MixerModule unavailable')
  return MixerModule
}

export const isMixerAvailable = () => !!MixerModule

export const isMixerActive = () => state.active

export const isMixerActiveForMusic = (musicId?: string | null) => {
  return state.active && !!musicId && state.musicId == musicId
}

export const startMixerTransition = async({
  musicId,
  fromPath,
  toPath,
  positionMs,
  playWhenReady,
  switchAtMs,
  fadeDurationMs,
  volume,
  fromGain,
  toGain,
}: {
  musicId: string
  fromPath: string
  toPath: string
  positionMs: number
  playWhenReady: boolean
  switchAtMs: number
  fadeDurationMs: number
  volume: number
  fromGain: number
  toGain: number
}) => {
  await ensureModule().startTransition(fromPath, toPath, positionMs, playWhenReady, switchAtMs, fadeDurationMs, volume, fromGain, toGain)
  state.active = true
  state.musicId = musicId
}

export const playMixer = async() => {
  await ensureModule().play()
}

export const pauseMixer = async() => {
  await ensureModule().pause()
}

export const stopMixer = async() => {
  await ensureModule().stop()
  state.active = false
  state.musicId = ''
}

export const releaseMixer = async() => {
  if (!MixerModule) return
  await MixerModule.release()
  state.active = false
  state.musicId = ''
}

export const seekMixer = async(positionMs: number) => {
  await ensureModule().seekTo(positionMs)
}

export const getMixerPosition = async() => {
  return ensureModule().getPosition()
}

export const getMixerDuration = async() => {
  return ensureModule().getDuration()
}

export const setMixerOutputVolume = async(volume: number) => {
  await ensureModule().setOutputVolume(volume)
}

export const setMixerTrackGains = async(activeGain: number, standbyGain: number = activeGain) => {
  await ensureModule().setTrackGains(activeGain, standbyGain)
}

export const setMixerPlaybackRate = async(rate: number) => {
  await ensureModule().setPlaybackRate(rate)
}

export const setMixerPitch = async(pitch: number) => {
  await ensureModule().setPitch(pitch)
}

export const analyzeMixerBeatGrid = async(filePath: string, maxAnalyzeMs: number = 90_000) => {
  return ensureModule().analyzeBeatGrid(filePath, maxAnalyzeMs)
}

export const analyzeMixerMusicProfile = async(filePath: string, maxAnalyzeMs: number = 90_000) => {
  return ensureModule().analyzeMusicProfile(filePath, maxAnalyzeMs)
}
