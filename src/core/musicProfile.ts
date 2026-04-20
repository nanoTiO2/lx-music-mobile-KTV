import { analyzeMixerMusicProfile } from '@/utils/nativeModules/mixer'
import { existsFile, readFile, writeFile } from '@/utils/fs'
import {
  decodePortableMusicProfileFromLrc,
  injectPortableMusicProfileIntoLrc,
  normalizePortableMusicProfile,
  type PortableMusicProfile,
  type StoredPortableMusicProfile,
} from '@/shared/musicProfileTag'

export interface MusicProfile extends PortableMusicProfile {}

interface StoredMusicProfile extends StoredPortableMusicProfile {}

const profileCache = new Map<string, Promise<MusicProfile>>()

export const getMusicProfilePath = (musicInfo: LX.Player.PlayMusic | LX.Music.MusicInfoLocal | null | undefined) => {
  if (!musicInfo || 'progress' in musicInfo || musicInfo.source != 'local') return ''
  return musicInfo.meta.originFilePath?.trim() || musicInfo.meta.filePath?.trim() || ''
}

export const getMusicProfileCachePath = (filePath: string) => {
  const path = filePath.trim()
  if (!path) return ''
  return `${path}.lx-profile.json`
}

const getMusicProfileLyricPath = (filePath: string) => {
  const path = filePath.trim()
  if (!path) return ''
  const dotIndex = path.lastIndexOf('.')
  return dotIndex > -1 ? `${path.substring(0, dotIndex)}.lrc` : `${path}.lrc`
}

const getEmbeddedMusicProfile = async(filePath: string) => {
  const lyricPath = getMusicProfileLyricPath(filePath)
  if (!lyricPath) return null
  if (!(await existsFile(lyricPath).catch(() => false))) return null
  try {
    const raw = await readFile(lyricPath)
    return decodePortableMusicProfileFromLrc(raw)
  } catch {
    return null
  }
}

export const getCachedMusicProfile = async(filePath: string) => {
  const embeddedProfile = await getEmbeddedMusicProfile(filePath)
  if (embeddedProfile) return embeddedProfile
  const cachePath = getMusicProfileCachePath(filePath)
  if (!cachePath) return null
  if (!(await existsFile(cachePath).catch(() => false))) return null
  try {
    const raw = await readFile(cachePath)
    return normalizePortableMusicProfile(JSON.parse(raw) as Partial<StoredMusicProfile>)
  } catch {
    return null
  }
}

const persistMusicProfileToLyric = async(filePath: string, payload: StoredMusicProfile) => {
  const lyricPath = getMusicProfileLyricPath(filePath)
  if (!lyricPath) return
  if (!(await existsFile(lyricPath).catch(() => false))) return
  const raw = await readFile(lyricPath)
  const nextContent = injectPortableMusicProfileIntoLrc(raw, payload)
  await writeFile(lyricPath, nextContent)
}

const persistMusicProfile = async(filePath: string, profile: MusicProfile) => {
  const cachePath = getMusicProfileCachePath(filePath)
  if (!cachePath) return
  const payload: StoredMusicProfile = {
    ...profile,
    sourcePath: filePath,
    updatedAt: new Date().toISOString(),
  }
  await writeFile(cachePath, JSON.stringify(payload))
  await persistMusicProfileToLyric(filePath, payload).catch(() => {})
}

export const getMusicProfile = async(filePath: string, maxAnalyzeMs: number = 90_000) => {
  const path = filePath.trim()
  if (!path) throw new Error('file path is empty')
  let task = profileCache.get(path)
  if (!task) {
    task = analyzeMixerMusicProfile(path, maxAnalyzeMs)
      .then(async profile => {
        await persistMusicProfile(path, profile).catch(() => {})
        profileCache.delete(path)
        return profile
      })
      .catch(err => {
        profileCache.delete(path)
        throw err
      })
    profileCache.set(path, task)
  }
  return task
}

export const clearMusicProfileCache = (filePath?: string) => {
  if (filePath) profileCache.delete(filePath)
  else profileCache.clear()
}
