import { LIST_IDS } from '@/config/constant'


export interface InitState {
  allMusicList: Map<string, LX.Music.MusicInfo[]>
  defaultList: LX.List.MyDefaultListInfo
  loveList: LX.List.MyLoveListInfo
  downloadList: LX.List.MyDownloadListInfo
  localMusicList: LX.List.UserListInfo
  tempList: LX.List.MyTempListInfo
  userList: LX.List.UserListInfo[]
  activeListId: string

  allList: Array<LX.List.MyDefaultListInfo | LX.List.MyLoveListInfo | LX.List.MyDownloadListInfo | LX.List.UserListInfo>

  tempListMeta: {
    id: string
  }

  fetchingListStatus: Record<string, boolean>
}

const state: InitState = {
  allMusicList: new Map(),
  defaultList: {
    id: LIST_IDS.DEFAULT,
    name: '试听列表',
  },
  loveList: {
    id: LIST_IDS.LOVE,
    name: '我的收藏',
  },
  downloadList: {
    id: LIST_IDS.DOWNLOAD,
    name: '已下载',
  },
  localMusicList: {
    id: LIST_IDS.LOCAL_MUSIC,
    name: '本地音乐',
    locationUpdateTime: null,
  },
  tempList: {
    id: LIST_IDS.TEMP,
    name: '临时列表',
    meta: {},
  },
  userList: [],
  activeListId: '',
  allList: [],
  tempListMeta: {
    id: '',
  },
  fetchingListStatus: {},
}

state.allList = [state.defaultList, state.loveList, state.downloadList]


export default state
