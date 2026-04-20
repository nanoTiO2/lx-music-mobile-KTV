import { init as musicSdkInit } from '@/utils/musicSdk'
import { getUserLists, setUserList } from '@/core/list'
import { setNavActiveId } from '../common'
import { getViewPrevState } from '@/utils/data'
import { bootLog } from '@/utils/bootLog'
import { getDislikeInfo, setDislikeInfo } from '@/core/dislikeList'
import { unlink } from '@/utils/fs'
import { TEMP_FILE_PATH } from '@/utils/tools'
import { syncDownloadedList } from '@/core/download'

export default async(appSetting: LX.AppSetting) => {
  void appSetting
  void musicSdkInit()
  bootLog('User list init...')
  setUserList(await getUserLists())
  setDislikeInfo(await getDislikeInfo())
  bootLog('User list inited.')
  await syncDownloadedList()
  bootLog('Download list inited.')
  setNavActiveId((await getViewPrevState()).id)
  void unlink(TEMP_FILE_PATH)
}
