import Clipboard from '@react-native-clipboard/clipboard'
import { useMemo, useRef, useState } from 'react'
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'

import ChoosePath, { type ChoosePathType } from '@/components/common/ChoosePath'
import { pushPromptReceiverScreen, pushPromptStageScreen } from '@/navigation/navigation'
import {
  connectPromptTransport,
  dispatchPromptSessionCommand,
  disconnectPromptTransport,
  getPromptPreviewCues,
  loadPromptSessionFromPaste,
  loadPromptSessionFromText,
  resetPromptSessionToDemo,
  setPromptSessionId,
  setPromptTransportHost,
  setPromptTransportRole,
  usePromptSession,
} from '@/shared/prompt'
import { readFile } from '@/utils/fs'
import { playHaptic } from '@/utils/nativeModules/utils'
import { toast } from '@/utils/tools'

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

const getFileName = (path: string) => {
  const normalized = path.replace(/\\/g, '/')
  const lastSlash = normalized.lastIndexOf('/')
  return lastSlash > -1 ? normalized.slice(lastSlash + 1) : normalized
}

export default function PromptControl({ componentId }: { componentId: string }) {
  const {
    promptState,
    sourceLabel,
    sourcePath,
    transportLabel,
    transportHost,
    sessionId,
    connectionState,
    lastError,
    lastEventAt,
  } = usePromptSession()
  const [pickerVisible, setPickerVisible] = useState(false)
  const [draftText, setDraftText] = useState('')
  const choosePathRef = useRef<ChoosePathType>(null)
  const preview = getPromptPreviewCues(promptState)

  const summaryLines = useMemo(() => {
    return [
      `文档：${promptState.document.title}`,
      `来源：${sourceLabel}`,
      `模式：${promptState.mode}`,
      `显示：${promptState.style.mode} / ${promptState.style.align}`,
      `状态：${promptState.displayState} / owner ${promptState.ownerKey ?? 'none'}`,
      `链路：${transportLabel}`,
    ]
  }, [promptState, sourceLabel, transportLabel])

  const commit = (command: Parameters<typeof dispatchPromptSessionCommand>[0], haptic: Parameters<typeof playHaptic>[0] = 'selection') => {
    dispatchPromptSessionCommand(command)
    void playHaptic(haptic).catch(() => {})
  }

  const handleOpenStage = () => {
    void playHaptic('next').catch(() => {})
    pushPromptStageScreen(componentId)
  }

  const handleOpenReceiver = () => {
    void playHaptic('next').catch(() => {})
    pushPromptReceiverScreen(componentId)
  }

  const handleImportPath = async(path: string) => {
    try {
      const raw = await readFile(path)
      const fileName = getFileName(path) || '提词文档.txt'
      loadPromptSessionFromText(raw, fileName, path)
      setDraftText(raw)
      void playHaptic('success').catch(() => {})
      toast(`已导入 ${fileName}`)
    } catch (error: any) {
      toast(`导入失败：${error?.message ?? 'unknown error'}`, 'long')
    }
  }

  const showFilePicker = () => {
    if (!pickerVisible) setPickerVisible(true)
    requestAnimationFrame(() => {
      choosePathRef.current?.show({
        title: '选择提词文档',
        dirOnly: false,
        filter: ['lrc', 'srt', 'ass', 'txt'],
      })
    })
  }

  const handleImportClipboard = async() => {
    try {
      const text = await Clipboard.getString()
      if (!text.trim()) {
        toast('剪贴板为空', 'long')
        return
      }
      loadPromptSessionFromPaste(text, '剪贴板提词')
      setDraftText(text)
      void playHaptic('success').catch(() => {})
      toast('已从剪贴板导入')
    } catch (error: any) {
      toast(`读取剪贴板失败：${error?.message ?? 'unknown error'}`, 'long')
    }
  }

  const handleImportDraft = () => {
    if (!draftText.trim()) {
      toast('请输入提词文本', 'long')
      return
    }
    loadPromptSessionFromPaste(draftText, '手动录入提词')
    void playHaptic('success').catch(() => {})
    toast('已加载手动录入文本')
  }

  const handleConnectSocket = async() => {
    try {
      setPromptTransportRole('controller')
      await connectPromptTransport()
      toast('提词 WebSocket 已连接')
    } catch (error: any) {
      toast(`提词连接失败：${error?.message ?? 'unknown error'}`, 'long')
    }
  }

  const handleDisconnectSocket = () => {
    disconnectPromptTransport()
    toast('已切回本地 loopback')
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerCard}>
            <Text style={styles.title}>提词控制端原型</Text>
            <Text style={styles.subtitle}>当前支持本地 loopback 和 WebSocket 客户端推送。控制端负责发送整份提词快照，被控端或展示端可按同一 session 接入。</Text>
          </View>
          <View style={styles.headerCard}>
            {summaryLines.map(line => <Text key={line} style={styles.metaLine}>{line}</Text>)}
            <Text style={styles.metaLine}>连接：{connectionState}</Text>
            <Text style={styles.metaLine}>会话号：{sessionId}</Text>
            <Text style={styles.metaLine}>文档句数：{promptState.document.cues.length}</Text>
            <Text style={styles.metaLine}>最后事件：{lastEventAt}</Text>
            {sourcePath ? <Text style={styles.metaPath}>{sourcePath}</Text> : null}
            {lastError ? <Text style={styles.metaError}>错误：{lastError}</Text> : null}
          </View>
        </View>

        <View style={styles.main}>
          <View style={styles.leftColumn}>
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>链路接入</Text>
              <TextInput
                style={styles.inlineInput}
                placeholder="WebSocket 地址，例如 ws://192.168.1.20:9528/prompt"
                placeholderTextColor="#7e8897"
                value={transportHost}
                onChangeText={setPromptTransportHost}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TextInput
                style={styles.inlineInput}
                placeholder="会话号，例如 prompt-demo"
                placeholderTextColor="#7e8897"
                value={sessionId}
                onChangeText={setPromptSessionId}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <View style={styles.actionRow}>
                <ActionButton label="连接 WebSocket" onPress={() => { void handleConnectSocket() }} />
                <ActionButton label="断开链路" onPress={handleDisconnectSocket} />
                <ActionButton label="打开展示端" onPress={handleOpenStage} />
                <ActionButton label="打开被控端" onPress={handleOpenReceiver} />
              </View>
            </View>

            <View style={styles.panel}>
              <Text style={styles.panelTitle}>文档输入</Text>
              <View style={styles.actionRow}>
                <ActionButton label="加载演示" onPress={resetPromptSessionToDemo} />
                <ActionButton label="导入文件" onPress={showFilePicker} />
                <ActionButton label="剪贴板导入" onPress={() => { void handleImportClipboard() }} />
              </View>
              <TextInput
                style={styles.textInput}
                multiline
                numberOfLines={9}
                placeholder="可直接粘贴提词文本，每行一句；也可粘入 SRT / ASS / LRC 原文。"
                placeholderTextColor="#7e8897"
                value={draftText}
                onChangeText={setDraftText}
                textAlignVertical="top"
              />
              <View style={styles.actionRow}>
                <ActionButton label="加载手动文本" onPress={handleImportDraft} />
              </View>
            </View>

            <View style={styles.panel}>
              <Text style={styles.panelTitle}>控制动作</Text>
              <View style={styles.actionRow}>
                <ActionButton label="顺序点按" active={promptState.mode == 'sequential_tap'} onPress={() => { commit({ type: 'SET_MODE', mode: 'sequential_tap' }) }} />
                <ActionButton label="JK 接力" active={promptState.mode == 'jk_relay'} onPress={() => { commit({ type: 'SET_MODE', mode: 'jk_relay' }) }} />
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

          <View style={styles.rightColumn}>
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>会话预览</Text>
              <View style={styles.previewCard}>
                <Text style={styles.previewCurrent}>{preview.current?.text || '等待上屏'}</Text>
                <Text style={styles.previewNext}>下一句：{preview.next?.text || '无'}</Text>
                <Text style={styles.previewAfter}>后一句：{preview.afterNext?.text || '无'}</Text>
              </View>
            </View>

            <View style={[styles.panel, styles.listPanel]}>
              <Text style={styles.panelTitle}>提词队列</Text>
              <ScrollView style={styles.listScroll}>
                {promptState.document.cues.map((cue, index) => {
                  const isActive = index == promptState.activeCueIndex
                  const isNext = index == promptState.nextCueIndex
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
                          {cue.startMs != null ? `开始 ${cue.startMs}ms` : '无时间轴'}
                        </Text>
                      </View>
                    </View>
                  )
                })}
              </ScrollView>
            </View>
          </View>
        </View>
        {pickerVisible ? <ChoosePath ref={choosePathRef} onConfirm={(path) => { void handleImportPath(path) }} /> : null}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#071018',
  },
  container: {
    flex: 1,
    backgroundColor: '#071018',
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    gap: 12,
    paddingTop: 10,
  },
  headerCard: {
    flex: 1,
    backgroundColor: '#111a24',
    borderRadius: 18,
    padding: 14,
    gap: 6,
  },
  title: {
    color: '#f6fbff',
    fontSize: 22,
    fontWeight: '800',
  },
  subtitle: {
    color: '#a9bac8',
    fontSize: 13,
    lineHeight: 20,
  },
  metaLine: {
    color: '#d8e4ee',
    fontSize: 13,
  },
  metaPath: {
    color: '#7fa8d6',
    fontSize: 11,
  },
  metaError: {
    color: '#f4a3a3',
    fontSize: 12,
  },
  main: {
    flex: 1,
    flexDirection: 'row',
    gap: 12,
  },
  leftColumn: {
    flex: 1.15,
    gap: 12,
  },
  rightColumn: {
    width: 380,
    gap: 12,
  },
  panel: {
    backgroundColor: '#111a24',
    borderRadius: 20,
    padding: 14,
    gap: 12,
  },
  listPanel: {
    flex: 1,
  },
  panelTitle: {
    color: '#f6fbff',
    fontSize: 18,
    fontWeight: '700',
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  actionButton: {
    minWidth: 96,
    backgroundColor: '#1d2936',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2b3b4d',
    alignItems: 'center',
  },
  actionButtonActive: {
    backgroundColor: '#2f7ef7',
    borderColor: '#7db0ff',
  },
  actionButtonText: {
    color: '#f6fbff',
    fontSize: 13,
    fontWeight: '700',
  },
  textInput: {
    minHeight: 220,
    borderRadius: 16,
    backgroundColor: '#0a1118',
    borderWidth: 1,
    borderColor: '#24313f',
    color: '#f6fbff',
    fontSize: 14,
    lineHeight: 21,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  inlineInput: {
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: '#0a1118',
    borderWidth: 1,
    borderColor: '#24313f',
    color: '#f6fbff',
    fontSize: 13,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  previewCard: {
    minHeight: 160,
    borderRadius: 18,
    backgroundColor: '#040608',
    borderWidth: 1,
    borderColor: '#1f2c38',
    padding: 18,
    justifyContent: 'center',
    gap: 12,
  },
  previewCurrent: {
    color: '#f6fbff',
    fontSize: 28,
    fontWeight: '800',
  },
  previewNext: {
    color: '#97bfd7',
    fontSize: 16,
  },
  previewAfter: {
    color: '#6f8091',
    fontSize: 14,
  },
  listScroll: {
    flex: 1,
  },
  cueRow: {
    flexDirection: 'row',
    gap: 10,
    borderRadius: 14,
    backgroundColor: '#17212c',
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginBottom: 8,
  },
  cueRowActive: {
    backgroundColor: 'rgba(105, 223, 135, 0.18)',
  },
  cueRowNext: {
    borderWidth: 1,
    borderColor: 'rgba(97, 162, 255, 0.72)',
  },
  cueIndex: {
    width: 30,
    color: '#8ba6bd',
    fontSize: 14,
    fontWeight: '700',
  },
  cueTextWrap: {
    flex: 1,
    gap: 4,
  },
  cueText: {
    color: '#f6fbff',
    fontSize: 14,
    lineHeight: 20,
  },
  cueMeta: {
    color: '#90a0ae',
    fontSize: 11,
  },
})
