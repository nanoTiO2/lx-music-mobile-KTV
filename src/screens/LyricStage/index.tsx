import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { AppState, FlatList, type FlatListProps, Platform, StatusBar as RNStatusBar, TouchableOpacity, View, Vibration, useWindowDimensions } from 'react-native'
import Text from '@/components/common/Text'
import { AnimatedColorText } from '@/components/common/Text'
import PageContent from '@/components/PageContent'
import { pop } from '@/navigation/utils'
import { useLrcPlay, useLrcSet, type Line } from '@/plugins/lyric'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import { createStyle } from '@/utils/tools'
import { setSpText } from '@/utils/pixelRatio'
import { screenkeepAwake, screenUnkeepAwake, setImmersiveMode, setScreenOrientation } from '@/utils/nativeModules/utils'
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
    case 'threeLine':
      return 0.5
    case 'full':
    default:
      return 0.38
  }
}

const StageLine = memo(({ line, active, fontScale, fontFamily, projector, reduceMotion, lineHeightScale, themeColors }: {
  line: Line
  active: boolean
  fontScale: number
  fontFamily: string
  projector: boolean
  reduceMotion: boolean
  lineHeightScale: number
  themeColors: typeof COLOR_THEMES[ColorTheme]
}) => {
  const size = (projector ? 38 : 32) * fontScale
  const inactiveSize = size * 0.88
  const lineHeight = setSpText(size) * (projector ? 1.28 : 1.22) * lineHeightScale
  const baseStyle = fontFamily ? { fontFamily } : null
  const TextComp = projector || reduceMotion ? Text : AnimatedColorText

  return (
    <View style={styles.lineWrap}>
      <TextComp
        style={[
          styles.lineText,
          baseStyle,
          {
            lineHeight,
            letterSpacing: active ? 0.6 : 0.2,
            opacity: active ? 1 : 0.48,
          },
        ]}
        size={active ? size : inactiveSize}
        color={active ? themeColors.active : themeColors.inactive}
        numberOfLines={3}
      >
        {line.text || '...'}
      </TextComp>
      {
        active && line.extendedLyrics.map((item, index) => (
          <TextComp
            key={`${index}_${item}`}
            style={[
              styles.extendedText,
              baseStyle,
              { opacity: 0.82 },
            ]}
            size={Math.max(18, size * 0.48)}
            color={projector ? themeColors.active : themeColors.sub}
            numberOfLines={2}
          >
            {item}
          </TextComp>
        ))
      }
    </View>
  )
})

const ThreeLineMode = ({ lines, activeIndex, fontScale, fontFamily, projector, reduceMotion, lineHeightScale, themeColors }: {
  lines: Line[]
  activeIndex: number
  fontScale: number
  fontFamily: string
  projector: boolean
  reduceMotion: boolean
  lineHeightScale: number
  themeColors: typeof COLOR_THEMES[ColorTheme]
}) => {
  const indexes = [activeIndex - 1, activeIndex, activeIndex + 1]
  return (
    <View style={styles.threeLineContainer}>
      {indexes.map(index => {
        const line = lines[index]
        if (!line) return <View key={index} style={styles.threeLineSpacer} />
        return (
          <StageLine
            key={`${index}_${line.text}`}
            line={line}
            active={index == activeIndex}
            fontScale={fontScale * (index == activeIndex ? 1.08 : 0.94)}
            fontFamily={fontFamily}
            projector={projector}
            reduceMotion={reduceMotion}
            lineHeightScale={lineHeightScale}
            themeColors={themeColors}
          />
        )
      })}
    </View>
  )
}

export default memo(({ componentId }: { componentId: string }) => {
  const lyricLines = useLrcSet()
  const { line } = useLrcPlay()
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
  const listRef = useRef<FlatList<Line>>(null)
  const [controlsVisible, setControlsVisible] = useState(true)
  const hideTimerRef = useRef<NodeJS.Timeout | null>(null)
  const [rotateMode, setRotateMode] = useState<RotateMode>('auto')
  const { width, height } = useWindowDimensions()
  const isLandscape = width > height

  const activeIndex = line < 0 ? 0 : Math.min(line, Math.max(lyricLines.length - 1, 0))

  const transformStyle = useMemo(() => {
    const transform = getTransformStyle(mirror)
    return transform ? { transform } : null
  }, [mirror])
  const fontOption = FONT_OPTIONS.find(option => option.value == fontFamily) ?? FONT_OPTIONS[0]
  const shouldReduceMotion = reduceMotion || projector || usePureBlackBackground
  const displayTheme = marqueeMode && !shouldReduceMotion
    ? MARQUEE_THEME_ORDER[(MARQUEE_THEME_ORDER.indexOf(colorTheme) + Math.max(activeIndex, 0)) % MARQUEE_THEME_ORDER.length]
    : colorTheme
  const themeColors = COLOR_THEMES[displayTheme]
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
      screenUnkeepAwake()
      void setScreenOrientation('auto').catch(() => {})
      void setImmersiveMode(false).catch(() => {})
      RNStatusBar.setHidden(false, 'fade')
      RNStatusBar.setTranslucent(false)
      RNStatusBar.setBackgroundColor('transparent', true)
    }
  }, [])

  useEffect(() => {
    void setScreenOrientation(rotateMode).catch(() => {})
  }, [rotateMode])

  useEffect(() => {
    if (mode == 'threeLine') return
    if (!lyricLines.length) return
    try {
      listRef.current?.scrollToIndex({
        index: activeIndex,
        animated: !shouldReduceMotion,
        viewPosition: getViewPosition(mode),
      })
    } catch {}
  }, [activeIndex, lyricLines, mode, shouldReduceMotion])

  const cycleMode = () => {
    const next = MODE_ORDER[(MODE_ORDER.indexOf(mode) + 1) % MODE_ORDER.length]
    updateSetting({ 'lyricStage.mode': next })
    showControls(800)
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
    const next = Math.max(0.84, Math.min(1.5, parseFloat((lineHeightScale + delta).toFixed(2))))
    updateSetting({ 'lyricStage.lineHeightScale': next })
    showControls(800)
  }

  const cycleRotate = () => {
    const next = ROTATE_ORDER[(ROTATE_ORDER.indexOf(rotateMode) + 1) % ROTATE_ORDER.length]
    setRotateMode(next)
    showControls(800)
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
        onPress={() => { showControls() }}
        onPressIn={() => { showControls() }}
      >
        <View style={[styles.page, { backgroundColor: pageBackground }]}>
          <View style={[styles.content, transformStyle]}>
            {
              mode == 'threeLine'
                ? (
                  <ThreeLineMode
                    lines={lyricLines}
                    activeIndex={activeIndex}
                    fontScale={fontScale}
                    fontFamily={fontFamily}
                    projector={projector}
                    reduceMotion={shouldReduceMotion}
                    lineHeightScale={lineHeightScale}
                    themeColors={themeColors}
                  />
                )
                : (
                  <FlatList
                    ref={listRef}
                    data={lyricLines}
                    renderItem={renderItem}
                    keyExtractor={(item, index) => `${index}_${item.time}_${item.text}`}
                    initialNumToRender={shouldReduceMotion ? 8 : 16}
                    maxToRenderPerBatch={shouldReduceMotion ? 4 : 12}
                    windowSize={shouldReduceMotion ? 3 : 7}
                    updateCellsBatchingPeriod={shouldReduceMotion ? 80 : 40}
                    removeClippedSubviews={shouldReduceMotion}
                    contentContainerStyle={[
                      styles.listContent,
                      mode == 'teleprompter' ? styles.teleprompterContent : null,
                      shouldReduceMotion ? styles.listContentReduced : null,
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
                  <View style={styles.topBar}>
                    <TouchableOpacity style={styles.backBtn} onPress={() => { handleAction(() => { void pop(componentId) }) }}>
                      <Text color="#f6f6f6" size={15}>返回</Text>
                    </TouchableOpacity>
                    <View style={styles.titleWrap}>
                      <Text color="#f6f6f6" size={16}>歌词舞台</Text>
                      <Text color="rgba(255,255,255,0.66)" size={11} numberOfLines={2}>
                        {`${MODE_LABELS[mode]} / ${MIRROR_LABELS[mirror]} / ${COLOR_THEMES[colorTheme].label}${marqueeMode && !shouldReduceMotion ? ' / 跑马灯' : ''} / ${fontOption.label}`}
                      </Text>
                    </View>
                  </View>
                  <View style={[styles.controlPanel, isLandscape ? styles.controlPanelLandscape : null]}>
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
                        <Text color="#f6f6f6" size={14}>{marqueeMode ? '跑马灯开' : '跑马灯关'}</Text>
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
                      <TouchableOpacity style={[styles.actionBtn, isLandscape ? styles.actionBtnLandscapeThird : styles.actionBtnThird, { backgroundColor: themeColors.accent }]} onPress={() => { handleAction(() => { changeLineHeight(-0.08) }) }}>
                        <Text color="#f6f6f6" size={14}>行距-</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.actionBtn, isLandscape ? styles.actionBtnLandscapeThird : styles.actionBtnThird, { backgroundColor: themeColors.accent }]} onPress={() => { handleAction(() => { changeLineHeight(0.08) }) }}>
                        <Text color="#f6f6f6" size={14}>行距+</Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.panelLabel} color="rgba(255,255,255,0.58)" size={11}>投影</Text>
                    <View style={styles.controlGrid}>
                      <TouchableOpacity style={[styles.actionBtn, isLandscape ? styles.actionBtnLandscapeThird : styles.actionBtnThird, { backgroundColor: themeColors.accent }]} onPress={() => { handleAction(toggleProjector) }}>
                        <Text color="#f6f6f6" size={14}>{projector ? '投影开' : '投影关'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.actionBtn, isLandscape ? styles.actionBtnLandscapeThird : styles.actionBtnThird, { backgroundColor: themeColors.accent }]} onPress={() => { handleAction(togglePureBlackBackground) }}>
                        <Text color="#f6f6f6" size={13}>{usePureBlackBackground ? '纯黑底' : '主题底'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.actionBtn, isLandscape ? styles.actionBtnLandscapeThird : styles.actionBtnThird, { backgroundColor: themeColors.accent }]} onPress={() => { handleAction(toggleReduceMotion) }}>
                        <Text color="#f6f6f6" size={13}>{shouldReduceMotion ? '低耗开' : '低耗关'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.actionBtn, isLandscape ? styles.actionBtnLandscapeThird : styles.actionBtnThird, { backgroundColor: themeColors.accent }]} onPress={() => { handleAction(cycleRotate) }}>
                        <Text color="#f6f6f6" size={13}>{ROTATE_LABELS[rotateMode]}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </>
              )
              : null
          }
        </View>
      </TouchableOpacity>
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
    paddingTop: '22%',
    paddingBottom: '28%',
  },
  teleprompterContent: {
    paddingTop: '16%',
    paddingBottom: '52%',
  },
  listFooter: {
    height: 1,
  },
  lineWrap: {
    paddingVertical: 8,
    alignItems: 'center',
  },
  lineText: {
    textAlign: 'center',
    fontWeight: '700',
    width: '100%',
  },
  extendedText: {
    marginTop: 8,
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
    top: 10,
    left: 14,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backBtn: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  titleWrap: {
    flex: 1,
  },
  controlPanel: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 12,
    gap: 5,
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10,
  },
  controlPanelLandscape: {
    left: 12,
    right: 12,
    bottom: 10,
  },
  panelLabel: {
    paddingLeft: 4,
    letterSpacing: 1.2,
  },
  controlGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  actionBtn: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  actionBtnHalf: {
    width: '48.4%',
  },
  actionBtnThird: {
    width: '31.2%',
  },
  actionBtnLandscapeHalf: {
    width: '32%',
  },
  actionBtnLandscapeThird: {
    width: '24%',
  },
  emptyWrap: {
    minHeight: 240,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
