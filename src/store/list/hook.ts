import { useEffect, useState } from 'react'
import state, { type InitState } from './state'
import { getListMusics } from '@/core/list'
import { LIST_IDS } from '@/config/constant'

const syncBuiltInListNames = (lists: typeof state.allList) => {
  for (const list of lists) {
    switch (list.id) {
      case LIST_IDS.DEFAULT:
        list.name = global.i18n.t('list_name_default')
        break
      case LIST_IDS.LOVE:
        list.name = global.i18n.t('list_name_love')
        break
      case LIST_IDS.DOWNLOAD:
        list.name = global.i18n.t('list_name_download')
        break
      case LIST_IDS.LOCAL_MUSIC:
        list.name = global.i18n.t('list_name_local_music')
        break
      default:
        break
    }
  }
  return lists
}

export const useMyList = () => {
  const [lists, setList] = useState(syncBuiltInListNames(state.allList))

  useEffect(() => {
    const handleConfigUpdate = (keys: Array<keyof LX.AppSetting>) => {
      if (!keys.includes('common.langId')) return
      setList((currentLists) => [...syncBuiltInListNames(currentLists)])
    }
    const handleListUpdate = (nextLists: typeof state.allList) => {
      setList([...syncBuiltInListNames(nextLists)])
    }
    global.state_event.on('mylistUpdated', handleListUpdate)
    global.state_event.on('configUpdated', handleConfigUpdate)
    return () => {
      global.state_event.off('mylistUpdated', handleListUpdate)
      global.state_event.off('configUpdated', handleConfigUpdate)
    }
  }, [])

  return lists
}

export const useActiveListId = () => {
  const [id, setId] = useState(state.activeListId)

  useEffect(() => {
    global.state_event.on('mylistToggled', setId)
    return () => {
      global.state_event.off('mylistToggled', setId)
    }
  }, [])

  return id
}


export const useMusicList = () => {
  const [list, setList] = useState<LX.List.ListMusics>([])

  useEffect(() => {
    const handleToggle = (activeListId: string) => {
      void getListMusics(activeListId).then((nextList) => {
        setList([...nextList])
      })
    }
    const handleChange = (ids: string[]) => {
      if (!ids.includes(state.activeListId)) return
      void getListMusics(state.activeListId).then((nextList) => {
        setList([...nextList])
      })
    }
    global.state_event.on('mylistToggled', handleToggle)
    global.app_event.on('myListMusicUpdate', handleChange)

    handleToggle(state.activeListId)

    return () => {
      global.state_event.off('mylistToggled', handleToggle)
      global.app_event.off('myListMusicUpdate', handleChange)
    }
  }, [])

  return list
}

export const useMusicExistsList = (list: LX.List.MyListInfo, musicInfo: LX.Music.MusicInfo) => {
  const [isExists, setExists] = useState(false)

  useEffect(() => {
    void getListMusics(list.id).then((musics) => {
      setExists(musics.some(s => s.id == musicInfo.id))
    })
  }, [list.id, musicInfo.id])

  return isExists
}

export const useListFetching = (listId: string) => {
  const [fetching, setFetching] = useState(!!state.fetchingListStatus[listId])

  useEffect(() => {
    let prevStatus = state.fetchingListStatus[listId]
    const handleUpdate = (status: InitState['fetchingListStatus']) => {
      let currentStatus = status[listId]
      if (currentStatus == null || prevStatus == status[listId]) return
      setFetching(prevStatus = currentStatus)
    }
    global.state_event.on('fetchingListStatusUpdated', handleUpdate)
    return () => {
      global.state_event.off('fetchingListStatusUpdated', handleUpdate)
    }
  }, [listId])

  return fetching
}
