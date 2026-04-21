import { getLyricInfo as getOnlineLyricInfo, getMusicUrl as getOnlineMusicUrl } from '@/core/music/online'
import { updateSetting } from '@/core/common'
import { addListMusics, overwriteListMusics, updateListMusics } from '@/core/list'
import { LIST_IDS } from '@/config/constant'
import settingState from '@/store/setting/state'
import { formatPlayTime2 } from '@/utils'
import { getDownloadTasks as getStoredDownloadTasks, saveDownloadTasks as saveStoredDownloadTasks } from '@/utils/data'
import { downloadFile, existsFile, externalStorageDirectoryPath, mkdir, stopDownload, writeFile } from '@/utils/fs'
import { readMetadata } from '@/utils/localMediaMetadata'
import { log } from '@/utils/log'
import { getListMusicSync } from '@/utils/listManage'
import { buildLyrics } from '@/utils/lrcTools'
import { toast } from '@/utils/tools'


const DEFAULT_DOWNLOAD_DIR = `${externalStorageDirectoryPath}/Download/lxmusic`
const INVALID_PATH_CHAR_RXP = /[\\/:*?"<>|]/g
const ACTIVE_DOWNLOAD_JOBS = new Map<string, number>()

const ensureDownloadDirMappedToLocalMusic = (dir: string) => {
  const normalizedDir = dir.trim()
  if (!normalizedDir) return
  const importDirs = settingState.setting['list.importMusicDirs'] ?? []
  if (importDirs.includes(normalizedDir)) return
  updateSetting({
    'list.importMusicDirs': [...importDirs, normalizedDir],
    'list.importMusicDir': settingState.setting['list.importMusicDir'] || normalizedDir,
  })
}

const sanitizeFileName = (name: string) => {
  return name.replace(INVALID_PATH_CHAR_RXP, '_').trim() || `music_${Date.now()}`
}

const getTaskDir = (filePath: string) => {
  const index = filePath.lastIndexOf('/')
  return index > -1 ? filePath.substring(0, index) : getDownloadSaveDir()
}

const getSafeDownloadExt = (ext: string): LX.Download.FileExt => {
  switch (ext) {
    case 'flac':
    case 'wav':
    case 'ape':
    case 'mp3':
      return ext
    default:
      return 'mp3'
  }
}

const getExtFromUrl = (url: string) => {
  try {
    const pathname = new URL(url).pathname.toLowerCase()
    const matchedExt = /\.([a-z0-9]+)$/.exec(pathname)?.[1]
    return matchedExt ? getSafeDownloadExt(matchedExt) : 'mp3'
  } catch {
    const matchedExt = /\.([a-z0-9]+)(?:\?|$)/i.exec(url)?.[1]?.toLowerCase()
    return matchedExt ? getSafeDownloadExt(matchedExt) : 'mp3'
  }
}

const buildLyricPath = (filePath: string) => {
  const dotIndex = filePath.lastIndexOf('.')
  return dotIndex > -1 ? `${filePath.substring(0, dotIndex)}.lrc` : `${filePath}.lrc`
}

const buildLocalMusicInfo = (filePath: string, metadata: {
  name: string
  singer: string
  albumName: string
  interval: number
  ext: string
}): LX.Music.MusicInfoLocal => {
  return {
    id: filePath,
    name: metadata.name,
    singer: metadata.singer,
    source: 'local',
    interval: formatPlayTime2(metadata.interval),
    meta: {
      albumName: metadata.albumName,
      filePath,
      songId: filePath,
      picUrl: '',
      ext: metadata.ext,
    },
  }
}

export const importDownloadedMusicToDownloadList = async(filePath: string) => {
  const metadata = await readMetadata(filePath)
  if (!metadata) return null
  const musicInfo = buildLocalMusicInfo(filePath, metadata)
  const targetListId = LIST_IDS.DOWNLOAD
  const list = getListMusicSync(targetListId)
  if (list.some(item => item.id == musicInfo.id)) {
    await updateListMusics([{ id: targetListId, musicInfo }])
  } else {
    await addListMusics(targetListId, [musicInfo], settingState.setting['list.addMusicLocationType'])
  }
  return musicInfo
}

export const syncDownloadedList = async() => {
  const tasks = await getStoredDownloadTasks()
  const localMusicList: LX.Music.MusicInfo[] = []
  for (const task of tasks) {
    if (task.status != 'completed' || !task.metadata.filePath) continue
    if (!await existsFile(task.metadata.filePath)) continue
    const metadata = await readMetadata(task.metadata.filePath)
    if (!metadata) continue
    localMusicList.push(buildLocalMusicInfo(task.metadata.filePath, metadata))
  }
  await overwriteListMusics(LIST_IDS.DOWNLOAD, localMusicList)
  return localMusicList
}

export const formatDownloadFileName = (musicInfo: LX.Music.MusicInfo, ext: string) => {
  const template = settingState.setting['download.fileName']
  const rawName = template
    .replace('\u6b4c\u540d', musicInfo.name || 'unknown_song')
    .replace('\u6b4c\u624b', musicInfo.singer || 'unknown_artist')
  return `${sanitizeFileName(rawName)}.${ext}`
}

export const getDefaultDownloadSaveDir = () => DEFAULT_DOWNLOAD_DIR

export const getDownloadSaveDir = () => {
  return settingState.setting['download.useCustomDir'] && settingState.setting['download.saveDir']
    ? settingState.setting['download.saveDir']
    : DEFAULT_DOWNLOAD_DIR
}

export const setDownloadSaveDir = (dir: string) => {
  ensureDownloadDirMappedToLocalMusic(dir)
  updateSetting({
    'download.saveDir': dir,
    'download.useCustomDir': true,
  })
}

export const resetDownloadSaveDir = () => {
  ensureDownloadDirMappedToLocalMusic(DEFAULT_DOWNLOAD_DIR)
  updateSetting({
    'download.saveDir': '',
    'download.useCustomDir': false,
  })
}

export const ensureDownloadSaveDir = async(dir = getDownloadSaveDir()) => {
  ensureDownloadDirMappedToLocalMusic(dir)
  if (!await existsFile(dir)) await mkdir(dir)
  return dir
}

export const getDownloadTasks = async() => {
  return getStoredDownloadTasks()
}

export const saveDownloadTasks = async(tasks: LX.Download.ListItem[]) => {
  await saveStoredDownloadTasks(tasks)
  global.app_event.downloadListUpdate()
}

export const createDownloadTask = async(musicInfo: LX.Music.MusicInfoOnline, quality: LX.Quality, ext: LX.Download.FileExt = 'mp3') => {
  const saveDir = await ensureDownloadSaveDir()
  const fileName = formatDownloadFileName(musicInfo, ext)
  const filePath = `${saveDir}/${fileName}`
  const tasks = await getStoredDownloadTasks()
  const existingTask = tasks.find(task => task.metadata.musicInfo.id == musicInfo.id && task.metadata.quality == quality)

  if (existingTask) {
    existingTask.metadata.fileName = fileName
    existingTask.metadata.filePath = filePath
    existingTask.status = 'waiting'
    existingTask.statusText = 'Waiting to start'
    await saveDownloadTasks([...tasks])
    return existingTask
  }

  const task: LX.Download.ListItem = {
    id: `download_${musicInfo.id}_${Date.now()}`,
    isComplate: false,
    status: 'waiting',
    statusText: 'Waiting to start',
    downloaded: 0,
    total: 0,
    progress: 0,
    speed: '',
    metadata: {
      musicInfo,
      url: null,
      quality,
      ext,
      fileName,
      filePath,
    },
  }

  tasks.unshift(task)
  await saveDownloadTasks(tasks)
  log.info('download task created', {
    taskId: task.id,
    musicId: musicInfo.id,
    saveDir,
  })
  return task
}

export const updateDownloadTask = async(id: string, partialTask: Partial<LX.Download.ListItem>) => {
  const tasks = await getStoredDownloadTasks()
  const index = tasks.findIndex(task => task.id == id)
  if (index < 0) return null
  tasks[index] = {
    ...tasks[index],
    ...partialTask,
    metadata: {
      ...tasks[index].metadata,
      ...partialTask.metadata,
    },
  }
  await saveDownloadTasks(tasks)
  return tasks[index]
}

export const removeDownloadTask = async(id: string) => {
  const tasks = await getStoredDownloadTasks()
  const nextTasks = tasks.filter(task => task.id != id)
  if (nextTasks.length == tasks.length) return false
  await saveDownloadTasks(nextTasks)
  return true
}

export const clearCompletedDownloadTasks = async() => {
  const tasks = await getStoredDownloadTasks()
  const nextTasks = tasks.filter(task => task.status != 'completed')
  await saveDownloadTasks(nextTasks)
}

const resolveTaskLyricText = async(task: LX.Download.ListItem) => {
  for (const isRefresh of [false, true]) {
    try {
      const lyricInfo = await getOnlineLyricInfo({
        musicInfo: task.metadata.musicInfo,
        isRefresh,
      })
      const lyricText = buildLyrics({
        lyric: lyricInfo.rawlrcInfo?.lyric || lyricInfo.lyric || '',
        tlyric: lyricInfo.tlyric,
        rlyric: lyricInfo.rlyric,
        lxlyric: lyricInfo.lxlyric,
      }, true, true, true).trim()
      if (lyricText) return lyricText
    } catch (err: any) {
      log.warn('resolve download lyric failed', task.id, isRefresh ? 'refresh' : 'cache', err?.message ?? err)
    }
  }
  return ''
}

const saveTaskLyric = async(task: LX.Download.ListItem) => {
  const lyricText = await resolveTaskLyricText(task)
  if (!lyricText) return false
  await writeFile(buildLyricPath(task.metadata.filePath), lyricText)
  return true
}

export const startDownloadTask = async(taskId: string) => {
  const tasks = await getStoredDownloadTasks()
  const task = tasks.find(item => item.id == taskId)
  if (!task) throw new Error('download task not found')
  if (ACTIVE_DOWNLOAD_JOBS.has(task.id)) return task

  const saveDir = getTaskDir(task.metadata.filePath)
  await ensureDownloadSaveDir(saveDir)
  await updateDownloadTask(task.id, {
    status: 'run',
    statusText: 'Resolving url',
    progress: 0,
    downloaded: 0,
    total: 0,
    speed: '',
  })

  let latestTotal = 0
  let latestDownloaded = 0

  try {
    const url = await getOnlineMusicUrl({
      musicInfo: task.metadata.musicInfo,
      quality: task.metadata.quality,
      isRefresh: true,
      allowToggleSource: true,
      onToggleSource: () => {},
    })
    const ext = getExtFromUrl(url)
    const fileName = formatDownloadFileName(task.metadata.musicInfo, ext)
    const filePath = `${saveDir}/${fileName}`

    await updateDownloadTask(task.id, {
      status: 'run',
      statusText: 'Downloading',
      metadata: {
        ...task.metadata,
        url,
        ext,
        fileName,
        filePath,
      },
    })

    const startTime = Date.now()
    const downloadRes = downloadFile(url, filePath, {
      progressInterval: 500,
      connectionTimeout: 20000,
      readTimeout: 30000,
      begin({ contentLength }) {
        latestTotal = contentLength
        void updateDownloadTask(task.id, {
          status: 'run',
          statusText: 'Downloading',
          total: contentLength,
        })
      },
      progress({ contentLength, bytesWritten }) {
        latestTotal = contentLength
        latestDownloaded = bytesWritten
        const seconds = Math.max((Date.now() - startTime) / 1000, 0.5)
        const speed = `${(bytesWritten / 1024 / seconds).toFixed(1)} KB/s`
        void updateDownloadTask(task.id, {
          status: 'run',
          statusText: 'Downloading',
          total: contentLength,
          downloaded: bytesWritten,
          progress: contentLength ? Math.min(1, bytesWritten / contentLength) : 0,
          speed,
        })
      },
    })
    ACTIVE_DOWNLOAD_JOBS.set(task.id, downloadRes.jobId)
    await downloadRes.promise
    ACTIVE_DOWNLOAD_JOBS.delete(task.id)

    const nextTask = {
      ...task,
      metadata: {
        ...task.metadata,
        url,
        ext,
        fileName,
        filePath,
      },
    }
    const isLyricSaved = await saveTaskLyric(nextTask)
    const completedTask = await updateDownloadTask(task.id, {
      isComplate: true,
      status: 'completed',
      statusText: isLyricSaved ? 'Completed' : 'Completed (lyric unavailable)',
      downloaded: latestDownloaded || latestTotal,
      total: latestTotal,
      progress: 1,
      speed: '',
      metadata: nextTask.metadata,
    })
    void importDownloadedMusicToDownloadList(filePath).catch((err: any) => {
      log.warn('import downloaded music failed', filePath, err?.message ?? err)
    })
    toast('下载完成')
    return completedTask
  } catch (err: any) {
    ACTIVE_DOWNLOAD_JOBS.delete(task.id)
    await updateDownloadTask(task.id, {
      status: 'error',
      statusText: err?.message ? `Download failed: ${err.message}` : 'Download failed',
    })
    throw err
  }
}

export const pauseDownloadTask = async(taskId: string) => {
  const jobId = ACTIVE_DOWNLOAD_JOBS.get(taskId)
  if (jobId != null) {
    stopDownload(jobId)
    ACTIVE_DOWNLOAD_JOBS.delete(taskId)
  }
  return updateDownloadTask(taskId, {
    status: 'pause',
    statusText: 'Paused',
    speed: '',
  })
}

export const createAndStartDownloadTask = async(musicInfo: LX.Music.MusicInfoOnline, quality: LX.Quality) => {
  const task = await createDownloadTask(musicInfo, quality)
  return startDownloadTask(task.id)
}
