import { memo, useEffect, useRef, useState } from 'react'
import { ScrollView, TouchableOpacity, View } from 'react-native'
import Popup, { type PopupType } from '@/components/common/Popup'
import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import { BorderWidths } from '@/theme'
import { useTheme } from '@/store/theme/hook'
import { usePlayMusicInfo } from '@/store/player/hook'
import { scaleSizeW } from '@/utils/pixelRatio'
import { createStyle, toast } from '@/utils/tools'
import { getCurrentKtvVariant, getKtvOptions, switchKtvVariant, type KtvOption } from '@/core/ktv'

const BTN_SIZES = {
  vertical: {
    width: scaleSizeW(36),
    icon: 24,
    marginLeft: 5,
  },
  horizontal: {
    width: scaleSizeW(32),
    icon: 22,
    marginBottom: 5,
  },
} as const

const getBtnOffsets = (direction: 'vertical' | 'horizontal') => {
  return direction == 'vertical'
    ? {
        marginLeft: BTN_SIZES.vertical.marginLeft,
        marginBottom: 0,
      }
    : {
        marginLeft: 0,
        marginBottom: BTN_SIZES.horizontal.marginBottom,
      }
}

const KtvOptionItem = ({ option, active, onPress }: {
  option: KtvOption
  active: boolean
  onPress: (option: KtvOption) => void
}) => {
  const theme = useTheme()
  return (
    <TouchableOpacity style={{ ...styles.listItem, borderBottomColor: theme['c-border-background'] }} onPress={() => { onPress(option) }}>
      <Text style={styles.listLabel}>{option.label}</Text>
      <Icon name={active ? 'checkbox-marked' : 'checkbox-blank-outline'} color={theme['c-font-label']} size={16} />
    </TouchableOpacity>
  )
}

export default memo(({ direction }: {
  direction: 'vertical' | 'horizontal'
}) => {
  const theme = useTheme()
  const popupRef = useRef<PopupType>(null)
  const playMusicInfo = usePlayMusicInfo()
  const [visible, setVisible] = useState(false)
  const [options, setOptions] = useState<KtvOption[]>([])

  const musicInfo = playMusicInfo.musicInfo && !('progress' in playMusicInfo.musicInfo) && playMusicInfo.musicInfo.source == 'local' && playMusicInfo.musicInfo.meta?.filePath
    ? playMusicInfo.musicInfo
    : null
  const currentVariant = musicInfo ? getCurrentKtvVariant(musicInfo, options) : null

  useEffect(() => {
    let canceled = false
    if (!musicInfo) {
      setOptions([])
      return
    }
    void getKtvOptions(musicInfo).then(result => {
      if (canceled) return
      setOptions(result?.options ?? [])
    }).catch(() => {
      if (canceled) return
      setOptions([])
    })
    return () => {
      canceled = true
    }
  }, [musicInfo])

  if (!musicInfo) return null

  const btnStyle = BTN_SIZES[direction]
  const btnOffsets = getBtnOffsets(direction)

  const handleOpen = () => {
    if (options.length < 2) {
      toast('当前歌曲没有可切换的 KTV 音轨')
      return
    }
    if (visible) popupRef.current?.setVisible(true)
    else {
      setVisible(true)
      requestAnimationFrame(() => {
        popupRef.current?.setVisible(true)
      })
    }
  }

  const handleSelect = (option: KtvOption) => {
    popupRef.current?.setVisible(false)
    void switchKtvVariant(option).catch(err => {
      toast((err as Error).message || 'KTV 切换失败')
    })
  }

  return (
    <>
      <TouchableOpacity
        style={{
          ...styles.btn,
          width: btnStyle.width,
          height: btnStyle.width,
          marginLeft: btnOffsets.marginLeft,
          marginBottom: btnOffsets.marginBottom,
        }}
        activeOpacity={0.5}
        onPress={handleOpen}
      >
        <Icon name="album" color={theme['c-font-label']} size={btnStyle.icon} />
      </TouchableOpacity>
      {
        visible
          ? (
            <Popup ref={popupRef} title="KTV 音轨">
              <ScrollView style={styles.list}>
                <View onStartShouldSetResponder={() => true}>
                  {options.map(option => (
                    <KtvOptionItem
                      key={option.value}
                      option={option}
                      active={option.variant == currentVariant && option.filePath == musicInfo.meta.filePath}
                      onPress={handleSelect}
                    />
                  ))}
                </View>
              </ScrollView>
            </Popup>
            )
          : null
      }
    </>
  )
})

const styles = createStyle({
  btn: {
    justifyContent: 'center',
    alignItems: 'center',
    shadowOpacity: 1,
    textShadowRadius: 1,
  },
  list: {
    flexShrink: 1,
    flexGrow: 0,
    paddingLeft: 15,
    paddingRight: 15,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 10,
    borderBottomWidth: BorderWidths.normal,
  },
  listLabel: {
    flex: 1,
  },
})
