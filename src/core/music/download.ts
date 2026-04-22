import { existsFile } from '@/utils/fs'
import { readPic } from '@/utils/localMediaMetadata'
import {
  getMusicUrl as getOnlineMusicUrl,
  getPicUrl as getOnlinePicUrl,
  getLyricInfo as getOnlineLyricInfo,
} from './online'
import { buildLyricInfo, getCachedLyricInfo } from './utils'

const getLocalDownloadedPath = async(musicInfo: LX.Download.ListItem) => {
  if (!musicInfo.isComplate) return null
  const filePath = musicInfo.metadata.filePath
  if (!filePath) return null
  return await existsFile(filePath).then(exists => exists ? filePath : null).catch(() => null)
}

const getDownloadedCoverPath = (filePath: string) => {
  const dotIndex = filePath.lastIndexOf('.')
  return dotIndex > -1 ? `${filePath.substring(0, dotIndex)}.cover.jpg` : `${filePath}.cover.jpg`
}

const normalizeLocalUri = (uri: string) => {
  try {
    return encodeURI(uri)
  } catch {
    return uri
  }
}

export const getMusicUrl = async({ musicInfo, isRefresh, allowToggleSource = true, onToggleSource = () => {} }: {
  musicInfo: LX.Download.ListItem
  isRefresh: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
  allowToggleSource?: boolean
}): Promise<string> => {
  if (!isRefresh) {
    const localPath = await getLocalDownloadedPath(musicInfo)
    if (localPath) return localPath
  }

  return getOnlineMusicUrl({ musicInfo: musicInfo.metadata.musicInfo, isRefresh, onToggleSource, allowToggleSource })
}

export const getPicUrl = async({ musicInfo, isRefresh, listId, onToggleSource = () => {} }: {
  musicInfo: LX.Download.ListItem
  isRefresh: boolean
  listId?: string | null
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<string> => {
  if (!isRefresh) {
    const localPath = await getLocalDownloadedPath(musicInfo)
    if (localPath) {
      const localCoverPath = getDownloadedCoverPath(localPath)
      if (await existsFile(localCoverPath).catch(() => false)) {
        const pic = normalizeLocalUri(`file://${localCoverPath}`)
        musicInfo.metadata.musicInfo.meta.picUrl = pic
        return pic
      }
      let pic = await readPic(localPath).catch(() => '')
      if (pic) {
        if (pic.startsWith('/')) pic = `file://${pic}`
        pic = normalizeLocalUri(pic)
        musicInfo.metadata.musicInfo.meta.picUrl = pic
        return pic
      }
    }
    const onlineMusicInfo = musicInfo.metadata.musicInfo
    if (onlineMusicInfo.meta.picUrl) return onlineMusicInfo.meta.picUrl
  }

  return getOnlinePicUrl({ musicInfo: musicInfo.metadata.musicInfo, isRefresh, onToggleSource }).then((url) => {
    return url
  })
}

export const getLyricInfo = async({ musicInfo, isRefresh, onToggleSource = () => {} }: {
  musicInfo: LX.Download.ListItem
  isRefresh: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<LX.Player.LyricInfo> => {
  if (!isRefresh) {
    const lyricInfo = await getCachedLyricInfo(musicInfo.metadata.musicInfo)
    if (lyricInfo) return buildLyricInfo(lyricInfo)
  }

  return getOnlineLyricInfo({
    musicInfo: musicInfo.metadata.musicInfo,
    isRefresh,
    onToggleSource,
  }).catch(async() => {
    throw new Error('failed')
  })
}
