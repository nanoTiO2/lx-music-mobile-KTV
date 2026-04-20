import TrackPlayer, { Capability, Event, RepeatMode, State } from 'react-native-track-player'
import BackgroundTimer from 'react-native-background-timer'
import { playMusic as handlePlayMusic } from './playList'
import { existsFile, moveFile, privateStorageDirectoryPath, temporaryDirectoryPath } from '@/utils/fs'
import settingState from '@/store/setting/state'
import playerState from '@/store/player/state'
import {
  getMixerDuration,
  getMixerPosition,
  isMixerActive,
  isMixerAvailable,
  pauseMixer,
  playMixer,
  releaseMixer,
  seekMixer,
  setMixerOutputVolume,
  setMixerPlaybackRate,
  setMixerPitch,
  setMixerTrackGains,
  startMixerTransition,
  stopMixer,
} from '@/utils/nativeModules/mixer'
import { toast } from '@/utils/tools'
// import { PlayerMusicInfo } from '@/store/modules/player/playInfo'


export { useBufferProgress } from './hook'

const emptyIdRxp = /\/\/default$/
const tempIdRxp = /\/\/default$|\/\/default\/\/restorePlay$/
export const isEmpty = (trackId = global.lx.playerTrackId) => {
  // console.log(trackId)
  return !trackId || emptyIdRxp.test(trackId)
}
export const isTempId = (trackId = global.lx.playerTrackId) => !trackId || tempIdRxp.test(trackId)

let ignoreTrackPlayerStateUntil = 0
export const suppressTrackPlayerStateEvents = (durationMs: number = 800) => {
  ignoreTrackPlayerStateUntil = Date.now() + durationMs
}

export const shouldIgnoreTrackPlayerStateEvents = () => {
  return isMixerActive() || Date.now() < ignoreTrackPlayerStateUntil
}

// export const replacePlayTrack = async(newTrack, oldTrack) => {
//   console.log('replaceTrack')
//   await TrackPlayer.add(newTrack)
//   await TrackPlayer.skip(newTrack.id)
//   await TrackPlayer.remove(oldTrack.id)
// }

// let timeout
// let isFirstPlay = true
// const updateInfo = async track => {
//   if (isFirstPlay) {
//     // timeout = setTimeout(() => {
//     await delayUpdateMusicInfo(track)
//     isFirstPlay = false
//     // }, 500)
//   }
// }


// 解决快速切歌导致的通知栏歌曲信息与当前播放歌曲对不上的问题
// const debouncePlayMusicTools = {
//   prevPlayMusicPromise: Promise.resolve(),
//   trackInfo: {},
//   isDelayUpdate: false,
//   isDebounced: false,
//   delay: 1000,
//   delayTimer: null,
//   debounce(fn, delay = 100) {
//     let timer = null
//     let _tracks = null
//     let _time = null
//     return (tracks, time) => {
//       if (!this.isDebounced && _tracks != null) this.isDebounced = true
//       _tracks = tracks
//       _time = time
//       if (timer) {
//         BackgroundTimer.clearTimeout(timer)
//         timer = null
//       }
//       if (this.isDelayUpdate) {
//         if (this.updateDelayTimer) {
//           BackgroundTimer.clearTimeout(this.updateDelayTimer)
//           this.updateDelayTimer = null
//         }
//         timer = BackgroundTimer.setTimeout(() => {
//           timer = null
//           let tracks = _tracks
//           let time = _time
//           _tracks = null
//           _time = null
//           this.isDelayUpdate = false
//           fn(tracks, time)
//         }, delay)
//       } else {
//         this.isDelayUpdate = true
//         fn(tracks, time)
//         this.updateDelayTimer = BackgroundTimer.setTimeout(() => {
//           this.updateDelayTimer = null
//           this.isDelayUpdate = false
//         }, this.delay)
//       }
//     }
//   },
//   delayUpdateMusicInfo() {
//     if (this.delayTimer) BackgroundTimer.clearTimeout(this.delayTimer)
//     this.delayTimer = BackgroundTimer.setTimeout(() => {
//       this.delayTimer = null
//       if (this.trackInfo.tracks && this.trackInfo.tracks.length) delayUpdateMusicInfo(this.trackInfo.tracks[0])
//     }, this.delay)
//   },
//   init() {
//     return this.debounce((tracks, time) => {
//       tracks = [...tracks]
//       this.trackInfo.tracks = tracks
//       this.trackInfo.time = time
//       return this.prevPlayMusicPromise.then(() => {
//         // console.log('run')
//         if (this.trackInfo.tracks === tracks) {
//           this.prevPlayMusicPromise = handlePlayMusic(tracks, time).then(() => {
//             if (this.isDebounced) {
//               this.delayUpdateMusicInfo()
//               this.isDebounced = false
//             }
//           })
//         }
//       })
//     }, 200)
//   },
// }

const playMusic = ((fn: (musicInfo: LX.Player.PlayMusic, url: string, time: number) => void, delay = 800) => {
  let delayTimer: number | null = null
  let isDelayRun = false
  let timer: number | null = null
  let _musicInfo: LX.Player.PlayMusic | null = null
  let _url = ''
  let _time = 0
  return (musicInfo: LX.Player.PlayMusic, url: string, time: number) => {
    _musicInfo = musicInfo
    _url = url
    _time = time
    if (timer) {
      BackgroundTimer.clearTimeout(timer)
      timer = null
    }
    if (isDelayRun) {
      if (delayTimer) {
        BackgroundTimer.clearTimeout(delayTimer)
        delayTimer = null
      }
      timer = BackgroundTimer.setTimeout(() => {
        timer = null
        let musicInfo = _musicInfo
        let url = _url
        let time = _time
        _musicInfo = null
        _url = ''
        _time = 0
        isDelayRun = false
        fn(musicInfo!, url, time)
      }, delay)
    } else {
      isDelayRun = true
      fn(musicInfo, url, time)
      delayTimer = BackgroundTimer.setTimeout(() => {
        delayTimer = null
        isDelayRun = false
      }, 500)
    }
  }
})((musicInfo, url, time) => {
  handlePlayMusic(musicInfo, url, time)
})

export const setResource = (musicInfo: LX.Player.PlayMusic, url: string, duration?: number) => {
  if (isMixerActive()) void releaseMixer()
  playMusic(musicInfo, url, duration ?? 0)
  void applyTrackOutputVolume(settingState.setting['player.volume'], musicInfo)
}

export const startResourceTransition = async({
  musicInfo,
  fromUrl,
  toUrl,
  position,
  switchAt,
  fadeDurationMs = 120,
  playWhenReady,
  fromGain = 1,
  toGain = 1,
}: {
  musicInfo: LX.Player.PlayMusic
  fromUrl: string
  toUrl: string
  position: number
  switchAt: number
  fadeDurationMs?: number
  playWhenReady: boolean
  fromGain?: number
  toGain?: number
}) => {
  if (!isMixerAvailable()) return false

  await releaseMixer()
  await startMixerTransition({
    musicId: musicInfo.id,
    fromPath: fromUrl,
    toPath: toUrl,
    positionMs: position * 1000,
    playWhenReady,
    switchAtMs: switchAt * 1000,
    fadeDurationMs,
    volume: settingState.setting['player.volume'],
    fromGain,
    toGain,
  })
  await setMixerPlaybackRate(settingState.setting['player.playbackRate'])
  await setMixerPitch(semitonesToPitch(settingState.setting['player.pitchSemitones']))
  suppressTrackPlayerStateEvents(Math.max(800, fadeDurationMs + 400))
  await TrackPlayer.pause()
  return true
}

export const setPlay = async() => {
  if (isMixerActive()) {
    await playMixer()
    global.app_event.playerPlaying()
    global.app_event.play()
    return
  }
  return TrackPlayer.play()
}
export const getPosition = async() => {
  if (isMixerActive()) return getMixerPosition().then(position => position / 1000)
  return TrackPlayer.getPosition()
}
export const getDuration = async() => {
  if (isMixerActive()) return getMixerDuration().then(duration => duration / 1000)
  return TrackPlayer.getDuration()
}
export const setStop = async() => {
  if (isMixerActive()) await stopMixer()
  await TrackPlayer.stop()
  if (!isEmpty()) await TrackPlayer.skipToNext()
}
export const setLoop = async(loop: boolean) => TrackPlayer.setRepeatMode(loop ? RepeatMode.Off : RepeatMode.Track)

export const setPause = async() => {
  if (isMixerActive()) {
    await pauseMixer()
    global.app_event.playerPause()
    global.app_event.pause()
    return
  }
  return TrackPlayer.pause()
}
// export const skipToNext = () => TrackPlayer.skipToNext()
export const setCurrentTime = async(time: number) => {
  if (isMixerActive()) return seekMixer(time * 1000)
  return TrackPlayer.seekTo(time)
}
export const setVolume = async(num: number) => {
  return applyTrackOutputVolume(num)
}
export const setPlaybackRate = async(num: number) => {
  if (!isMixerActive() && num != 1) await ensureMixerForLocalPlayback().catch(() => false)
  if (isMixerActive()) {
    await setMixerPlaybackRate(num)
    return
  }
  return TrackPlayer.setRate(num)
}

const semitonesToPitch = (num: number) => {
  return Math.max(0.5, Math.min(2, Math.pow(2, num / 12)))
}

const getCurrentLocalPlaybackPath = () => {
  const musicInfo = playerState.playMusicInfo.musicInfo
  if (!musicInfo || 'progress' in musicInfo || musicInfo.source != 'local') return ''
  return musicInfo.meta.filePath?.trim() || musicInfo.meta.originFilePath?.trim() || ''
}

const ensureMixerForLocalPlayback = async() => {
  if (isMixerActive()) return true
  if (!isMixerAvailable()) return false
  const musicInfo = playerState.playMusicInfo.musicInfo
  const filePath = getCurrentLocalPlaybackPath()
  if (!musicInfo || 'progress' in musicInfo || musicInfo.source != 'local' || !filePath) return false

  const position = await TrackPlayer.getPosition().catch(() => playerState.progress.nowPlayTime)
  const positionMs = Math.max(0, position * 1000)
  await releaseMixer()
  await startMixerTransition({
    musicId: musicInfo.id,
    fromPath: filePath,
    toPath: filePath,
    positionMs,
    playWhenReady: playerState.isPlay,
    switchAtMs: positionMs,
    fadeDurationMs: 60,
    volume: settingState.setting['player.volume'],
    fromGain: 1,
    toGain: 1,
  })
  await setMixerPlaybackRate(settingState.setting['player.playbackRate'])
  await setMixerPitch(semitonesToPitch(settingState.setting['player.pitchSemitones']))
  suppressTrackPlayerStateEvents(1200)
  await TrackPlayer.pause().catch(() => {})
  return true
}

const sanitizeOutputVolume = (num: number) => {
  if (num < 0) return 0
  if (num > 1) return 1
  return num
}

const getMusicKtvVariantGain = (musicInfo?: LX.Player.PlayMusic | null, ktvGain: number = settingState.setting['player.ktvVariantGain']) => {
  if (!musicInfo || 'progress' in musicInfo || musicInfo.source != 'local') return 1
  const currentVariant = musicInfo.meta.ktvInfo?.currentVariant
  return currentVariant && currentVariant != 'main'
    ? ktvGain
    : 1
}

const applyTrackOutputVolume = async(
  num: number,
  musicInfo: LX.Player.PlayMusic | null = playerState.playMusicInfo.musicInfo,
  ktvGainOverride?: number,
) => {
  const sanitized = sanitizeOutputVolume(num)
  if (isMixerActive()) {
    await setMixerOutputVolume(sanitized)
    return TrackPlayer.setVolume(sanitized)
  }
  return TrackPlayer.setVolume(sanitizeOutputVolume(sanitized * getMusicKtvVariantGain(musicInfo, ktvGainOverride)))
}

export const setKtvVariantGain = async(gain: number) => {
  const nextGain = Math.max(0.6, Math.min(1.8, gain))
  const currentMusicInfo = playerState.playMusicInfo.musicInfo
  if (isMixerActive()) {
    const activeGain = getMusicKtvVariantGain(currentMusicInfo, nextGain)
    await setMixerTrackGains(activeGain == 1 ? 1 : nextGain, activeGain == 1 ? 1 : nextGain)
    await setMixerOutputVolume(settingState.setting['player.volume'])
  }
  return applyTrackOutputVolume(settingState.setting['player.volume'], currentMusicInfo, nextGain)
}

export const setPitch = async(num: number) => {
  const pitch = semitonesToPitch(num)
  if (!isMixerActive() && num != 0) await ensureMixerForLocalPlayback().catch(() => false)
  if (isMixerActive()) {
    await setMixerPitch(pitch)
    return
  }
  return TrackPlayer.setPitch(pitch)
}
export const updateNowPlayingTitles = async(duration: number, title: string, artist: string, album: string) => {
  console.log('set playing titles', duration, title, artist, album)
  return TrackPlayer.updateNowPlayingTitles(duration, title, artist, album)
}

export const resetPlay = async() => Promise.all([setPause(), setCurrentTime(0)])

export const isCached = async(url: string) => TrackPlayer.isCached(url)
export const getCacheSize = async() => TrackPlayer.getCacheSize()
export const clearCache = async() => TrackPlayer.clearCache()
export const migratePlayerCache = async() => {
  const newCachePath = privateStorageDirectoryPath + '/TrackPlayer'
  if (await existsFile(newCachePath)) return
  const oldCachePath = temporaryDirectoryPath + '/TrackPlayer'
  if (!await existsFile(oldCachePath)) return
  let timeout: number | null = BackgroundTimer.setTimeout(() => {
    timeout = null
    toast(global.i18n.t('player_cache_migrating'), 'long')
  }, 2_000)
  await moveFile(oldCachePath, newCachePath).finally(() => {
    if (timeout) BackgroundTimer.clearTimeout(timeout)
  })
}

export const destroy = async() => {
  if (global.lx.playerStatus.isIniting || !global.lx.playerStatus.isInitialized) return
  if (isMixerActive()) await releaseMixer()
  await TrackPlayer.destroy()
  global.lx.playerStatus.isInitialized = false
}

type PlayStatus = 'None' | 'Ready' | 'Playing' | 'Paused' | 'Stopped' | 'Buffering' | 'Connecting'

export const onStateChange = async(listener: (state: PlayStatus) => void) => {
  const sub = TrackPlayer.addEventListener(Event.PlaybackState, state => {
    let _state: PlayStatus
    switch (state) {
      case State.Ready:
        _state = 'Ready'
        break
      case State.Playing:
        _state = 'Playing'
        break
      case State.Paused:
        _state = 'Paused'
        break
      case State.Stopped:
        _state = 'Stopped'
        break
      case State.Buffering:
        _state = 'Buffering'
        break
      case State.Connecting:
        _state = 'Connecting'
        break
      case State.None:
      default:
        _state = 'None'
        break
    }
    listener(_state)
  })

  return () => {
    sub.remove()
  }
}

/**
 * Subscription player state chuange event
 * @param options state change event
 * @returns remove event function
 */
// export const playState = callback => TrackPlayer.addEventListener('playback-state', callback)

export const updateOptions = async(options = {
  // Whether the player should stop running when the app is closed on Android
  // stopWithApp: true,

  // An array of media controls capabilities
  // Can contain CAPABILITY_PLAY, CAPABILITY_PAUSE, CAPABILITY_STOP, CAPABILITY_SEEK_TO,
  // CAPABILITY_SKIP_TO_NEXT, CAPABILITY_SKIP_TO_PREVIOUS, CAPABILITY_SET_RATING
  capabilities: [
    Capability.Play,
    Capability.Pause,
    Capability.Stop,
    Capability.SeekTo,
    Capability.SkipToNext,
    Capability.SkipToPrevious,
  ],

  notificationCapabilities: [
    Capability.Play,
    Capability.Pause,
    Capability.Stop,
    Capability.SkipToNext,
    Capability.SkipToPrevious,
  ],

  // // An array of capabilities that will show up when the notification is in the compact form on Android
  compactCapabilities: [
    Capability.Play,
    Capability.Pause,
    Capability.Stop,
    Capability.SkipToNext,
  ],

  // Icons for the notification on Android (if you don't like the default ones)
  // playIcon: require('./play-icon.png'),
  // pauseIcon: require('./pause-icon.png'),
  // stopIcon: require('./stop-icon.png'),
  // previousIcon: require('./previous-icon.png'),
  // nextIcon: require('./next-icon.png'),
  // icon: notificationIcon, // The notification icon
}) => {
  return TrackPlayer.updateOptions(options)
}

// export const setMaxCache = async size => {
//   // const currentTrack = await TrackPlayer.getCurrentTrack()
//   // if (!currentTrack) return
//   // console.log(currentTrack)
//   // const currentTime = await TrackPlayer.getPosition()
//   // const state = await TrackPlayer.getState()
//   // await stop()
//   // await TrackPlayer.destroy()
//   // await TrackPlayer.setupPlayer({ maxCacheSize: size * 1024, maxBuffer: 1000, waitForBuffer: true })
//   // await updateOptions()
//   // await TrackPlayer.seekTo(currentTime)
//   // switch (state) {
//   //   case TrackPlayer.STATE_PLAYING:
//   //   case TrackPlayer.STATE_BUFFERING:
//   //     await TrackPlayer.play()
//   //     break
//   //   default:
//   //     break
//   // }
// }

// export {
//   useProgress,
// }

export { updateMetaData, initTrackInfo } from './playList'
