import { temporaryDirectoryPath, readDir, unlink, extname } from '@/utils/fs'
import { readPic as _readPic } from 'react-native-local-media-metadata'
import { filterKtvDisplayFiles } from '@/utils/ktv'
import type { FileType } from '@/utils/fs'
export {
  type MusicMetadata,
  type MusicMetadataFull,
  readMetadata,
  writeMetadata,
  writePic,
  readLyric,
  writeLyric,
} from 'react-native-local-media-metadata'

let cleared = false
const picCachePath = temporaryDirectoryPath + '/local-media-metadata'

const AUDIO_EXTS = new Set(['mp3', 'flac', 'wav', 'ogg', 'm4a', 'aac', 'ape'])

export interface AudioFolderGroup {
  rootDirPath: string
  rootName: string
  dirPath: string
  name: string
  relativePath: string
  files: FileType[]
}

const isAudioFile = (file: Awaited<ReturnType<typeof readDir>>[number]) => {
  if (file.mimeType?.startsWith('audio/')) return true
  return AUDIO_EXTS.has(extname(file?.name ?? '').toLowerCase())
}

const getBaseName = (path: string) => {
  const parts = path.split(/\/|\\/)
  return parts[parts.length - 1] ?? path
}

const toRelativePath = (rootPath: string, targetPath: string) => {
  if (targetPath == rootPath) return ''
  const root = rootPath.replace(/\\/g, '/').replace(/\/+$/, '')
  const target = targetPath.replace(/\\/g, '/')
  return target.startsWith(root + '/') ? target.slice(root.length + 1) : getBaseName(targetPath)
}

export const scanAudioFiles = async(dirPath: string, recursive: boolean = false) => {
  const queue = [dirPath]
  const files: Awaited<ReturnType<typeof readDir>> = []
  while (queue.length) {
    const currentPath = queue.shift()
    if (!currentPath) continue
    const currentFiles = await readDir(currentPath).catch(() => [])
    for (const file of currentFiles) {
      if (file.isDirectory) {
        if (recursive) queue.push(file.path)
        continue
      }
      if (isAudioFile(file)) files.push(file)
    }
  }
  return filterKtvDisplayFiles(files.map(file => file)) as FileType[]
}

export const scanAudioFolderGroups = async(dirPath: string, recursive: boolean = false) => {
  const queue = [dirPath]
  const groups: AudioFolderGroup[] = []
  while (queue.length) {
    const currentPath = queue.shift()
    if (!currentPath) continue
    const currentFiles = await readDir(currentPath).catch(() => [])
    const audioFiles: FileType[] = []
    for (const file of currentFiles) {
      if (file.isDirectory) {
        if (recursive) queue.push(file.path)
        continue
      }
      if (isAudioFile(file)) audioFiles.push(file)
    }
    const filteredFiles = filterKtvDisplayFiles(audioFiles.map(file => file)) as FileType[]
    if (!filteredFiles.length) continue
    const relativePath = toRelativePath(dirPath, currentPath)
    groups.push({
      rootDirPath: dirPath,
      rootName: getBaseName(dirPath),
      dirPath: currentPath,
      name: relativePath ? getBaseName(currentPath) : getBaseName(dirPath),
      relativePath,
      files: filteredFiles,
    })
  }
  return groups
}

const clearPicCache = async() => {
  await unlink(picCachePath)
  cleared = true
}

export const readPic = async(dirPath: string): Promise<string> => {
  if (!cleared) await clearPicCache()
  return _readPic(dirPath, picCachePath)
}

// export interface MusicMetadata {
//   type: 'mp3' | 'flac' | 'ogg' | 'wav'
//   bitrate: string
//   interval: number
//   size: number
//   ext: 'mp3' | 'flac' | 'ogg' | 'wav'
//   albumName: string
//   singer: string
//   name: string
// }
// export const readMetadata = async(filePath: string): Promise<MusicMetadata | null> => {
//   return LocalMediaModule.readMetadata(filePath)
// }

// export const readPic = async(filePath: string): Promise<string> => {
//   return LocalMediaModule.readPic(filePath)
// }

// export const readLyric = async(filePath: string): Promise<string> => {
//   return LocalMediaModule.readLyric(filePath)
// }
