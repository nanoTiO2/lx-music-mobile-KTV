import { useEffect } from 'react'
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'

import {
  dispatchPromptSessionCommand,
  getPromptPreviewCues,
  type PromptAdvanceMode,
  type PromptAlignment,
  usePromptSession,
  type PromptMirrorMode,
} from '@/shared/prompt'
import { playHaptic, screenUnkeepAwake, screenkeepAwake, setImmersiveMode, setScreenOrientation } from '@/utils/nativeModules/utils'

const DEMO_DEVICES = [
  {
    id: 'display-main',
    name: '舞台主屏',
    transport: 'wifi_websocket',
    pingMs: 36,
    packetLossRate: 0.1,
    signalQuality: 'excellent',
    isPrimary: true,
    isConnected: true,
  },
  {
    id: 'display-backup',
    name: '返送副屏',
    transport: 'public_webrtc',
    pingMs: 82,
    packetLossRate: 0.8,
    signalQuality: 'good',
    isPrimary: false,
    isConnected: true,
  },
  {
    id: 'display-fallback',
    name: '蓝牙兜底',
    transport: 'bluetooth',
    pingMs: 145,
    packetLossRate: 2.8,
    signalQuality: 'fair',
    isPrimary: false,
    isConnected: false,
  },
] as const

const MIRROR_ORDER: PromptMirrorMode[] = ['none', 'horizontal', 'vertical', 'both']
const ALIGN_ORDER: PromptAlignment[] = ['left', 'center', 'right']

const transportLabelMap = {
  wifi_websocket: 'Wi-Fi',
  public_webrtc: '公网',
  bluetooth: '蓝牙',
} as const

const mirrorLabelMap = {
  none: '正常',
  horizontal: '左右镜像',
  vertical: '上下镜像',
  both: '双向镜像',
} as const

const modeLabelMap: Record<PromptAdvanceMode, string> = {
  sequential_tap: '顺序点按',
  jk_relay: 'JK 接力',
} as const

const displayModeLabelMap = {
  single: '单行',
  double: '双行',
  triple: '三行',
  marquee: '跑马灯',
} as const

const textAlignMap = {
  left: 'flex-start',
  center: 'center',
  right: 'flex-end',
} as const

const getMirrorTransform = (mirror: PromptMirrorMode) => {
  switch (mirror) {
    case 'horizontal':
      return [{ scaleX: -1 }]
    case 'vertical':
      return [{ scaleY: -1 }]
    case 'both':
      return [{ scaleX: -1 }, { scaleY: -1 }]
    default:
      return undefined
  }
}

const ActionButton = ({ label, active = false, onPress }: {
  label: string
  active?: boolean
  onPress: () => void
}) => (
  <Pressable
    style={[styles.actionButton, active ? styles.actionButtonActive : null]}
    onPress={onPress}
  >
    <Text style={styles.actionButtonText}>{label}</Text>
  </Pressable>
)

export default function PromptStage() {
  const { promptState: state, sourceLabel } = usePromptSession()
  const preview = getPromptPreviewCues(state)
  const stageTransform = getMirrorTransform(state.style.mirror)
  const visibleLines = state.style.mode == 'single'
    ? [preview.current]
    : state.style.mode == 'double'
      ? [preview.current, preview.next]
      : state.style.mode == 'triple'
        ? [preview.current, preview.next, preview.afterNext]
        : [preview.current]

  useEffect(() => {
    screenkeepAwake()
    void setImmersiveMode(true).catch(() => {})
    void setScreenOrientation('landscape').catch(() => {})
    return () => {
      screenUnkeepAwake()
      void setImmersiveMode(false).catch(() => {})
      void setScreenOrientation('auto').catch(() => {})
    }
  }, [])

  const commit = (command: Parameters<typeof dispatchPromptSessionCommand>[0], haptic: Parameters<typeof playHaptic>[0] = 'selection') => {
    dispatchPromptSessionCommand(command)
    void playHaptic(haptic).catch(() => {})
  }

  const cycleDisplayMode = () => {
    const order = ['single', 'double', 'triple', 'marquee'] as const
    const index = order.indexOf(state.style.mode)
    const next = order[(index + 1) % order.length]
    commit({ type: 'SET_STYLE', style: { mode: next } })
  }

  const cycleMirror = () => {
    const index = MIRROR_ORDER.indexOf(state.style.mirror)
    const next = MIRROR_ORDER[(index + 1) % MIRROR_ORDER.length]
    commit({ type: 'SET_STYLE', style: { mirror: next } })
  }

  const cycleAlign = () => {
    const index = ALIGN_ORDER.indexOf(state.style.align)
    const next = ALIGN_ORDER[(index + 1) % ALIGN_ORDER.length]
    commit({ type: 'SET_STYLE', style: { align: next } })
  }

  const adjustFontScale = (delta: number) => {
    const next = Math.max(0.8, Math.min(2.2, Number((state.style.fontScale + delta).toFixed(2))))
    commit({ type: 'SET_STYLE', style: { fontScale: next } })
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerBlock}>
            <Text style={styles.headerTitle}>可用展示端</Text>
            {DEMO_DEVICES.map(device => (
              <View key={device.id} style={styles.deviceCard}>
                <View style={styles.deviceCardHeader}>
                  <Text style={styles.deviceName}>{device.name}</Text>
                  <Text style={[styles.deviceBadge, device.isConnected ? styles.deviceBadgeOnline : styles.deviceBadgeOffline]}>
                    {device.isConnected ? '已连接' : '未连接'}
                  </Text>
                </View>
                <Text style={styles.deviceMeta}>
                  {transportLabelMap[device.transport]} / Ping {device.pingMs}ms / 丢包 {device.packetLossRate}%
                </Text>
                <Text style={styles.deviceMeta}>
                  信号 {device.signalQuality} {device.isPrimary ? '/ 主链路' : ''}
                </Text>
              </View>
            ))}
          </View>

          <View style={styles.headerBlock}>
            <Text style={styles.headerTitle}>会话状态</Text>
            <Text style={styles.sessionLine}>来源：{sourceLabel}</Text>
            <Text style={styles.sessionLine}>模式：{modeLabelMap[state.mode]}</Text>
            <Text style={styles.sessionLine}>显示：{displayModeLabelMap[state.style.mode]} / {mirrorLabelMap[state.style.mirror]}</Text>
            <Text style={styles.sessionLine}>对齐：{state.style.align} / 字号 {state.style.fontScale.toFixed(2)}x</Text>
            <Text style={styles.sessionLine}>状态：{state.displayState} / owner {state.ownerKey ?? 'none'}</Text>
            <Text style={styles.sessionLine}>Revision：{state.revision} / 下一句索引 {state.nextCueIndex + 1}</Text>
          </View>
        </View>

        <View style={styles.main}>
          <View style={styles.previewPanel}>
            <Text style={styles.sectionTitle}>展示端预览</Text>
            <View style={styles.stageCard}>
              <View style={[styles.stageViewport, stageTransform ? { transform: stageTransform } : null]}>
                {state.style.mode == 'marquee' ? (
                  <View style={[styles.marqueeWrap, { justifyContent: textAlignMap[state.style.align] }]}>
                    <Text style={[styles.marqueeText, { fontSize: 42 * state.style.fontScale, color: state.style.fontColor }]}>
                      {preview.current?.text || '等待上屏'}
                    </Text>
                  </View>
                ) : (
                  <View style={[styles.stageTextWrap, { alignItems: textAlignMap[state.style.align] }]}>
                    {visibleLines.map((cue, index) => (
                      <Text
                        key={`${cue?.id || 'empty'}-${index}`}
                        style={[
                          styles.stageLine,
                          index == 0 ? styles.stageLinePrimary : styles.stageLineSecondary,
                          {
                            fontSize: (index == 0 ? 40 : 28) * state.style.fontScale,
                            color: state.style.fontColor,
                            textAlign: state.style.align,
                          },
                        ]}
                      >
                        {cue?.text || (index == 0 ? '等待上屏' : '...')}
                      </Text>
                    ))}
                  </View>
                )}
              </View>
            </View>
          </View>

          <View style={styles.listPanel}>
            <Text style={styles.sectionTitle}>提词列表</Text>
            <ScrollView style={styles.cueList}>
              {state.document.cues.map((cue, index) => {
                const isActive = index == state.activeCueIndex
                const isNext = index == state.nextCueIndex
                return (
                  <View
                    key={cue.id}
                    style={[
                      styles.cueRow,
                      isActive ? styles.cueRowActive : null,
                      isNext ? styles.cueRowNext : null,
                    ]}
                  >
                    <Text style={styles.cueIndex}>{index + 1}</Text>
                    <View style={styles.cueTextWrap}>
                      <Text style={styles.cueText}>{cue.text}</Text>
                      <Text style={styles.cueMeta}>
                        当前句 {isActive ? '是' : '否'} / 下一句 {isNext ? '是' : '否'}
                      </Text>
                    </View>
                  </View>
                )
              })}
            </ScrollView>
          </View>
        </View>

        <View style={styles.controls}>
          <View style={styles.controlGroup}>
            <Text style={styles.sectionTitle}>模式与样式</Text>
            <View style={styles.actionRow}>
              <ActionButton label="顺序点按" active={state.mode == 'sequential_tap'} onPress={() => { commit({ type: 'SET_MODE', mode: 'sequential_tap' }) }} />
              <ActionButton label="JK 接力" active={state.mode == 'jk_relay'} onPress={() => { commit({ type: 'SET_MODE', mode: 'jk_relay' }) }} />
              <ActionButton label={displayModeLabelMap[state.style.mode]} onPress={cycleDisplayMode} />
              <ActionButton label={mirrorLabelMap[state.style.mirror]} onPress={cycleMirror} />
              <ActionButton label={`对齐 ${state.style.align}`} onPress={cycleAlign} />
              <ActionButton label="字-" onPress={() => { adjustFontScale(-0.1) }} />
              <ActionButton label="字+" onPress={() => { adjustFontScale(0.1) }} />
            </View>
          </View>

          <View style={styles.controlGroup}>
            <Text style={styles.sectionTitle}>操作控制区</Text>
            <View style={styles.actionRow}>
              <ActionButton label="上屏 / 下一句" onPress={() => { commit({ type: 'ADVANCE' }, 'song') }} />
              <ActionButton label="清屏" onPress={() => { commit({ type: 'CLEAR_SCREEN' }, 'pause') }} />
              <ActionButton label="撤销" onPress={() => { commit({ type: 'UNDO' }, 'prev') }} />
              <ActionButton label="J 按下" onPress={() => { commit({ type: 'KEY_DOWN', key: 'J' }, 'play') }} />
              <ActionButton label="J 松开" onPress={() => { commit({ type: 'KEY_UP', key: 'J' }, 'pause') }} />
              <ActionButton label="K 按下" onPress={() => { commit({ type: 'KEY_DOWN', key: 'K' }, 'play') }} />
              <ActionButton label="K 松开" onPress={() => { commit({ type: 'KEY_UP', key: 'K' }, 'pause') }} />
            </View>
          </View>
        </View>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#050608',
  },
  container: {
    flex: 1,
    backgroundColor: '#050608',
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 14,
  },
  header: {
    flexDirection: 'row',
    gap: 12,
    paddingTop: 10,
  },
  headerBlock: {
    flex: 1,
    backgroundColor: '#11141a',
    borderRadius: 18,
    padding: 14,
    gap: 8,
  },
  headerTitle: {
    color: '#f4f7fb',
    fontSize: 18,
    fontWeight: '700',
  },
  deviceCard: {
    backgroundColor: '#191f29',
    borderRadius: 14,
    padding: 10,
    gap: 4,
  },
  deviceCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  deviceName: {
    color: '#f4f7fb',
    fontSize: 15,
    fontWeight: '600',
  },
  deviceBadge: {
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  deviceBadgeOnline: {
    color: '#0d2b14',
    backgroundColor: '#7be495',
  },
  deviceBadgeOffline: {
    color: '#f4f7fb',
    backgroundColor: '#6a7079',
  },
  deviceMeta: {
    color: '#aab4c4',
    fontSize: 12,
  },
  sessionLine: {
    color: '#d6dde8',
    fontSize: 14,
  },
  main: {
    flex: 1,
    flexDirection: 'row',
    gap: 12,
  },
  previewPanel: {
    flex: 1.15,
    gap: 10,
  },
  listPanel: {
    width: 360,
    gap: 10,
  },
  sectionTitle: {
    color: '#f4f7fb',
    fontSize: 17,
    fontWeight: '700',
  },
  stageCard: {
    flex: 1,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#08090b',
    borderWidth: 1,
    borderColor: '#19202a',
  },
  stageViewport: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    paddingHorizontal: 36,
    paddingVertical: 24,
  },
  stageTextWrap: {
    gap: 14,
    width: '100%',
  },
  stageLine: {
    fontWeight: '700',
    textShadowColor: 'rgba(0, 0, 0, 0.88)',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 8,
  },
  stageLinePrimary: {
    opacity: 1,
  },
  stageLineSecondary: {
    opacity: 0.58,
  },
  marqueeWrap: {
    width: '100%',
  },
  marqueeText: {
    fontWeight: '800',
  },
  cueList: {
    flex: 1,
    backgroundColor: '#11141a',
    borderRadius: 18,
    padding: 10,
  },
  cueRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 14,
  },
  cueRowActive: {
    backgroundColor: 'rgba(113, 228, 141, 0.18)',
  },
  cueRowNext: {
    borderWidth: 1,
    borderColor: 'rgba(106, 163, 255, 0.6)',
  },
  cueIndex: {
    width: 30,
    color: '#8ba2c1',
    fontSize: 14,
    fontWeight: '700',
  },
  cueTextWrap: {
    flex: 1,
    gap: 4,
  },
  cueText: {
    color: '#f4f7fb',
    fontSize: 14,
    lineHeight: 20,
  },
  cueMeta: {
    color: '#93a0b3',
    fontSize: 11,
  },
  controls: {
    gap: 12,
  },
  controlGroup: {
    backgroundColor: '#11141a',
    borderRadius: 18,
    padding: 14,
    gap: 10,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  actionButton: {
    minWidth: 88,
    backgroundColor: '#1b2230',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2b3442',
    alignItems: 'center',
  },
  actionButtonActive: {
    backgroundColor: '#5c87ff',
    borderColor: '#8fb0ff',
  },
  actionButtonText: {
    color: '#f6f7fb',
    fontSize: 13,
    fontWeight: '700',
  },
})
