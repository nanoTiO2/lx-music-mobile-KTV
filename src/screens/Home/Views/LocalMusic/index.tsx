import { useEffect, useMemo, useRef, useState } from 'react'
import { ScrollView, TouchableOpacity, View } from 'react-native'

import ChoosePath, { type ChoosePathType } from '@/components/common/ChoosePath'
import Button from '../Setting/components/Button'
import MusicList from '../Mylist/MusicList'
import Text from '@/components/common/Text'
import { setActiveList } from '@/core/list'
import { updateSetting } from '@/core/common'
import { LIST_IDS } from '@/config/constant'
import { useI18n } from '@/lang'
import { handleImportMediaFiles } from '../Mylist/MyList/listAction'
import { useSettingValue } from '@/store/setting/hook'
import { createStyle, toast } from '@/utils/tools'
import { scanAudioFolderGroups, type AudioFolderGroup } from '@/utils/localMediaMetadata'
import { BorderWidths } from '@/theme'
import { useTheme } from '@/store/theme/hook'
import playerState from '@/store/player/state'
import { getListMusicSync, setMusicList } from '@/utils/listManage'
import { setPlayListId, setPlayMusicInfo } from '@/core/player/playInfo'

const normalizeDirPaths = (paths: string[]) => [...new Set(paths.map(path => path.trim()).filter(Boolean))]
const getFolderGroupLabel = (group: AudioFolderGroup) => {
  if (!group.relativePath) return `${group.rootName} (${group.files.length})`
  return `${group.rootName} / ${group.relativePath} (${group.files.length})`
}

let localMusicScannedDirsSignatureCache = ''
let localMusicScannedGroupsCache: AudioFolderGroup[] = []
let localMusicImportedFolderSignatureCache = ''
const LOCAL_PLAYBACK_SNAPSHOT_ID = '__local_playback_snapshot__'

export default () => {
  const t = useI18n()
  const theme = useTheme()
  const choosePathRef = useRef<ChoosePathType>(null)
  const selectedFolderPathRef = useRef('')
  const [visible, setVisible] = useState(false)
  const [folderGroups, setFolderGroups] = useState<AudioFolderGroup[]>([])
  const [selectedFolderPath, setSelectedFolderPath] = useState('')
  const [isScanning, setIsScanning] = useState(false)
  const [isFolderPanelExpanded, setIsFolderPanelExpanded] = useState(false)
  const importMusicDirs = useSettingValue('list.importMusicDirs')
  const importMusicDir = useSettingValue('list.importMusicDir')
  const localImportDirs = useMemo(() => normalizeDirPaths(
    importMusicDirs.length ? importMusicDirs : (importMusicDir ? [importMusicDir] : []),
  ), [importMusicDir, importMusicDirs])
  const localImportDirsSignature = useMemo(() => localImportDirs.join('\n'), [localImportDirs])
  const chooseInitialDir = importMusicDir || (localImportDirs[localImportDirs.length - 1] ?? '')
  const localMusicList = useMemo<LX.List.UserListInfo>(() => ({
    id: LIST_IDS.LOCAL_MUSIC,
    name: t('list_name_local_music'),
    locationUpdateTime: null,
  }), [t])

  useEffect(() => {
    setActiveList(LIST_IDS.LOCAL_MUSIC)
  }, [])

  useEffect(() => {
    selectedFolderPathRef.current = selectedFolderPath
  }, [selectedFolderPath])

  useEffect(() => {
    if (!importMusicDirs.length && importMusicDir) {
      updateSetting({
        'list.importMusicDir': importMusicDir,
        'list.importMusicDirs': [importMusicDir],
      })
    }
  }, [importMusicDir, importMusicDirs])

  const syncImportDirs = (dirs: string[], activePath?: string) => {
    const nextDirs = normalizeDirPaths(dirs)
    updateSetting({
      'list.importMusicDir': activePath ?? nextDirs[nextDirs.length - 1] ?? '',
      'list.importMusicDirs': nextDirs,
    })
  }

  const freezeCurrentLocalPlaybackContext = async(nextGroup: AudioFolderGroup | undefined) => {
    const currentPlayMusic = playerState.playMusicInfo.musicInfo
    if (
      playerState.playInfo.playerListId != LIST_IDS.LOCAL_MUSIC ||
      playerState.playMusicInfo.listId != LIST_IDS.LOCAL_MUSIC ||
      !currentPlayMusic ||
      'progress' in currentPlayMusic ||
      currentPlayMusic.source != 'local'
    ) return
    const currentFilePath = currentPlayMusic.meta.filePath
    if (!currentFilePath) return
    if (nextGroup?.files.some(file => file.path == currentFilePath)) return
    const currentLocalList = getListMusicSync(LIST_IDS.LOCAL_MUSIC)
    if (!currentLocalList.length) return
    setMusicList(LOCAL_PLAYBACK_SNAPSHOT_ID, [...currentLocalList])
    setPlayListId(LOCAL_PLAYBACK_SNAPSHOT_ID)
    setPlayMusicInfo(LIST_IDS.LOCAL_MUSIC, currentPlayMusic)
  }

  const applyFolderSelection = async(groups: AudioFolderGroup[], preferredPath?: string) => {
    const nextGroup = groups.find(group => group.dirPath == preferredPath) ?? groups[0]
    await freezeCurrentLocalPlaybackContext(nextGroup)
    setSelectedFolderPath(nextGroup?.dirPath ?? '')
    setActiveList(LIST_IDS.LOCAL_MUSIC)
    const importSignature = `${nextGroup?.dirPath ?? ''}__${nextGroup?.files.length ?? 0}`
    if (localMusicImportedFolderSignatureCache == importSignature) return
    localMusicImportedFolderSignatureCache = importSignature
    await handleImportMediaFiles(localMusicList, nextGroup?.files ?? [])
  }

  const scanImportedFolders = async(paths: string[], preferredPath?: string) => {
    if (!paths.length) {
      setFolderGroups([])
      setSelectedFolderPath('')
      await handleImportMediaFiles(localMusicList, [])
      return
    }
    setIsScanning(true)
    try {
      const groups = (await Promise.all(paths.map(async path => scanAudioFolderGroups(path, true).catch(() => []))))
        .flat()
        .sort((a, b) => {
          const pathCompare = a.rootDirPath.localeCompare(b.rootDirPath)
          if (pathCompare) return pathCompare
          return a.relativePath.localeCompare(b.relativePath)
        })
      setFolderGroups(groups)
      await applyFolderSelection(groups, preferredPath ?? selectedFolderPath)
    } finally {
      setIsScanning(false)
    }
  }

  useEffect(() => {
    void (async() => {
      if (!localImportDirs.length) {
        setFolderGroups([])
        setSelectedFolderPath('')
        localMusicScannedDirsSignatureCache = ''
        localMusicScannedGroupsCache = []
        localMusicImportedFolderSignatureCache = ''
        await handleImportMediaFiles(localMusicList, [])
        return
      }
      if (localMusicScannedDirsSignatureCache == localImportDirsSignature && localMusicScannedGroupsCache.length) {
        const groups = localMusicScannedGroupsCache
        setFolderGroups(groups)
        await applyFolderSelection(groups, selectedFolderPathRef.current)
        return
      }
      setIsScanning(true)
      try {
        const groups = (await Promise.all(localImportDirs.map(async path => scanAudioFolderGroups(path, true).catch(() => []))))
          .flat()
          .sort((a, b) => {
            const pathCompare = a.rootDirPath.localeCompare(b.rootDirPath)
            if (pathCompare) return pathCompare
            return a.relativePath.localeCompare(b.relativePath)
          })
        localMusicScannedDirsSignatureCache = localImportDirsSignature
        localMusicScannedGroupsCache = groups
        setFolderGroups(groups)
        await applyFolderSelection(groups, selectedFolderPathRef.current)
      } finally {
        setIsScanning(false)
      }
    })()
  }, [localImportDirsSignature, localMusicList])

  const handleSelectFolder = async(group: AudioFolderGroup) => {
    await applyFolderSelection(folderGroups, group.dirPath)
  }

  const handleAddFolder = (path: string) => {
    const nextDirs = normalizeDirPaths([...localImportDirs, path])
    localMusicScannedDirsSignatureCache = ''
    localMusicImportedFolderSignatureCache = ''
    syncImportDirs(nextDirs, path)
    toast(t('local_music_scan_start'))
  }

  const handleRemoveFolder = (path: string) => {
    const nextDirs = localImportDirs.filter(dir => dir != path)
    localMusicScannedDirsSignatureCache = ''
    localMusicImportedFolderSignatureCache = ''
    syncImportDirs(nextDirs)
  }

  const handleChooseFolder = () => {
    if (visible) {
      choosePathRef.current?.show({
        title: t('local_music_add_folder_recursive'),
        dirOnly: true,
        isPersist: true,
        initialDir: chooseInitialDir,
      })
      return
    }
    setVisible(true)
    requestAnimationFrame(() => {
      choosePathRef.current?.show({
        title: t('local_music_add_folder_recursive'),
        dirOnly: true,
        isPersist: true,
        initialDir: chooseInitialDir,
      })
    })
  }

  const handleRescan = () => {
    if (!localImportDirs.length) {
      handleChooseFolder()
      return
    }
    toast(t('local_music_scan_start'))
    void scanImportedFolders(localImportDirs)
  }

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <Button onPress={handleChooseFolder}>{t('local_music_add_folder_recursive')}</Button>
        <Button onPress={handleRescan} disabled={!localImportDirs.length}>{t('local_music_rescan')}</Button>
      </View>
      <View style={{ ...styles.panelHeader, borderBottomColor: theme['c-border-background'] }}>
        <View style={styles.panelHeaderTextWrap}>
          <Text selectable numberOfLines={1} style={styles.pathText}>
            {localImportDirs.length
              ? `${t('local_music_imported_root_count', { total: localImportDirs.length })} / 分组 ${folderGroups.length}`
              : t('local_music_empty_folder')}
          </Text>
        </View>
        <TouchableOpacity style={styles.panelToggleBtn} onPress={() => { setIsFolderPanelExpanded(value => !value) }}>
          <Text style={{ ...styles.panelToggleText, color: theme['c-primary'] }}>{isFolderPanelExpanded ? '收起目录' : '展开目录'}</Text>
        </TouchableOpacity>
      </View>
      {
        isFolderPanelExpanded
          ? (
            <>
              <ScrollView style={styles.importedList} contentContainerStyle={styles.importedListContent}>
                {localImportDirs.map(path => {
                  const active = path == importMusicDir
                  return (
                    <View
                      key={path}
                      style={{
                        ...styles.importedRow,
                        borderBottomColor: theme['c-border-background'],
                        backgroundColor: active ? theme['c-primary-background-active'] : 'transparent',
                      }}
                    >
                      <Text selectable numberOfLines={1} style={styles.importedRowText}>{path}</Text>
                      <TouchableOpacity style={styles.removeBtn} onPress={() => { handleRemoveFolder(path) }}>
                        <Text style={{ ...styles.removeBtnText, color: theme['c-primary'] }}>{t('local_music_remove_folder')}</Text>
                      </TouchableOpacity>
                    </View>
                  )
                })}
                {!localImportDirs.length ? <Text style={styles.emptyHint}>{t('local_music_no_imported_folder')}</Text> : null}
              </ScrollView>
              <ScrollView style={styles.folderList} contentContainerStyle={styles.folderListContent}>
                {folderGroups.map(group => {
                  const active = group.dirPath == selectedFolderPath
                  const label = getFolderGroupLabel(group)
                  return (
                    <TouchableOpacity
                      key={group.dirPath}
                      style={{
                        ...styles.folderRow,
                        borderBottomColor: theme['c-border-background'],
                        backgroundColor: active ? theme['c-primary-background-active'] : 'transparent',
                      }}
                      onPress={() => { void handleSelectFolder(group) }}
                    >
                      <Text numberOfLines={1} style={{ ...styles.folderRowText, color: active ? theme['c-primary'] : theme['c-font'] }}>{label}</Text>
                    </TouchableOpacity>
                  )
                })}
                {!folderGroups.length ? <Text style={styles.emptyHint}>{isScanning ? t('local_music_scanning') : t('local_music_folder_empty')}</Text> : null}
              </ScrollView>
            </>
            )
          : null
      }
      <View style={styles.listWrap}>
        <MusicList />
      </View>
      {visible ? <ChoosePath ref={choosePathRef} onConfirm={handleAddFolder} /> : null}
    </View>
  )
}

const styles = createStyle({
  container: {
    flex: 1,
  },
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingTop: 10,
    paddingLeft: 15,
    paddingRight: 15,
  },
  pathText: {
    paddingTop: 4,
    paddingBottom: 4,
    opacity: 0.85,
    fontSize: 12,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 15,
    paddingRight: 15,
    paddingBottom: 6,
    borderBottomWidth: BorderWidths.normal,
  },
  panelHeaderTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  panelToggleBtn: {
    marginLeft: 12,
    paddingTop: 4,
    paddingBottom: 4,
  },
  panelToggleText: {
    fontSize: 12,
  },
  importedList: {
    maxHeight: 84,
  },
  importedListContent: {
    paddingLeft: 15,
    paddingRight: 15,
    paddingBottom: 4,
  },
  importedRow: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: BorderWidths.normal,
  },
  importedRowText: {
    flex: 1,
    fontSize: 12,
    opacity: 0.9,
  },
  removeBtn: {
    marginLeft: 8,
    paddingTop: 4,
    paddingBottom: 4,
    paddingLeft: 6,
    paddingRight: 6,
  },
  removeBtnText: {
    fontSize: 11,
  },
  folderList: {
    maxHeight: 96,
  },
  folderListContent: {
    paddingLeft: 15,
    paddingRight: 15,
    paddingBottom: 4,
  },
  folderRow: {
    minHeight: 28,
    justifyContent: 'center',
    paddingTop: 5,
    paddingBottom: 5,
    borderBottomWidth: BorderWidths.normal,
  },
  folderRowText: {
    fontSize: 12,
  },
  emptyHint: {
    paddingTop: 4,
    opacity: 0.7,
    lineHeight: 20,
  },
  listWrap: {
    flex: 1,
  },
})
