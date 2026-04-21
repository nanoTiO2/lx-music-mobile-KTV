import { analyzeMixerMusicProfile } from '@/utils/nativeModules/mixer'
import { existsFile, readFile, writeFile } from '@/utils/fs'
import iconv from 'iconv-lite'
import {
  decodePortableMusicProfileFromLrc,
  injectPortableMusicProfileIntoLrc,
  normalizePortableMusicProfile,
  type PortableMusicProfile,
  type StoredPortableMusicProfile,
} from '@/shared/musicProfileTag'

export interface MusicProfile extends PortableMusicProfile {}

interface StoredMusicProfile extends StoredPortableMusicProfile {}

type LrcEncoding = 'utf8' | 'utf16le' | 'utf16be' | 'gb18030'

interface DecodedLrcFile {
  text: string
  encoding: LrcEncoding
  hasBom: boolean
  newline: '\n' | '\r\n' | '\r'
}

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

const swapUtf16ByteOrder = (buffer: Buffer) => {
  const next = Buffer.from(buffer)
  for (let index = 0; index < next.length - 1; index += 2) {
    const current = next[index]
    next[index] = next[index + 1]
    next[index + 1] = current
  }
  return next
}

const isLikelyUtf16 = (buffer: Buffer) => {
  if (buffer.length < 4) return null
  let oddZeroCount = 0
  let evenZeroCount = 0
  const sampleSize = Math.min(buffer.length, 256)
  for (let index = 0; index < sampleSize; index += 1) {
    if (buffer[index] !== 0) continue
    if (index % 2 === 0) evenZeroCount += 1
    else oddZeroCount += 1
  }
  if (oddZeroCount >= sampleSize / 8 && oddZeroCount > evenZeroCount * 2) return 'utf16le'
  if (evenZeroCount >= sampleSize / 8 && evenZeroCount > oddZeroCount * 2) return 'utf16be'
  return null
}

const decodeLrcBuffer = (buffer: Buffer): DecodedLrcFile => {
  if (buffer.length >= 3 && buffer[0] == 0xef && buffer[1] == 0xbb && buffer[2] == 0xbf) {
    return {
      text: buffer.slice(3).toString('utf8'),
      encoding: 'utf8',
      hasBom: true,
      newline: '\n',
    }
  }
  if (buffer.length >= 2 && buffer[0] == 0xff && buffer[1] == 0xfe) {
    return {
      text: iconv.decode(buffer.slice(2), 'utf16le'),
      encoding: 'utf16le',
      hasBom: true,
      newline: '\n',
    }
  }
  if (buffer.length >= 2 && buffer[0] == 0xfe && buffer[1] == 0xff) {
    return {
      text: iconv.decode(swapUtf16ByteOrder(buffer.slice(2)), 'utf16le'),
      encoding: 'utf16be',
      hasBom: true,
      newline: '\n',
    }
  }

  const detectedUtf16 = isLikelyUtf16(buffer)
  if (detectedUtf16 == 'utf16le') {
    return {
      text: iconv.decode(buffer, 'utf16le'),
      encoding: 'utf16le',
      hasBom: false,
      newline: '\n',
    }
  }
  if (detectedUtf16 == 'utf16be') {
    return {
      text: iconv.decode(swapUtf16ByteOrder(buffer), 'utf16le'),
      encoding: 'utf16be',
      hasBom: false,
      newline: '\n',
    }
  }

  const utf8Text = buffer.toString('utf8')
  if (Buffer.from(utf8Text, 'utf8').equals(buffer)) {
    return {
      text: utf8Text,
      encoding: 'utf8',
      hasBom: false,
      newline: '\n',
    }
  }

  return {
    text: iconv.decode(buffer, 'gb18030'),
    encoding: 'gb18030',
    hasBom: false,
    newline: '\n',
  }
}

const normalizeDecodedLrc = (decoded: DecodedLrcFile): DecodedLrcFile => {
  const newline = decoded.text.includes('\r\n')
    ? '\r\n'
    : decoded.text.includes('\r')
      ? '\r'
      : '\n'
  return {
    ...decoded,
    newline,
  }
}

const readDecodedLrcFile = async(path: string) => {
  const raw = await readFile(path, 'base64')
  return normalizeDecodedLrc(decodeLrcBuffer(Buffer.from(raw, 'base64')))
}

const encodeLrcText = (text: string, encoding: LrcEncoding, hasBom: boolean) => {
  let payload: Buffer
  switch (encoding) {
    case 'utf16le':
      payload = iconv.encode(text, 'utf16le')
      return hasBom ? Buffer.concat([Buffer.from([0xff, 0xfe]), payload]) : payload
    case 'utf16be':
      payload = swapUtf16ByteOrder(iconv.encode(text, 'utf16le'))
      return hasBom ? Buffer.concat([Buffer.from([0xfe, 0xff]), payload]) : payload
    case 'gb18030':
      payload = iconv.encode(text, 'gb18030')
      return payload
    case 'utf8':
    default:
      payload = Buffer.from(text, 'utf8')
      return hasBom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), payload]) : payload
  }
}

const getEmbeddedMusicProfile = async(filePath: string) => {
  const lyricPath = getMusicProfileLyricPath(filePath)
  if (!lyricPath) return null
  if (!(await existsFile(lyricPath).catch(() => false))) return null
  try {
    const decoded = await readDecodedLrcFile(lyricPath)
    return decodePortableMusicProfileFromLrc(decoded.text)
  } catch {
    return null
  }
}

export const getCachedMusicProfile = async(filePath: string) => {
  const cachePath = getMusicProfileCachePath(filePath)
  if (cachePath && await existsFile(cachePath).catch(() => false)) {
    try {
      const raw = await readFile(cachePath)
      const cachedProfile = normalizePortableMusicProfile(JSON.parse(raw) as Partial<StoredMusicProfile>)
      if (cachedProfile) return cachedProfile
    } catch {}
  }
  const embeddedProfile = await getEmbeddedMusicProfile(filePath)
  if (embeddedProfile) return embeddedProfile
  return null
}

const persistMusicProfileToLyric = async(filePath: string, payload: StoredMusicProfile) => {
  const lyricPath = getMusicProfileLyricPath(filePath)
  if (!lyricPath) return
  if (!(await existsFile(lyricPath).catch(() => false))) return
  const decoded = await readDecodedLrcFile(lyricPath)
  let nextContent = injectPortableMusicProfileIntoLrc(decoded.text, payload)
  if (decoded.newline != '\n') nextContent = nextContent.replace(/\n/g, decoded.newline)
  const nextBuffer = encodeLrcText(nextContent, decoded.encoding, decoded.hasBom)
  await writeFile(lyricPath, nextBuffer.toString('base64'), 'base64')
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
        const normalizedProfile: MusicProfile = {
          ...profile,
          analysisScope: maxAnalyzeMs > 90_000 ? 'full' : 'quick',
        }
        await persistMusicProfile(path, normalizedProfile).catch(() => {})
        profileCache.delete(path)
        return normalizedProfile
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
