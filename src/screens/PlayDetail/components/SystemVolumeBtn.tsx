import { memo, useEffect, useRef, useState } from 'react'
import { ScrollView, TouchableOpacity, View } from 'react-native'
import Popup, { type PopupType } from '@/components/common/Popup'
import Text from '@/components/common/Text'
import { BorderWidths } from '@/theme'
import { useTheme } from '@/store/theme/hook'
import { scaleSizeW } from '@/utils/pixelRatio'
import { createStyle, toast } from '@/utils/tools'
import Slider, { type SliderProps } from '@/components/common/Slider'
import { getSystemVolume, setSystemVolume } from '@/utils/nativeModules/utils'
import { playHaptic } from '@/utils/haptics'

const BTN_SIZES = {
  vertical: {
    width: scaleSizeW(42),
    marginLeft: 5,
    marginBottom: 0,
  },
  horizontal: {
    width: scaleSizeW(54),
    marginLeft: 0,
    marginBottom: 0,
  },
} as const

const clampVolume = (value: number) => Math.max(0, Math.min(1, value))

export default memo(({ direction }: {
  direction: 'vertical' | 'horizontal'
}) => {
  const theme = useTheme()
  const popupRef = useRef<PopupType>(null)
  const [visible, setVisible] = useState(false)
  const [systemVolume, setSystemVolumeState] = useState(0.5)
  const [sliderValue, setSliderValue] = useState(50)
  const [isSliding, setSliding] = useState(false)
  const btnStyle = BTN_SIZES[direction]

  const refreshVolume = () => {
    void getSystemVolume().then(value => {
      const nextValue = clampVolume(value)
      setSystemVolumeState(nextValue)
      setSliderValue(Math.round(nextValue * 100))
    }).catch(() => {})
  }

  useEffect(() => {
    refreshVolume()
  }, [])

  const applyVolume = (value: number) => {
    const nextValue = clampVolume(value)
    setSystemVolumeState(nextValue)
    setSliderValue(Math.round(nextValue * 100))
    void setSystemVolume(nextValue).then(result => {
      const actualVolume = clampVolume(result)
      setSystemVolumeState(actualVolume)
      setSliderValue(Math.round(actualVolume * 100))
    }).catch(() => {
      toast('系统音量调整失败')
      refreshVolume()
    })
  }

  const stepVolume = (delta: number) => {
    playHaptic('selection')
    applyVolume((isSliding ? sliderValue : Math.round(systemVolume * 100)) / 100 + delta)
  }

  const handleOpen = () => {
    refreshVolume()
    if (visible) popupRef.current?.setVisible(true)
    else {
      setVisible(true)
      requestAnimationFrame(() => {
        popupRef.current?.setVisible(true)
      })
    }
  }

  const handleSlidingStart: SliderProps['onSlidingStart'] = () => {
    setSliding(true)
  }

  const handleValueChange: SliderProps['onValueChange'] = value => {
    setSliderValue(Math.round(value))
  }

  const handleSlidingComplete: SliderProps['onSlidingComplete'] = value => {
    setSliding(false)
    playHaptic('drag')
    applyVolume(Math.round(value) / 100)
  }

  const displayValue = isSliding ? sliderValue : Math.round(systemVolume * 100)

  return (
    <>
      <TouchableOpacity
        style={{
          ...styles.btn,
          width: btnStyle.width,
          marginLeft: btnStyle.marginLeft,
          marginBottom: btnStyle.marginBottom,
          borderColor: theme['c-border-background'],
        }}
        activeOpacity={0.7}
        onPress={handleOpen}
      >
        <Text numberOfLines={1} size={direction == 'vertical' ? 11 : 12} color={theme['c-font-label']}>音量</Text>
      </TouchableOpacity>
      {visible ? (
        <Popup ref={popupRef} title="系统音量">
          <ScrollView style={styles.popup}>
            <View onStartShouldSetResponder={() => true}>
              <View style={{ ...styles.row, borderBottomColor: theme['c-border-background'] }}>
                <Text style={styles.rowLabel}>当前音量</Text>
                <Text color={theme['c-font-label']}>{`${displayValue}%`}</Text>
              </View>
              <View style={styles.volumeBtnRow}>
                <TouchableOpacity style={styles.volumeBtn} onPress={() => { stepVolume(-0.08) }}>
                  <Text color="#f6f6f6" size={13}>-</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.volumeBtn} onPress={() => { applyVolume(0.5); playHaptic('selection') }}>
                  <Text color="#f6f6f6" size={13}>50%</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.volumeBtn} onPress={() => { stepVolume(0.08) }}>
                  <Text color="#f6f6f6" size={13}>+</Text>
                </TouchableOpacity>
              </View>
              <Slider
                minimumValue={0}
                maximumValue={100}
                onSlidingStart={handleSlidingStart}
                onValueChange={handleValueChange}
                onSlidingComplete={handleSlidingComplete}
                step={1}
                value={displayValue}
              />
            </View>
          </ScrollView>
        </Popup>
      ) : null}
    </>
  )
})

const styles = createStyle({
  btn: {
    minHeight: scaleSizeW(28),
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: BorderWidths.normal,
    borderRadius: 14,
    paddingHorizontal: 6,
    shadowOpacity: 1,
    textShadowRadius: 1,
  },
  popup: {
    flexShrink: 1,
    flexGrow: 0,
    paddingLeft: 15,
    paddingRight: 15,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 10,
    borderBottomWidth: BorderWidths.normal,
  },
  rowLabel: {
    flex: 1,
  },
  volumeBtnRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    marginBottom: 8,
  },
  volumeBtn: {
    flex: 1,
    minHeight: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
})
