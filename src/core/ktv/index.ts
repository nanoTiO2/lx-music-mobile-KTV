import { getPicPath, getLyricInfo } from '@/core/music'
import { play as resyncLyric } from '@/core/lyric'
import { setStatusText } from '@/core/player/playStatus'
import { getPosition, setPause, setResource, setVolume, startResourceTransition } from '@/plugins/player'
import playerActions from '@/store/player/action'
import playerState from '@/store/player/state'
import settingState from '@/store/setting/state'
import { extname, readDir } from '@/utils/fs'
import { prewarmBeatGrid } from '@/core/ktv/beat'
import { buildKtvGroups, detectKtvVariant } from '@/utils/ktv'

interface KtvFile {
  path: string
  name?: string
  mimeType?: string
  variantLabel?: string
  variant?: string
}

interface KtvGroup {
  baseName: string
  ext: string
  mains: KtvFile[]
  variants: Record<string, KtvFile[]>
}

type KtvGroups = Map<string, KtvGroup>

export interface KtvOption {
  filePath: string
  label: string
  value: string
  variant: string
}

const AUDIO_EXTS = new Set(['mp3', 'flac', 'wav', 'ogg', 'm4a', 'aac', 'ape'])
let latestKtvSwitchRequestId = 0
const ORDERED_VARIANTS = [
  'htdemucs_minus_vocals',
  'htdemucs_minus_other',
  'htdemucs_vocals',
  'minus_vocals',
  'minus_other',
  'vocals',
  'bgm',
  'others',
  'bass',
  'drums',
]
const getDirPath = (filePath: string) => {
  const index = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return index > -1 ? filePath.substring(0, index) : ''
}

const getMusicFilePath = (musicInfo: LX.Music.MusicInfoLocal) => {
  return musicInfo.meta?.filePath?.trim() ?? ''
}

const getVariantDisplayName = (variant: string) => {
  switch (variant) {
    case 'main':
      return '主文件'
    case 'htdemucs_minus_vocals':
      return 'htdemucs_minus_vocals'
    case 'htdemucs_minus_other':
      return 'htdemucs_minus_other'
    case 'htdemucs_vocals':
      return 'htdemucs_vocals'
    case 'minus_vocals':
      return 'minus_vocals'
    case 'minus_other':
      return 'minus_other'
    case 'vocals':
      return 'vocals'
    case 'bgm':
      return 'bgm'
    case 'others':
      return 'others'
    case 'bass':
      return 'bass'
    case 'drums':
      return 'drums'
    default:
      return '音轨'
  }
}

const trimVariantText = (text: string) => text
  .replace(/^[\s_.\-()[\]【】（）]+/u, '')
  .replace(/[\s_.\-()[\]【】（）]+$/u, '')
  .trim()

const getNameWithoutExt = (name: string) => {
  const index = name.lastIndexOf('.')
  return index > -1 ? name.slice(0, index) : name
}

const getDerivedVariantLabel = (groupBaseName: string, file: KtvFile, variant: string) => {
  const fallbackLabel = file.variantLabel?.trim()
  if (fallbackLabel) return fallbackLabel
  const fileName = file.name?.trim()
  if (!fileName) return getVariantDisplayName(variant)
  const stem = getNameWithoutExt(fileName)
  if (stem == groupBaseName) return getVariantDisplayName(variant)
  if (stem.toLowerCase().startsWith(groupBaseName.toLowerCase())) {
    const diff = trimVariantText(stem.slice(groupBaseName.length))
    if (diff) return diff
  }
  return getVariantDisplayName(variant)
}

const createOptionLabel = (groupBaseName: string, file: KtvFile, variant: string, index: number, total: number) => {
  const name = getDerivedVariantLabel(groupBaseName, file, variant)
  return total > 1 ? `${name} ${index + 1}` : name
}

const getMatchPaths = (musicInfo: LX.Music.MusicInfoLocal) => {
  return new Set([
    musicInfo.meta.filePath,
    musicInfo.meta.originFilePath,
    musicInfo.id,
  ].filter(Boolean))
}

const getMatchedGroup = (groups: KtvGroups, musicInfo: LX.Music.MusicInfoLocal) => {
  const matchPaths = getMatchPaths(musicInfo)
  for (const group of groups.values()) {
    if (group.mains.some(file => matchPaths.has(file.path))) return group
    const variantLists = Object.values(group.variants)
    if (variantLists.some(list => list.some(file => matchPaths.has(file.path)))) return group
  }
  return null
}

const getMetadataFilePath = (group: KtvGroup, fallbackPath: string) => {
  return group.mains[0]?.path ??
    group.variants.original?.[0]?.path ??
    fallbackPath
}

const buildOptions = (group: KtvGroup) => {
  const options: KtvOption[] = []
  const mainFile = group.mains[0]
  if (mainFile) {
    options.push({
      filePath: mainFile.path,
      label: '主文件',
      value: mainFile.path,
      variant: 'main',
    })
  }
  const variantOrder = [...ORDERED_VARIANTS, ...Object.keys(group.variants).filter(variant => !ORDERED_VARIANTS.includes(variant))]
  for (const variant of variantOrder) {
    const list = group.variants[variant] ?? []
    list.forEach((file, index) => {
      options.push({
        filePath: file.path,
        label: createOptionLabel(group.baseName, file, variant, index, list.length),
        value: file.path,
        variant,
      })
    })
  }
  return options
}

export const getKtvOptions = async(musicInfo: LX.Music.MusicInfoLocal) => {
  const filePath = getMusicFilePath(musicInfo)
  if (!filePath) return null
  const dirPath = getDirPath(filePath)
  if (!dirPath) return null
  const files = (await readDir(dirPath) as KtvFile[]).filter(file => {
    if (file.mimeType?.startsWith('audio/')) return true
    return AUDIO_EXTS.has(extname(file.name ?? '').toLowerCase())
  })
  const group = getMatchedGroup(buildKtvGroups(files) as KtvGroups, musicInfo)
  if (!group) return null
  const options = buildOptions(group)
  if (options.length < 2) return null
  return {
    currentFilePath: filePath,
    metadataFilePath: getMetadataFilePath(group, musicInfo.meta.originFilePath ?? filePath),
    beatSourceFilePath: group.mains[0]?.path ?? filePath,
    options,
  }
}

export const switchKtvVariant = async(option: KtvOption) => {
  try {
    const requestId = ++latestKtvSwitchRequestId
    const trace = (step: string, extra?: unknown) => {
      if (extra === undefined) console.log('[KTV_SWITCH]', step)
      else console.log('[KTV_SWITCH]', step, extra)
    }
    trace('start', { option })
    const playMusicInfo = playerState.playMusicInfo
    const musicInfo = playMusicInfo.musicInfo
    trace('loaded_play_music_info', {
      hasMusicInfo: !!musicInfo,
      source: musicInfo && !('progress' in musicInfo) ? musicInfo.source : 'progress_or_null',
      isPlay: playerState.isPlay,
    })
    if (!musicInfo || 'progress' in musicInfo || musicInfo.source != 'local') return
    const currentFilePath = getMusicFilePath(musicInfo)
    trace('current_file_path', currentFilePath)
    if (!currentFilePath || currentFilePath == option.filePath) return

    const ktvOptions = await getKtvOptions(musicInfo)
    trace('ktv_options', {
      hasOptions: !!ktvOptions,
      optionCount: ktvOptions?.options.length,
      beatSourceFilePath: ktvOptions?.beatSourceFilePath,
    })
    if (!ktvOptions) return
    const currentVariant = getCurrentKtvVariant(musicInfo, ktvOptions.options)
    const variantGain = settingState.setting['player.ktvVariantGain']
    const fromGain = currentVariant == 'main' ? 1 : variantGain
    const toGain = option.variant == 'main' ? 1 : variantGain

    const nextMusicInfo: LX.Music.MusicInfoLocal = {
      ...musicInfo,
      meta: {
        ...musicInfo.meta,
        filePath: option.filePath,
        originFilePath: ktvOptions.metadataFilePath,
        ktvInfo: {
          currentVariant: option.variant,
          metadataFilePath: ktvOptions.metadataFilePath,
          variants: ktvOptions.options.reduce<Record<string, string[]>>((result, item) => {
            if (!result[item.variant]) result[item.variant] = []
            result[item.variant].push(item.filePath)
            return result
          }, {}),
        },
      },
    }
    trace('next_music_info_ready', {
      nextFilePath: nextMusicInfo.meta.filePath,
      metadataFilePath: nextMusicInfo.meta.originFilePath,
    })

    const wasPlaying = playerState.isPlay
    let position = playerState.progress.nowPlayTime
    try {
      position = await getPosition()
    } catch {}
    const positionMs = Math.max(0, Math.round(position * 1000))
    trace('position_loaded', { wasPlaying, position, positionMs })
    const switchAtMs = positionMs
    const switchDelayMs = Math.max(0, switchAtMs - positionMs)
    const switchPosition = switchAtMs / 1000
    trace('switch_timing', { switchAtMs, switchDelayMs, switchPosition, beatSync: false })

    const metadataTask = Promise.all([
      (async() => {
        try {
          return await getLyricInfo({ musicInfo: nextMusicInfo })
        } catch {
          return null
        }
      })(),
      (async() => {
        try {
          return await getPicPath({ musicInfo: nextMusicInfo, listId: playMusicInfo.listId ?? undefined })
        } catch {
          return ''
        }
      })(),
    ])
    trace('metadata_task_created', {
      hasSetPlayMusicInfo: typeof playerActions.setPlayMusicInfo,
      hasSetMusicInfo: typeof playerActions.setMusicInfo,
      hasPicUpdated: typeof global.app_event.picUpdated,
      hasLyricUpdated: typeof global.app_event.lyricUpdated,
    })

    setStatusText(wasPlaying && switchDelayMs > 40 ? `KTV: ${option.label}（下一拍切换）` : `KTV: ${option.label}`)
    trace('status_set')

    const finalizeSwitch = () => {
      trace('finalize_switch_enter')
      playerActions.setPlayMusicInfo(playMusicInfo.listId, nextMusicInfo, playMusicInfo.isTempPlay)
      setStatusText(`KTV: ${option.label}`)
      trace('play_music_info_updated')
      void setVolume(settingState.setting['player.volume'])

      void metadataTask.then(([lyricInfo, pic]) => {
        if (requestId != latestKtvSwitchRequestId) return
        trace('metadata_task_resolved', {
          hasLyric: !!lyricInfo,
          hasPic: !!pic,
        })
        const currentPlayMusicInfo = playerState.playMusicInfo.musicInfo
        if (!currentPlayMusicInfo || 'progress' in currentPlayMusicInfo || currentPlayMusicInfo.source != 'local') return
        if (currentPlayMusicInfo.meta.filePath != nextMusicInfo.meta.filePath) return

        if (pic && pic != playerState.musicInfo.pic && playerState.loadErrorPicUrl != pic) {
          playerActions.setMusicInfo({ pic })
          global.app_event.picUpdated()
          trace('pic_updated')
        }
        if (lyricInfo) {
          playerActions.setMusicInfo({
            lrc: lyricInfo.lyric,
            tlrc: lyricInfo.tlyric,
            lxlrc: lyricInfo.lxlyric,
            rlrc: lyricInfo.rlyric,
            rawlrc: lyricInfo.rawlrcInfo.lyric,
          })
          global.app_event.lyricUpdated()
          if (wasPlaying) {
            setTimeout(() => {
              if (requestId != latestKtvSwitchRequestId) return
              void resyncLyric()
            }, 0)
          }
          trace('lyric_updated')
        }
      })

      if (!wasPlaying) {
        setTimeout(() => {
          trace('pause_after_non_playing_switch')
          void setPause()
        }, 350)
      }
    }

    const applySwitch = async() => {
      trace('apply_switch_enter')
      if (!wasPlaying) {
        setResource(nextMusicInfo, option.filePath, switchPosition)
        trace('set_resource_non_playing_done')
        finalizeSwitch()
        return
      }

      trace('start_resource_transition_before')
      let transitioned = false
      try {
        transitioned = await startResourceTransition({
          musicInfo: nextMusicInfo,
          fromUrl: currentFilePath,
          toUrl: option.filePath,
          position,
          switchAt: switchPosition,
          playWhenReady: true,
          fadeDurationMs: 180,
          fromGain,
          toGain,
        })
      } catch (error) {
        console.warn('KTV startResourceTransition failed', error)
      }
      trace('start_resource_transition_after', { transitioned })

      if (!transitioned) {
        setResource(nextMusicInfo, option.filePath, switchPosition)
        trace('set_resource_fallback_done')
        finalizeSwitch()
        return
      }

      finalizeSwitch()
    }

    if (!wasPlaying) {
      await applySwitch()
    } else if (switchDelayMs <= 40) {
      await applySwitch()
    } else {
      await applySwitch()
    }
  } catch (error) {
    console.error('switchKtvVariant failed', error)
    throw error
  }
}

export const getCurrentKtvVariant = (musicInfo: LX.Music.MusicInfoLocal, options: KtvOption[]) => {
  const currentPath = getMusicFilePath(musicInfo)
  if (!currentPath) return 'main'
  const pathParts = currentPath.split(/\/|\\/)
  const currentFileName = pathParts[pathParts.length - 1] ?? ''
  return options.find(option => option.filePath == currentPath)?.variant ??
    detectKtvVariant(currentFileName).variant
}

export const prewarmKtvBeatAnalysis = async(musicInfo: LX.Music.MusicInfoLocal) => {
  const filePath = getMusicFilePath(musicInfo)
  if (!filePath) return
  await prewarmBeatGrid(filePath)
}
