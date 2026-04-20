import { existsFile } from './fs'

export const getLocalFilePath = async(musicInfo: LX.Music.MusicInfoLocal): Promise<string> => {
  const filePath = musicInfo.meta?.filePath?.trim() ?? ''
  if (!filePath) return ''
  if (await existsFile(filePath)) return filePath
  return /\/\d+$/.test(filePath) ? filePath : ''
}

export const getLocalMetaFilePath = (musicInfo: LX.Music.MusicInfoLocal) => {
  return musicInfo.meta?.originFilePath?.trim() ??
    musicInfo.meta?.filePath?.trim() ??
    ''
}
