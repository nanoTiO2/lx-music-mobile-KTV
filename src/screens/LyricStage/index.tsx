import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { AppState, FlatList, type FlatListProps, Platform, StatusBar as RNStatusBar, TouchableOpacity, View, Vibration, useWindowDimensions, type GestureResponderEvent, ScrollView } from 'react-native'
import Text from '@/components/common/Text'
import { AnimatedColorText } from '@/components/common/Text'
import Popup, { type PopupType } from '@/components/common/Popup'
import Slider from '@/components/common/Slider'
import PageContent from '@/components/PageContent'
import { pop } from '@/navigation/utils'
import { useLrcPlay, useLrcSet, type Line } from '@/plugins/lyric'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import { createStyle, toast } from '@/utils/tools'
import { setSpText } from '@/utils/pixelRatio'
import { screenkeepAwake, screenUnkeepAwake, setImmersiveMode, setScreenOrientation } from '@/utils/nativeModules/utils'
import { Icon } from '@/components/common/Icon'
import { useIsPlay, usePlayMusicInfo, useProgress } from '@/store/player/hook'
import { useTheme } from '@/store/theme/hook'
import { playNext, playPrev, togglePlay } from '@/core/player/player'
import { useBufferProgress, setPlaybackRate as setPlayerPlaybackRate, setPitch as setPlayerPitch, updateMetaData } from '@/plugins/player'
import { setPlaybackRate as setLyricPlaybackRate } from '@/core/lyric'
import { getCurrentKtvVariant, getKtvOptions, switchKtvVariant, type KtvOption } from '@/core/ktv'
import { formatPlayTime2 } from '@/utils/common'
import playerState from '@/store/player/state'
import {
  LYRIC_STAGE_COLOR_THEMES,
  LYRIC_STAGE_FONT_OPTIONS,
  LYRIC_STAGE_MARQUEE_THEME_ORDER,
  LYRIC_STAGE_MIRROR_LABELS,
  LYRIC_STAGE_MIRROR_ORDER,
  LYRIC_STAGE_MODE_LABELS,
  LYRIC_STAGE_MODE_ORDER,
  LYRIC_STAGE_ROTATE_LABELS,
  LYRIC_STAGE_ROTATE_ORDER,
} from '@/shared/lyricStagePresets'

type FlatListType = FlatListProps<Line>
type StageMode = LX.AppSetting['lyricStage.mode']
type MirrorMode = LX.AppSetting['lyricStage.mirror']
type ColorTheme = LX.AppSetting['lyricStage.colorTheme']

const FONT_OPTIONS = LYRIC_STAGE_FONT_OPTIONS
const COLOR_THEMES = LYRIC_STAGE_COLOR_THEMES as Record<ColorTheme, (typeof LYRIC_STAGE_COLOR_THEMES)[keyof typeof LYRIC_STAGE_COLOR_THEMES]>
const MODE_LABELS = LYRIC_STAGE_MODE_LABELS as Record<StageMode, string>
const MIRROR_LABELS = LYRIC_STAGE_MIRROR_LABELS as Record<MirrorMode, string>
const MODE_ORDER = [...LYRIC_STAGE_MODE_ORDER] as StageMode[]
const MIRROR_ORDER = [...LYRIC_STAGE_MIRROR_ORDER] as MirrorMode[]
const ROTATE_ORDER = LYRIC_STAGE_ROTATE_ORDER
type RotateMode = typeof ROTATE_ORDER[number]
const ROTATE_LABELS = LYRIC_STAGE_ROTATE_LABELS as Record<RotateMode, string>
const MARQUEE_THEME_ORDER = [...LYRIC_STAGE_MARQUEE_THEME_ORDER] as ColorTheme[]

const BUTTON_FEEDBACK_MS = 12
const LONG_PRESS_MS = 320
const LONG_PRESS_MOVE_THRESHOLD = 14
const RADIAL_MENU_IDLE_MS = 1000
const POINTER_ACTIVITY_DELAY_MS = 1000
const RADIAL_MENU_SIZE = 172
const RADIAL_ACTION_SIZE = 48
const RADIAL_PANEL_WIDTH = 248
const RADIAL_PANEL_HEIGHT = 146

type RadialMenuState = {
  visible: boolean
  x: number
  y: number
}

const getTransformStyle = (mirror: MirrorMode) => {
  switch (mirror) {
    case 'horizontal':
      return [{ scaleX: -1 }]
    case 'vertical':
      return [{ scaleY: -1 }]
    default:
      return undefined
  }
}

const getViewPosition = (mode: StageMode) => {
  switch (mode) {
    case 'teleprompter':
      return 0.16
    case 'singleLine':
    case 'doubleLine':
    case 'threeLine':
      return 0.5
    case 'full':
    default:
      return 0.38
  }
}

const getFocusLineIndexes = (mode: StageMode, activeIndex: number) => {
  switch (mode) {
    case 'singleLine':
      return [activeIndex]
    case 'doubleLine':
      return [activeIndex, activeIndex + 1]
    case 'threeLine':
      return [activeIndex - 1, activeIndex, activeIndex + 1]
    default:
      return []
  }
}

const formatStageText = (text: string) => text.replace(/^\s*[a-z]/, letter => letter.toUpperCase())

const StageLine = memo(({ line, active, fontScale, fontFamily, projector, reduceMotion, lineHeightScale, themeColors, mode, textStroke }: {
  line: Line
  active: boolean
  fontScale: number
  fontFamily: string
  projector: boolean
  reduceMotion: boolean
  lineHeightScale: number
  themeColors: typeof COLOR_THEMES[ColorTheme]
  mode: StageMode
  textStroke: boolean
}) => {
  const size = (projector ? 38 : 32) * fontScale
  const inactiveSize = size * 0.88
  const fontSize = active ? size : inactiveSize
  const lineHeight = setSpText(fontSize) * lineHeightScale
  const baseStyle = fontFamily ? { fontFamily } : null
  const TextComp = reduceMotion && !active ? Text : AnimatedColorText
  const isTeleprompter = mode == 'teleprompter'
  const isFullMode = mode == 'full'
  const shadowColor = textStroke
    ? projector
      ? (active ? 'rgba(0,0,0,0.98)' : 'rgba(0,0,0,0.92)')
      : (active ? 'rgba(255,255,255,0.96)' : 'rgba(255,255,255,0.86)')
    : 'transparent'

  return (
    <View
      style={[
        styles.lineWrap,
        projector ? styles.lineWrapProjector : null,
        isTeleprompter ? styles.lineWrapTeleprompter : null,
        isFullMode ? styles.lineWrapFull : null,
        active ? styles.lineWrapActive : null,
        projector && active ? styles.lineWrapProjectorActive : null,
      ]}
    >
      <TextComp
        style={[
          styles.lineText,
          isTeleprompter ? styles.lineTextTeleprompter : null,
          isFullMode ? styles.lineTextFull : null,
          baseStyle,
          {
            lineHeight,
            letterSpacing: active ? 0.45 : 0.15,
            opacity: active ? 1 : projector ? 0.78 : 0.48,
            textTransform: 'capitalize',
            textAlign: 'center',
            textShadowColor: shadowColor,
            textShadowRadius: textStroke ? (projector ? (active ? 6 : 4.2) : (active ? 3.6 : 2.8)) : 0,
          },
        ]}
        size={fontSize}
        color={active ? themeColors.active : themeColors.inactive}
        numberOfLines={3}
      >
        {formatStageText(line.text || '...')}
      </TextComp>
      {
        active && line.extendedLyrics.map((item, index) => (
          <TextComp
            key={`${index}_${item}`}
            style={[
              styles.extendedText,
              isTeleprompter ? styles.extendedTextTeleprompter : null,
              baseStyle,
              {
                opacity: 0.82,
                lineHeight: setSpText(Math.max(18, size * 0.48)),
                textAlign: 'center',
                textShadowColor: textStroke ? (projector ? 'rgba(0,0,0,0.92)' : 'rgba(255,255,255,0.84)') : 'transparent',
                textShadowRadius: textStroke ? (projector ? 3.2 : 2.2) : 0,
              },
            ]}
            size={Math.max(18, size * 0.48)}
            color={projector ? themeColors.active : themeColors.sub}
            numberOfLines={2}
          >
            {formatStageText(item)}
          </TextComp>
        ))
      }
    </View>
  )
})

const FocusLineMode = ({ lines, activeIndex, fontScale, fontFamily, projector, reduceMotion, lineHeightScale, themeColors, mode, textStroke, onTouchStart, onTouchMove, onTouchEnd }: {
  lines: Line[]
  activeIndex: number
  fontScale: number
  fontFamily: string
  projector: boolean
  reduceMotion: boolean
  lineHeightScale: number
  themeColors: typeof COLOR_THEMES[ColorTheme]
  mode: StageMode
  textStroke: boolean
  onTouchStart: (event: GestureResponderEvent) => void
  onTouchMove: (event: GestureResponderEvent) => void
  onTouchEnd: () => void
}) => {
  const indexes = getFocusLineIndexes(mode, activeIndex)
  return (
    <View
      style={styles.threeLineContainer}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
    >
      {indexes.map(index => {
        const line = lines[index]
        if (!line) return <View key={index} style={styles.threeLineSpacer} />
        const isActive = index == activeIndex
        return (
          <StageLine
            key={`${index}_${line.text}`}
            line={line}
            active={isActive}
            fontScale={fontScale * (isActive ? 1.08 : mode == 'singleLine' ? 1 : 0.94)}
            fontFamily={fontFamily}
            projector={projector}
            reduceMotion={reduceMotion}
            lineHeightScale={lineHeightScale}
            themeColors={themeColors}
            mode={mode}
            textStroke={textStroke}
          />
        )
      })}
    </View>
  )
}

export default memo(({ componentId }: { componentId: string }) => {
  const theme = useTheme()
  const lyricLines = useLrcSet()
  const { line } = useLrcPlay()
  const isPlay = useIsPlay()
  const playMusicInfo = usePlayMusicInfo()
  const { nowPlayTime, maxPlayTime } = useProgress()
  const bufferedProgress = useBufferProgress()
  const mode = useSettingValue('lyricStage.mode')
  const mirror = useSettingValue('lyricStage.mirror')
  const fontScale = useSettingValue('lyricStage.fontScale')
  const fontFamily = useSettingValue('lyricStage.fontFamily')
  const colorTheme = useSettingValue('lyricStage.colorTheme')
  const lineHeightScale = useSettingValue('lyricStage.lineHeightScale')
  const projector = useSettingValue('lyricStage.isProjectorMode')
  const usePureBlackBackground = useSettingValue('lyricStage.usePureBlackBackground')
  const reduceMotion = useSettingValue('lyricStage.reduceMotion')
  const marqueeMode = useSettingValue('lyricStage.marqueeMode')
  const textStroke = useSettingValue('lyricStage.textStroke')
  const layoutTopOffset = useSettingValue('lyricStage.layoutTopOffset')
  const layoutBottomOffset = useSettingValue('lyricStage.layoutBottomOffset')
  const layoutContentOffset = useSettingValue('lyricStage.layoutContentOffset')
  const playbackRate = useSettingValue('player.playbackRate')
  const pitchSemitones = useSettingValue('player.pitchSemitones')
  const listRef = useRef<FlatList<Line>>(null)
  const ktvPopupRef = useRef<PopupType>(null)
  const stageSettingPopupRef = useRef<PopupType>(null)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [ktvVisible, setKtvVisible] = useState(false)
  const [stageSettingVisible, setStageSettingVisible] = useState(false)
  const [ktvOptions, setKtvOptions] = useState<KtvOption[]>([])
  const [radialMenu, setRadialMenu] = useState<RadialMenuState>({ visible: false, x: 0, y: 0 })
  const [seekValue, setSeekValue] = useState(0)
  const [isSeeking, setSeeking] = useState(false)
  const [playbackRateValue, setPlaybackRateValue] = useState(Math.trunc(playbackRate * 100))
  const [isPlaybackRateSliding, setPlaybackRateSliding] = useState(false)
  const [pitchValue, setPitchValue] = useState(pitchSemitones)
  const [isPitchSliding, setPitchSliding] = useState(false)
  const hideTimerRef = useRef<NodeJS.Timeout | null>(null)
  const radialHideTimerRef = useRef<NodeJS.Timeout | null>(null)
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null)
  const touchStartRef = useRef<{ x: number, y: number } | null>(null)
  const ignoreNextPressRef = useRef(false)
  const ignorePressUntilRef = useRef(0)
  const longPressTriggeredRef = useRef(false)
  const [rotateMode, setRotateMode] = useState<RotateMode>('auto')
  const { width, height } = useWindowDimensions()
  const isLandscape = width > height

  const activeIndex = line < 0 ? 0 : Math.min(line, Math.max(lyricLines.length - 1, 0))

  const transformStyle = useMemo(() => {
    const transform = getTransformStyle(mirror)
    return transform ? { transform } : null
  }, [mirror])
  const fontOption = FONT_OPTIONS.find(option => option.value == fontFamily) ?? FONT_OPTIONS[0]
  const shouldReduceMotion = reduceMotion
  const shouldUseLeanRendering = reduceMotion || projector || usePureBlackBackground
  const marqueeEnabled = marqueeMode && !shouldReduceMotion
  const marqueeThemeBaseIndex = Math.max(MARQUEE_THEME_ORDER.indexOf(colorTheme), 0)
  const displayTheme = marqueeEnabled
    ? MARQUEE_THEME_ORDER[(marqueeThemeBaseIndex + Math.max(activeIndex, 0)) % MARQUEE_THEME_ORDER.length]
    : colorTheme
  const themeColors = COLOR_THEMES[displayTheme]
  const isFocusMode = mode == 'singleLine' || mode == 'doubleLine' || mode == 'threeLine'
  const localMusicInfo = playMusicInfo.musicInfo && !('progress' in playMusicInfo.musicInfo) && playMusicInfo.musicInfo.source == 'local' && playMusicInfo.musicInfo.meta?.filePath
    ? playMusicInfo.musicInfo
    : null
  const currentKtvVariant = localMusicInfo ? getCurrentKtvVariant(localMusicInfo, ktvOptions) : null
  const displayedSeekValue = isSeeking ? seekValue : nowPlayTime
  const displayedPlaybackRate = isPlaybackRateSliding ? playbackRateValue : Math.trunc(playbackRate * 100)
  const displayedPitch = isPitchSliding ? pitchValue : pitchSemitones
  const triggerButtonFeedback = () => {
    if (Platform.OS != 'android') return
    try {
      Vibration.vibrate(BUTTON_FEEDBACK_MS)
    } catch {}
  }

  const handleAction = (action: () => void) => {
    triggerButtonFeedback()
    action()
  }

  const clearLongPressTimer = () => {
    if (!longPressTimerRef.current) return
    clearTimeout(longPressTimerRef.current)
    longPressTimerRef.current = null
  }

  const clearRadialHideTimer = () => {
    if (!radialHideTimerRef.current) return
    clearTimeout(radialHideTimerRef.current)
    radialHideTimerRef.current = null
  }

  const scheduleRadialMenuHide = (hideDelayMs: number = RADIAL_MENU_IDLE_MS) => {
    if (!radialMenu.visible) return
    clearRadialHideTimer()
    radialHideTimerRef.current = setTimeout(() => {
      radialHideTimerRef.current = null
      setRadialMenu(prev => prev.visible ? { ...prev, visible: false } : prev)
    }, hideDelayMs)
  }

  const closeRadialMenu = () => {
    clearRadialHideTimer()
    setRadialMenu(prev => prev.visible ? { ...prev, visible: false } : prev)
  }

  const showControls = (hideDelayMs: number = 1000) => {
    setControlsVisible(true)
    void setImmersiveMode(true).catch(() => {})
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null
      setControlsVisible(false)
      void setImmersiveMode(true).catch(() => {})
    }, hideDelayMs)
  }

  useEffect(() => {
    showControls()
    screenkeepAwake()
    RNStatusBar.setHidden(true, 'fade')
    RNStatusBar.setTranslucent(true)
    RNStatusBar.setBackgroundColor('transparent', true)
    void setImmersiveMode(true).catch(() => {})
    const subscription = AppState.addEventListener('change', state => {
      if (state == 'active') {
        RNStatusBar.setHidden(true, 'fade')
        RNStatusBar.setTranslucent(true)
        RNStatusBar.setBackgroundColor('transparent', true)
        void setImmersiveMode(true).catch(() => {})
      }
    })
    return () => {
      subscription.remove()
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
      clearRadialHideTimer()
      clearLongPressTimer()
      screenUnkeepAwake()
      void setScreenOrientation('auto').catch(() => {})
      void setImmersiveMode(false).catch(() => {})
      RNStatusBar.setHidden(false, 'fade')
      RNStatusBar.setTranslucent(false)
      RNStatusBar.setBackgroundColor('transparent', true)
    }
  }, [])

  useEffect(() => {
    setPlaybackRateValue(Math.trunc(playbackRate * 100))
  }, [playbackRate])

  useEffect(() => {
    setPitchValue(pitchSemitones)
  }, [pitchSemitones])

  useEffect(() => {
    let canceled = false
    if (!localMusicInfo) {
      setKtvOptions([])
      return
    }
    void getKtvOptions(localMusicInfo).then(result => {
      if (canceled) return
      setKtvOptions(result?.options ?? [])
    }).catch(() => {
      if (canceled) return
      setKtvOptions([])
    })
    return () => {
      canceled = true
    }
  }, [localMusicInfo])

  useEffect(() => {
    void setScreenOrientation(rotateMode).catch(() => {})
  }, [rotateMode])

  useEffect(() => {
    if (isFocusMode) return
    if (!lyricLines.length) return
    try {
      listRef.current?.scrollToIndex({
        index: activeIndex,
        animated: !shouldReduceMotion,
        viewPosition: getViewPosition(mode),
      })
    } catch {}
  }, [activeIndex, isFocusMode, lyricLines, mode, shouldReduceMotion])

  const cycleMode = () => {
    const next = MODE_ORDER[(MODE_ORDER.indexOf(mode) + 1) % MODE_ORDER.length]
    updateSetting({ 'lyricStage.mode': next })
    showControls(800)
  }

  const setStageMode = (next: StageMode) => {
    updateSetting({ 'lyricStage.mode': next })
    showControls(1200)
  }

  const cycleMirror = () => {
    const next = MIRROR_ORDER[(MIRROR_ORDER.indexOf(mirror) + 1) % MIRROR_ORDER.length]
    updateSetting({ 'lyricStage.mirror': next })
    showControls(800)
  }

  const zoom = (delta: number) => {
    const next = Math.max(0.7, Math.min(1.8, parseFloat((fontScale + delta).toFixed(2))))
    updateSetting({ 'lyricStage.fontScale': next })
    showControls(800)
  }

  const toggleProjector = () => {
    updateSetting({ 'lyricStage.isProjectorMode': !projector })
    showControls(800)
  }

  const togglePureBlackBackground = () => {
    updateSetting({ 'lyricStage.usePureBlackBackground': !usePureBlackBackground })
    showControls(800)
  }

  const toggleReduceMotion = () => {
    updateSetting({ 'lyricStage.reduceMotion': !reduceMotion })
    showControls(800)
  }

  const toggleMarqueeMode = () => {
    updateSetting({ 'lyricStage.marqueeMode': !marqueeMode })
    showControls(800)
  }

  const toggleTextStroke = () => {
    updateSetting({ 'lyricStage.textStroke': !textStroke })
    showControls(800)
  }

  const cycleColorTheme = () => {
    const order = Object.keys(COLOR_THEMES) as ColorTheme[]
    const next = order[(order.indexOf(colorTheme) + 1) % order.length]
    updateSetting({ 'lyricStage.colorTheme': next })
    showControls(800)
  }

  const cycleFont = () => {
    const next = FONT_OPTIONS[(FONT_OPTIONS.findIndex(option => option.value == fontFamily) + 1) % FONT_OPTIONS.length]
    updateSetting({ 'lyricStage.fontFamily': next.value })
    showControls(800)
  }

  const changeLineHeight = (delta: number) => {
    const next = Math.max(0.92, Math.min(3, parseFloat((lineHeightScale + delta).toFixed(2))))
    updateSetting({ 'lyricStage.lineHeightScale': next })
    showControls(800)
  }

  const cycleRotate = () => {
    const next = ROTATE_ORDER[(ROTATE_ORDER.indexOf(rotateMode) + 1) % ROTATE_ORDER.length]
    setRotateMode(next)
    showControls(800)
  }

  const updateStageLayoutSetting = (setting: Partial<LX.AppSetting>) => {
    updateSetting(setting)
    showControls(1200)
  }

  const resetStageLayout = () => {
    updateStageLayoutSetting({
      'lyricStage.layoutTopOffset': 0,
      'lyricStage.layoutBottomOffset': 0,
      'lyricStage.layoutContentOffset': 0,
    })
  }

  const openRadialMenuAt = (x: number, y: number) => {
    const horizontalMargin = RADIAL_PANEL_WIDTH / 2 + 8
    const topMargin = RADIAL_MENU_SIZE / 2 + 8
    const bottomMargin = RADIAL_MENU_SIZE / 2 + RADIAL_PANEL_HEIGHT + 12
    const nextX = Math.max(horizontalMargin, Math.min(width - horizontalMargin, x))
    const nextY = Math.max(topMargin, Math.min(height - bottomMargin, y))
    if (Platform.OS == 'android') {
      try {
        Vibration.vibrate(18)
      } catch {}
    }
    longPressTriggeredRef.current = true
    ignoreNextPressRef.current = true
    ignorePressUntilRef.current = Date.now() + 900
    setRadialMenu({ visible: true, x: nextX, y: nextY })
    showControls(2400)
    clearRadialHideTimer()
    radialHideTimerRef.current = setTimeout(() => {
      radialHideTimerRef.current = null
      setRadialMenu(prev => prev.visible ? { ...prev, visible: false } : prev)
    }, RADIAL_MENU_IDLE_MS)
  }

  const openRadialMenu = (event: GestureResponderEvent) => {
    openRadialMenuAt(event.nativeEvent.locationX, event.nativeEvent.locationY)
  }

  const openRadialMenuByButton = () => {
    openRadialMenuAt(width / 2, Math.max(124, height * 0.32))
  }

  const openKtvPopup = () => {
    closeRadialMenu()
    if (!localMusicInfo || ktvOptions.length < 2) {
      toast('当前歌曲没有可切换的 KTV 音轨')
      return
    }
    if (ktvVisible) ktvPopupRef.current?.setVisible(true)
    else {
      setKtvVisible(true)
      requestAnimationFrame(() => {
        ktvPopupRef.current?.setVisible(true)
      })
    }
  }

  const openStageSettingPopup = () => {
    showControls(2400)
    if (stageSettingVisible) {
      stageSettingPopupRef.current?.setVisible(true)
      return
    }
    setStageSettingVisible(true)
    requestAnimationFrame(() => {
      stageSettingPopupRef.current?.setVisible(true)
    })
  }

  const handleKtvSelect = (option: KtvOption) => {
    triggerButtonFeedback()
    ktvPopupRef.current?.setVisible(false)
    void switchKtvVariant(option).catch(err => {
      toast((err as Error).message || 'KTV 切换失败')
    })
  }

  const handleRadialAction = (action: () => void) => {
    handleAction(() => {
      closeRadialMenu()
      action()
    })
  }

  const handleSeekComplete = (value: number) => {
    setSeeking(false)
    triggerButtonFeedback()
    scheduleRadialMenuHide()
    global.app_event.setProgress(value, maxPlayTime)
  }

  const handlePlaybackRateComplete = (value: number) => {
    const nextValue = Math.trunc(value)
    const rate = parseFloat((nextValue / 100).toFixed(2))
    setPlaybackRateSliding(false)
    setPlaybackRateValue(nextValue)
    triggerButtonFeedback()
    scheduleRadialMenuHide()
    void setPlayerPlaybackRate(rate)
    void setLyricPlaybackRate(rate)
    void updateMetaData(playerState.musicInfo, playerState.isPlay, playerState.lastLyric, true)
    if (Math.trunc(playbackRate * 100) == nextValue) return
    updateSetting({ 'player.playbackRate': rate })
  }

  const applyPlaybackRateValue = (value: number) => {
    const nextValue = Math.max(60, Math.min(200, Math.trunc(value)))
    const rate = parseFloat((nextValue / 100).toFixed(2))
    setPlaybackRateSliding(false)
    setPlaybackRateValue(nextValue)
    triggerButtonFeedback()
    scheduleRadialMenuHide()
    void setPlayerPlaybackRate(rate)
    void setLyricPlaybackRate(rate)
    void updateMetaData(playerState.musicInfo, playerState.isPlay, playerState.lastLyric, true)
    if (Math.trunc(playbackRate * 100) == nextValue) return
    updateSetting({ 'player.playbackRate': rate })
  }

  const stepPlaybackRateValue = (delta: number) => {
    applyPlaybackRateValue(displayedPlaybackRate + delta)
  }

  const handlePitchComplete = (value: number) => {
    const nextValue = Math.trunc(value)
    setPitchSliding(false)
    setPitchValue(nextValue)
    triggerButtonFeedback()
    scheduleRadialMenuHide()
    void (async() => {
      try {
        await setPlayerPitch(nextValue)
        if (pitchSemitones == nextValue) return
        updateSetting({ 'player.pitchSemitones': nextValue })
      } catch (err) {
        setPitchValue(pitchSemitones)
        toast((err as Error).message || '变调设置失败')
      }
    })()
  }

  const applyPitchValue = (value: number) => {
    const nextValue = Math.max(-12, Math.min(12, Math.trunc(value)))
    setPitchSliding(false)
    setPitchValue(nextValue)
    triggerButtonFeedback()
    scheduleRadialMenuHide()
    void (async() => {
      try {
        await setPlayerPitch(nextValue)
        if (pitchSemitones != nextValue) updateSetting({ 'player.pitchSemitones': nextValue })
      } catch (err) {
        setPitchValue(pitchSemitones)
        toast((err as Error).message || '变调设置失败')
      }
    })()
  }

  const stepPitchValue = (delta: number) => {
    applyPitchValue(displayedPitch + delta)
  }

  const handlePointerActivity = (hideDelayMs: number = POINTER_ACTIVITY_DELAY_MS) => {
    showControls(hideDelayMs)
    scheduleRadialMenuHide(hideDelayMs)
  }

  const handleTouchStart = (event: GestureResponderEvent) => {
    const { locationX, locationY } = event.nativeEvent
    touchStartRef.current = { x: locationX, y: locationY }
    longPressTriggeredRef.current = false
    clearLongPressTimer()
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null
      openRadialMenuAt(locationX, locationY)
    }, LONG_PRESS_MS)
  }

  const handleTouchMove = (event: GestureResponderEvent) => {
    handlePointerActivity(POINTER_ACTIVITY_DELAY_MS)
    const start = touchStartRef.current
    if (!start) return
    const dx = event.nativeEvent.locationX - start.x
    const dy = event.nativeEvent.locationY - start.y
    if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_THRESHOLD) clearLongPressTimer()
  }

  const handleTouchEnd = () => {
    clearLongPressTimer()
    touchStartRef.current = null
    if (longPressTriggeredRef.current) {
      ignorePressUntilRef.current = Date.now() + 900
      longPressTriggeredRef.current = false
    }
  }

  const handleScrollToIndexFailed: FlatListType['onScrollToIndexFailed'] = info => {
    setTimeout(() => {
      try {
        listRef.current?.scrollToIndex({
          index: info.index,
          animated: true,
          viewPosition: getViewPosition(mode),
        })
      } catch {}
    }, 80)
  }

  const renderItem: FlatListType['renderItem'] = ({ item, index }) => (
    <StageLine
      line={item}
      active={index == activeIndex}
      fontScale={fontScale}
      fontFamily={fontFamily}
      projector={projector}
      reduceMotion={shouldReduceMotion}
      lineHeightScale={lineHeightScale}
      themeColors={themeColors}
      mode={mode}
      textStroke={textStroke}
    />
  )

  const pageBackground = usePureBlackBackground
    ? '#000000'
    : projector ? themeColors.backgroundProjector : themeColors.background

  return (
    <PageContent>
      <RNStatusBar hidden={true} translucent={true} backgroundColor="transparent" barStyle="light-content" />
      <TouchableOpacity
        activeOpacity={1}
        style={styles.page}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onPress={() => {
          if (Date.now() < ignorePressUntilRef.current) return
          if (ignoreNextPressRef.current) {
            ignoreNextPressRef.current = false
            return
          }
          if (!controlsVisible) {
            showControls(1600)
            return
          }
          if (radialMenu.visible) {
            closeRadialMenu()
            return
          }
        }}
      >
        <View style={[styles.page, { backgroundColor: pageBackground }]}>
          <View style={[styles.content, { transform: [{ translateY: layoutContentOffset }, ...(transformStyle?.transform ?? [])] }]}>
            {
              isFocusMode
                ? (
                  <FocusLineMode
                    lines={lyricLines}
                    activeIndex={activeIndex}
                    fontScale={fontScale}
                    fontFamily={fontFamily}
                    projector={projector}
                    reduceMotion={shouldReduceMotion}
                    lineHeightScale={lineHeightScale}
                    themeColors={themeColors}
                    mode={mode}
                    textStroke={textStroke}
                    onTouchStart={handleTouchStart}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                  />
                )
                : (
                  <FlatList
                    ref={listRef}
                    data={lyricLines}
                    renderItem={renderItem}
                    onTouchStart={handleTouchStart}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                    onTouchCancel={handleTouchEnd}
                    keyExtractor={(item, index) => `${index}_${item.time}_${item.text}`}
                    initialNumToRender={shouldUseLeanRendering ? 8 : 16}
                    maxToRenderPerBatch={shouldUseLeanRendering ? 4 : 12}
                    windowSize={shouldUseLeanRendering ? 3 : 7}
                    updateCellsBatchingPeriod={shouldUseLeanRendering ? 80 : 40}
                    removeClippedSubviews={shouldUseLeanRendering}
                    contentContainerStyle={[
                      styles.listContent,
                      mode == 'teleprompter' ? styles.teleprompterContent : null,
                      shouldUseLeanRendering ? styles.listContentReduced : null,
                    ]}
                    showsVerticalScrollIndicator={false}
                    onScrollToIndexFailed={handleScrollToIndexFailed}
                    ListFooterComponent={<View style={styles.listFooter} />}
                    ListEmptyComponent={
                      <View style={styles.emptyWrap}>
                        <Text color="#f4f4f4" size={26}>当前歌曲暂无歌词</Text>
                      </View>
                    }
                  />
                )
            }
          </View>

          {
            controlsVisible
              ? (
                <>
                  <View style={[styles.topBar, { top: 8 + layoutTopOffset }]}>
                    <TouchableOpacity style={styles.backBtn} onPress={() => { handleAction(() => { void pop(componentId) }) }}>
                      <Text color="#f6f6f6" size={15}>返回</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.backBtn} onPress={() => { handleAction(openStageSettingPopup) }}>
                      <Text color="#f6f6f6" size={15}>设置</Text>
                    </TouchableOpacity>
                    <View style={styles.titleWrap}>
                      <Text color="#f6f6f6" size={16}>歌词舞台</Text>
                      <Text color="rgba(255,255,255,0.66)" size={11} numberOfLines={2}>
                        {`${MODE_LABELS[mode]} / ${MIRROR_LABELS[mirror]} / ${COLOR_THEMES[displayTheme].label}${marqueeEnabled ? ' / 跑马灯' : ''} / ${fontOption.label}`}
                      </Text>
                    </View>
                  </View>
                  <View style={[styles.controlPanel, isLandscape ? styles.controlPanelLandscape : null, { bottom: 8 + layoutBottomOffset }]}>
                    <Text style={styles.panelLabel} color="rgba(255,255,255,0.58)" size={11}>显示</Text>
                    <View style={styles.controlGrid}>
                      <TouchableOpacity style={[styles.actionBtn, isLandscape ? styles.actionBtnLandscapeHalf : styles.actionBtnHalf, { backgroundColor: themeColors.accent }]} onPress={() => { handleAction(cycleMode) }}>
                        <Text color="#f6f6f6" size={14}>{MODE_LABELS[mode]}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.actionBtn, isLandscape ? styles.actionBtnLandscapeHalf : styles.actionBtnHalf, { backgroundColor: themeColors.accent }]} onPress={() => { handleAction(cycleMirror) }}>
                        <Text color="#f6f6f6" size={14}>{MIRROR_LABELS[mirror]}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.actionBtn, isLandscape ? styles.actionBtnLandscapeThird : styles.actionBtnHalf, { backgroundColor: themeColors.accent }]} onPress={() => { handleAction(cycleColorTheme) }}>
                        <Text color="#f6f6f6" size={14}>切换颜色</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.actionBtn, isLandscape ? styles.actionBtnLandscapeThird : styles.actionBtnHalf, { backgroundColor: themeColors.accent }]} onPress={() => { handleAction(cycleFont) }}>
                        <Text color="#f6f6f6" size={14}>{fontOption.label}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.actionBtn, isLandscape ? styles.actionBtnLandscapeThird : styles.actionBtnHalf, { backgroundColor: themeColors.accent }]} onPress={() => { handleAction(toggleMarqueeMode) }}>
                        <Text color="#f6f6f6" size={13}>{marqueeMode ? '跑马灯:开' : '跑马灯:关'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.actionBtn, isLandscape ? styles.actionBtnLandscapeThird : styles.actionBtnHalf, { backgroundColor: themeColors.accent }]} onPress={() => { handleAction(toggleTextStroke) }}>
                        <Text color="#f6f6f6" size={13}>{textStroke ? '描边:开' : '描边:关'}</Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.panelLabel} color="rgba(255,255,255,0.58)" size={11}>字号与排版</Text>
                    <View style={styles.controlGrid}>
                      <TouchableOpacity style={[styles.actionBtn, isLandscape ? styles.actionBtnLandscapeThird : styles.actionBtnThird, { backgroundColor: themeColors.accent }]} onPress={() => { handleAction(() => { zoom(-0.1) }) }}>
                        <Text color="#f6f6f6" size={14}>A-</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.actionBtn, isLandscape ? styles.actionBtnLandscapeThird : styles.actionBtnThird, { backgroundColor: themeColors.accent }]} onPress={() => { handleAction(() => { zoom(0.1) }) }}>
                        <Text color="#f6f6f6" size={14}>A+</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.actionBtn, isLandscape ? styles.actionBtnLandscapeThird : styles.actionBtnThird, { backgroundColor: themeColors.accent }]} onPress={() => { handleAction(() => { changeLineHeight(-0.04) }) }}>
                        <Text color="#f6f6f6" size={14}>行距-</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.actionBtn, isLandscape ? styles.actionBtnLandscapeThird : styles.actionBtnThird, { backgroundColor: themeColors.accent }]} onPress={() => { handleAction(() => { changeLineHeight(0.04) }) }}>
                        <Text color="#f6f6f6" size={14}>行距+</Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.panelLabel} color="rgba(255,255,255,0.58)" size={11}>舞台</Text>
                    <View style={styles.controlGrid}>
                      <TouchableOpacity style={[styles.actionBtn, isLandscape ? styles.actionBtnLandscapeThird : styles.actionBtnThird, { backgroundColor: themeColors.accent }]} onPress={() => { handleAction(openRadialMenuByButton) }}>
                        <Text color="#f6f6f6" size={13}>圆盘菜单</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.actionBtn, isLandscape ? styles.actionBtnLandscapeThird : styles.actionBtnThird, { backgroundColor: themeColors.accent }]} onPress={() => { handleAction(cycleRotate) }}>
                        <Text color="#f6f6f6" size={13}>{ROTATE_LABELS[rotateMode]}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.actionBtn, isLandscape ? styles.actionBtnLandscapeThird : styles.actionBtnThird, { backgroundColor: themeColors.accent }]} onPress={() => { handleAction(openStageSettingPopup) }}>
                        <Text color="#f6f6f6" size={13}>高级设置</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </>
              )
              : null
          }
          {
            radialMenu.visible
              ? (
                <View
                  pointerEvents="box-none"
                  style={[
                    styles.radialMenuWrap,
                    {
                      left: radialMenu.x - RADIAL_PANEL_WIDTH / 2,
                      top: radialMenu.y - RADIAL_MENU_SIZE / 2,
                    },
                  ]}
                  onStartShouldSetResponder={() => true}
                  onResponderGrant={() => {
                    handlePointerActivity(POINTER_ACTIVITY_DELAY_MS)
                  }}
                  onResponderMove={() => {
                    handlePointerActivity(POINTER_ACTIVITY_DELAY_MS)
                  }}
                >
                  <View style={[styles.radialMenu, { borderColor: themeColors.accent, backgroundColor: 'rgba(0,0,0,0.58)' }]}>
                    <TouchableOpacity
                      style={[
                        styles.radialAction,
                        styles.radialActionTop,
                        { backgroundColor: themeColors.accent },
                      ]}
                      activeOpacity={0.88}
                      onPress={() => { handleRadialAction(openKtvPopup) }}
                    >
                      <Icon name="album" color="#f6f6f6" size={20} />
                      <Text color="#f6f6f6" size={10}>KTV</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.radialAction,
                        styles.radialActionLeft,
                        { backgroundColor: 'rgba(255,255,255,0.16)' },
                      ]}
                      activeOpacity={0.88}
                      onPress={() => { handleRadialAction(() => { void playPrev() }) }}
                    >
                      <Icon name="prevMusic" color="#f6f6f6" size={20} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.radialAction,
                        styles.radialActionRight,
                        { backgroundColor: 'rgba(255,255,255,0.16)' },
                      ]}
                      activeOpacity={0.88}
                      onPress={() => { handleRadialAction(() => { void playNext() }) }}
                    >
                      <Icon name="nextMusic" color="#f6f6f6" size={20} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.radialAction,
                        styles.radialActionCenter,
                        { backgroundColor: themeColors.active },
                      ]}
                      activeOpacity={0.88}
                      onPress={() => { handleRadialAction(togglePlay) }}
                    >
                      <Icon name={isPlay ? 'pause' : 'play'} color={pageBackground} size={22} />
                    </TouchableOpacity>
                    <Text style={styles.radialHint} color="rgba(255,255,255,0.72)" size={10}>
                      长按快捷切歌
                    </Text>
                  </View>
                  <View style={[styles.radialPanel, { borderColor: themeColors.accent, backgroundColor: 'rgba(0,0,0,0.72)' }]} onStartShouldSetResponder={() => true}>
                    <View style={styles.radialPanelRow}>
                      <Text color="#f6f6f6" size={11}>进度</Text>
                      <Text color="rgba(255,255,255,0.72)" size={11}>
                        {`${formatPlayTime2(displayedSeekValue)} / ${formatPlayTime2(maxPlayTime)}`}
                      </Text>
                    </View>
                    <View style={styles.radialProgressTrack}>
                      <View style={[styles.radialProgressBuffered, { width: `${Math.max(0, Math.min(100, bufferedProgress * 100))}%` }]} />
                      <View style={[styles.radialProgressActive, { width: `${maxPlayTime ? Math.max(0, Math.min(100, displayedSeekValue / maxPlayTime * 100)) : 0}%`, backgroundColor: themeColors.active }]} />
                      <Slider
                        minimumValue={0}
                        maximumValue={Math.max(maxPlayTime, 1)}
                        onSlidingStart={() => {
                          setSeeking(true)
                          setSeekValue(nowPlayTime)
                        }}
                        onValueChange={value => {
                          setSeeking(true)
                          setSeekValue(value)
                          handlePointerActivity(POINTER_ACTIVITY_DELAY_MS)
                        }}
                        onSlidingComplete={handleSeekComplete}
                        value={displayedSeekValue}
                        step={1}
                      />
                    </View>
                    <View style={styles.radialPanelRow}>
                      <Text color="#f6f6f6" size={11}>倍速</Text>
                      <Text color="rgba(255,255,255,0.72)" size={11}>{`${(displayedPlaybackRate / 100).toFixed(2)}x`}</Text>
                    </View>
                    <View style={styles.pitchButtonRow}>
                      <TouchableOpacity style={styles.pitchButton} onPress={() => { stepPlaybackRateValue(-10) }}>
                        <Text color="#f6f6f6" size={12}>-0.1</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.pitchButton} onPress={() => { applyPlaybackRateValue(100) }}>
                        <Text color="#f6f6f6" size={12}>复位</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.pitchButton} onPress={() => { stepPlaybackRateValue(10) }}>
                        <Text color="#f6f6f6" size={12}>+0.1</Text>
                      </TouchableOpacity>
                    </View>
                    <Slider
                      minimumValue={60}
                      maximumValue={200}
                      onSlidingStart={() => {
                        setPlaybackRateSliding(true)
                        setPlaybackRateValue(Math.trunc(playbackRate * 100))
                      }}
                      onValueChange={value => {
                        setPlaybackRateSliding(true)
                        setPlaybackRateValue(Math.trunc(value))
                        handlePointerActivity(POINTER_ACTIVITY_DELAY_MS)
                      }}
                      onSlidingComplete={handlePlaybackRateComplete}
                      value={displayedPlaybackRate}
                      step={10}
                    />
                    <View style={styles.radialPanelRow}>
                      <Text color="#f6f6f6" size={11}>变调</Text>
                      <Text color="rgba(255,255,255,0.72)" size={11}>{`${displayedPitch > 0 ? '+' : ''}${displayedPitch} st`}</Text>
                    </View>
                    <View style={styles.pitchButtonRow}>
                      <TouchableOpacity style={styles.pitchButton} onPress={() => { stepPitchValue(-1) }}>
                        <Text color="#f6f6f6" size={12}>-1</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.pitchButton} onPress={() => { applyPitchValue(0) }}>
                        <Text color="#f6f6f6" size={12}>复位</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.pitchButton} onPress={() => { stepPitchValue(1) }}>
                        <Text color="#f6f6f6" size={12}>+1</Text>
                      </TouchableOpacity>
                    </View>
                    <Slider
                      minimumValue={-12}
                      maximumValue={12}
                      onSlidingStart={() => {
                        setPitchSliding(true)
                        setPitchValue(pitchSemitones)
                      }}
                      onValueChange={value => {
                        setPitchSliding(true)
                        setPitchValue(Math.trunc(value))
                        handlePointerActivity(POINTER_ACTIVITY_DELAY_MS)
                      }}
                      onSlidingComplete={handlePitchComplete}
                      value={displayedPitch}
                      step={1}
                    />
                  </View>
                </View>
              )
              : null
          }
        </View>
      </TouchableOpacity>
      {
        stageSettingVisible
          ? (
            <Popup ref={stageSettingPopupRef} title="舞台设置">
              <ScrollView style={styles.ktvList}>
                <View onStartShouldSetResponder={() => true}>
                  <Text style={styles.settingSectionTitle}>显示模式</Text>
                  <View style={styles.settingOptionGrid}>
                    {MODE_ORDER.map(item => (
                      <TouchableOpacity
                        key={item}
                        style={[styles.settingChip, item == mode ? styles.settingChipActive : null]}
                        onPress={() => { handleAction(() => { setStageMode(item) }) }}
                      >
                        <Text color="#f6f6f6" size={13}>{MODE_LABELS[item]}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={styles.settingSectionTitle}>布局位置</Text>
                  <Text style={styles.settingSectionTip}>调整后会自动保存，下次进入歌词舞台继续使用。</Text>
                  <View style={styles.settingSliderRow}>
                    <Text color={theme['c-font-label']} size={12}>顶部工具栏</Text>
                    <Text color={theme['c-font-label']} size={12}>{layoutTopOffset}</Text>
                  </View>
                  <Slider minimumValue={-10} maximumValue={80} step={1} value={layoutTopOffset} onValueChange={value => { updateStageLayoutSetting({ 'lyricStage.layoutTopOffset': Math.trunc(value) }) }} />
                  <View style={styles.settingSliderRow}>
                    <Text color={theme['c-font-label']} size={12}>底部菜单</Text>
                    <Text color={theme['c-font-label']} size={12}>{layoutBottomOffset}</Text>
                  </View>
                  <Slider minimumValue={-10} maximumValue={80} step={1} value={layoutBottomOffset} onValueChange={value => { updateStageLayoutSetting({ 'lyricStage.layoutBottomOffset': Math.trunc(value) }) }} />
                  <View style={styles.settingSliderRow}>
                    <Text color={theme['c-font-label']} size={12}>歌词内容</Text>
                    <Text color={theme['c-font-label']} size={12}>{layoutContentOffset}</Text>
                  </View>
                  <Slider minimumValue={-120} maximumValue={120} step={1} value={layoutContentOffset} onValueChange={value => { updateStageLayoutSetting({ 'lyricStage.layoutContentOffset': Math.trunc(value) }) }} />
                  <TouchableOpacity style={styles.settingResetBtn} onPress={() => { handleAction(resetStageLayout) }}>
                    <Text color="#f6f6f6" size={13}>恢复默认布局</Text>
                  </TouchableOpacity>

                  <Text style={styles.settingSectionTitle}>投影</Text>
                  <Text style={styles.settingSectionTip}>投影模式会增强高对比和远距离可读性；纯黑底更适合投影仪，低耗模式会减少动画和渲染压力。</Text>
                  <View style={styles.settingOptionGrid}>
                    <TouchableOpacity style={[styles.settingChip, projector ? styles.settingChipActive : null]} onPress={() => { handleAction(toggleProjector) }}>
                      <Text color="#f6f6f6" size={13}>{projector ? '投影模式:开' : '投影模式:关'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.settingChip, usePureBlackBackground ? styles.settingChipActive : null]} onPress={() => { handleAction(togglePureBlackBackground) }}>
                      <Text color="#f6f6f6" size={13}>{usePureBlackBackground ? '纯黑背景:开' : '纯黑背景:关'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.settingChip, reduceMotion ? styles.settingChipActive : null]} onPress={() => { handleAction(toggleReduceMotion) }}>
                      <Text color="#f6f6f6" size={13}>{reduceMotion ? '低耗模式:开' : '低耗模式:关'}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </ScrollView>
            </Popup>
          )
          : null
      }
      {
        ktvVisible
          ? (
            <Popup ref={ktvPopupRef} title="KTV 音轨">
              <ScrollView style={styles.ktvList}>
                <View onStartShouldSetResponder={() => true}>
                  {ktvOptions.map(option => (
                    <TouchableOpacity
                      key={option.value}
                      style={{ ...styles.ktvListItem, borderBottomColor: theme['c-border-background'] }}
                      onPress={() => { handleKtvSelect(option) }}
                    >
                      <Text style={styles.ktvListLabel}>{option.label}</Text>
                      <Icon
                        name={option.variant == currentKtvVariant && option.filePath == localMusicInfo?.meta.filePath ? 'checkbox-marked' : 'checkbox-blank-outline'}
                        color={theme['c-font-label']}
                        size={16}
                      />
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </Popup>
          )
          : null
      }
    </PageContent>
  )
})

const styles = createStyle({
  page: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  listContent: {
    paddingTop: '26%',
    paddingBottom: '34%',
    paddingLeft: 18,
    paddingRight: 18,
  },
  listContentReduced: {
    paddingTop: '20%',
    paddingBottom: '24%',
  },
  teleprompterContent: {
    paddingTop: '16%',
    paddingBottom: '52%',
  },
  listFooter: {
    height: 1,
  },
  lineWrap: {
    paddingVertical: 2,
    alignItems: 'center',
  },
  lineWrapProjector: {
    marginHorizontal: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.24)',
  },
  lineWrapProjectorActive: {
    backgroundColor: 'rgba(0,0,0,0.44)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  lineWrapActive: {
    paddingVertical: 6,
    transform: [{ scale: 1.02 }],
  },
  lineWrapFull: {
    marginHorizontal: 12,
    paddingHorizontal: 10,
  },
  lineWrapTeleprompter: {
    alignItems: 'center',
    marginHorizontal: 8,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  lineText: {
    textAlign: 'center',
    fontWeight: '700',
    width: '100%',
    includeFontPadding: false,
    textAlignVertical: 'center',
    textShadowColor: 'transparent',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 0,
  },
  lineTextFull: {
    letterSpacing: 0.3,
  },
  lineTextTeleprompter: {
    textAlign: 'center',
  },
  extendedText: {
    marginTop: 2,
    textAlign: 'center',
    includeFontPadding: false,
    textShadowColor: 'transparent',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 0,
  },
  extendedTextTeleprompter: {
    textAlign: 'center',
  },
  threeLineContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  threeLineSpacer: {
    minHeight: 80,
  },
  topBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  backBtn: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 32,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  titleWrap: {
    flex: 1,
  },
  controlPanel: {
    position: 'absolute',
    left: 12,
    right: 12,
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.42)',
    borderRadius: 14,
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 8,
  },
  controlPanelLandscape: {
    left: 8,
    right: 8,
    bottom: 6,
    gap: 3,
    paddingHorizontal: 7,
    paddingTop: 5,
    paddingBottom: 6,
  },
  panelLabel: {
    paddingLeft: 2,
    letterSpacing: 1.2,
  },
  controlGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  actionBtn: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 32,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  actionBtnHalf: {
    width: '48%',
  },
  actionBtnThird: {
    width: '31%',
  },
  actionBtnLandscapeHalf: {
    width: '31.5%',
  },
  actionBtnLandscapeThird: {
    width: '23.6%',
  },
  emptyWrap: {
    minHeight: 240,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radialMenuWrap: {
    position: 'absolute',
    width: RADIAL_PANEL_WIDTH,
    height: RADIAL_MENU_SIZE + RADIAL_PANEL_HEIGHT,
    zIndex: 9,
    alignItems: 'center',
  },
  radialMenu: {
    width: RADIAL_MENU_SIZE,
    height: RADIAL_MENU_SIZE,
    borderRadius: RADIAL_MENU_SIZE / 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radialAction: {
    position: 'absolute',
    width: RADIAL_ACTION_SIZE,
    height: RADIAL_ACTION_SIZE,
    borderRadius: RADIAL_ACTION_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radialActionTop: {
    top: 14,
    left: (RADIAL_MENU_SIZE - RADIAL_ACTION_SIZE) / 2,
  },
  radialActionLeft: {
    left: 14,
    top: (RADIAL_MENU_SIZE - RADIAL_ACTION_SIZE) / 2,
  },
  radialActionRight: {
    right: 14,
    top: (RADIAL_MENU_SIZE - RADIAL_ACTION_SIZE) / 2,
  },
  radialActionCenter: {
    left: (RADIAL_MENU_SIZE - RADIAL_ACTION_SIZE) / 2,
    top: (RADIAL_MENU_SIZE - RADIAL_ACTION_SIZE) / 2 + 30,
  },
  radialHint: {
    position: 'absolute',
    bottom: 14,
  },
  radialPanel: {
    marginTop: 10,
    width: RADIAL_PANEL_WIDTH,
    minHeight: RADIAL_PANEL_HEIGHT,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
  },
  pitchButtonRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 6,
  },
  pitchButton: {
    flex: 1,
    minHeight: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  radialPanelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  radialProgressTrack: {
    position: 'relative',
    justifyContent: 'center',
    marginBottom: 4,
  },
  radialProgressBuffered: {
    position: 'absolute',
    left: 10,
    right: 10,
    height: 4,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  radialProgressActive: {
    position: 'absolute',
    left: 10,
    height: 4,
    borderRadius: 3,
  },
  ktvList: {
    flexShrink: 1,
    flexGrow: 0,
    paddingLeft: 15,
    paddingRight: 15,
  },
  settingSectionTitle: {
    marginTop: 6,
    marginBottom: 6,
    fontWeight: '700',
  },
  settingSectionTip: {
    marginBottom: 8,
    opacity: 0.72,
  },
  settingOptionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  settingChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  settingChipActive: {
    backgroundColor: 'rgba(72,191,132,0.48)',
  },
  settingSliderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
  settingResetBtn: {
    marginTop: 12,
    marginBottom: 10,
    minHeight: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  ktvListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
  },
  ktvListLabel: {
    flex: 1,
  },
})
