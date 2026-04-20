import { checkStoragePermissions, initSetting, updateSetting } from '@/core/common'
import registerPlaybackService from '@/plugins/player/service'
import initTheme from './theme'
import initI18n from './i18n'
import initUserApi from './userApi'
import initPlayer from './player'
import dataInit from './dataInit'
import initSync from './sync'
import initCommonState from './common'
import { initDeeplink } from './deeplink'
import { setApiSource } from '@/core/apiSource'
import commonActions from '@/store/common/action'
import settingState from '@/store/setting/state'
import { checkUpdate } from '@/core/version'
import { bootLog } from '@/utils/bootLog'
import { cheatTip } from '@/utils/tools'
import { ensureDownloadSaveDir, getDefaultDownloadSaveDir, setDownloadSaveDir } from '@/core/download'

let isFirstPush = true
const ensureStorageAndDownloadDir = async() => {
  const isGranted = await checkStoragePermissions()
  if (!isGranted) return

  const downloadSaveDir = settingState.setting['download.useCustomDir'] && settingState.setting['download.saveDir']
    ? settingState.setting['download.saveDir']
    : getDefaultDownloadSaveDir()

  if (!settingState.setting['download.useCustomDir'] || !settingState.setting['download.saveDir']) {
    setDownloadSaveDir(downloadSaveDir)
  }

  await ensureDownloadSaveDir(downloadSaveDir)
}

const handlePushedHomeScreen = async() => {
  await cheatTip()
  if (!isFirstPush) return
  isFirstPush = false
  void checkUpdate()
  void initDeeplink()
  void ensureStorageAndDownloadDir().catch((err: any) => {
    console.warn('init storage and download dir failed', err?.message ?? err)
  })
}

let isInited = false
export default async() => {
  if (isInited) return handlePushedHomeScreen
  bootLog('Initing...')
  commonActions.setFontSize(global.lx.fontSize)
  bootLog('Font size changed.')
  const setting = await initSetting()
  bootLog('Setting inited.')
  if (!setting['common.isAgreePact']) {
    setting['common.isAgreePact'] = true
    updateSetting({ 'common.isAgreePact': true })
  }
  // console.log(setting)

  await initTheme(setting)
  bootLog('Theme inited.')
  await initI18n(setting)
  bootLog('I18n inited.')

  await initUserApi(setting)
  bootLog('User Api inited.')

  setApiSource(setting['common.apiSource'])
  bootLog('Api inited.')

  registerPlaybackService()
  bootLog('Playback Service Registered.')
  await initPlayer(setting)
  bootLog('Player inited.')
  await dataInit(setting)
  bootLog('Data inited.')
  await initCommonState(setting)
  bootLog('Common State inited.')

  void initSync(setting)
  bootLog('Sync inited.')

  // syncSetting()

  isInited ||= true

  return handlePushedHomeScreen
}
