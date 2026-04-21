import { useCallback, useEffect } from 'react'
import {
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'

import { pop } from '@/navigation/utils'
import { useNavigationComponentDidDisappear } from '@/navigation/hooks'
import {
  connectPromptTransport,
  disconnectPromptTransport,
  getPromptPreviewCues,
  setPromptSessionId,
  setPromptTransportHost,
  setPromptTransportRole,
  usePromptSession,
} from '@/shared/prompt'
import { playHaptic, screenUnkeepAwake, screenkeepAwake, setImmersiveMode, setScreenOrientation } from '@/utils/nativeModules/utils'

const restoreSystemUi = () => {
  screenUnkeepAwake()
  void setScreenOrientation('auto').catch(() => {})
  void setImmersiveMode(false).catch(() => {})
}

export default function PromptReceiver({ componentId }: { componentId: string }) {
  const {
    promptState,
    sourceLabel,
    transportLabel,
    transportHost,
    sessionId,
    connectionState,
    lastError,
    lastEventAt,
  } = usePromptSession()
  const preview = getPromptPreviewCues(promptState)

  const handleExit = useCallback(() => {
    restoreSystemUi()
    void playHaptic('pause').catch(() => {})
    requestAnimationFrame(() => {
      void pop(componentId)
    })
  }, [componentId])

  useEffect(() => {
    screenkeepAwake()
    void setImmersiveMode(true).catch(() => {})
    void setScreenOrientation('landscape').catch(() => {})
    return () => {
      restoreSystemUi()
    }
  }, [])

  useNavigationComponentDidDisappear(componentId, restoreSystemUi)

  const handleConnect = async() => {
    try {
      setPromptTransportRole('receiver')
      await connectPromptTransport()
      void playHaptic('success').catch(() => {})
    } catch {}
  }

  const handleDisconnect = () => {
    disconnectPromptTransport()
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.topBar}>
          <View style={styles.statusCard}>
            <Text style={styles.statusTitle}>被控端</Text>
            <Text style={styles.statusLine}>链路：{transportLabel}</Text>
            <Text style={styles.statusLine}>来源：{sourceLabel}</Text>
            <Text style={styles.statusLine}>模式：{promptState.mode}</Text>
            <Text style={styles.statusLine}>状态：{promptState.displayState} / {connectionState}</Text>
            {lastError ? <Text style={styles.statusError}>错误：{lastError}</Text> : null}
          </View>
          <Pressable style={styles.exitButton} onPress={handleExit}>
            <Text style={styles.exitButtonText}>退出被控端</Text>
          </Pressable>
        </View>

        <View style={styles.connectCard}>
          <TextInput
            style={styles.connectInput}
            placeholder="WebSocket 地址"
            placeholderTextColor="#73859a"
            value={transportHost}
            onChangeText={setPromptTransportHost}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            style={styles.connectInput}
            placeholder="会话号"
            placeholderTextColor="#73859a"
            value={sessionId}
            onChangeText={setPromptSessionId}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={styles.connectActions}>
            <Pressable style={styles.connectButton} onPress={() => { void handleConnect() }}>
              <Text style={styles.connectButtonText}>连接被控链路</Text>
            </Pressable>
            <Pressable style={styles.disconnectButton} onPress={handleDisconnect}>
              <Text style={styles.disconnectButtonText}>断开</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.stage}>
          <Text style={styles.currentLabel}>当前句</Text>
          <Text style={styles.currentText}>{preview.current?.text || '等待控制端上屏'}</Text>

          <View style={styles.nextBlock}>
            <Text style={styles.nextLabel}>下一句</Text>
            <Text style={styles.nextText}>{preview.next?.text || '暂无'}</Text>
          </View>
        </View>

        <View style={styles.bottomBar}>
          <Text style={styles.bottomText}>Revision {promptState.revision}</Text>
          <Text style={styles.bottomText}>下一句索引 {promptState.nextCueIndex + 1}</Text>
          <Text style={styles.bottomText}>最后事件 {lastEventAt}</Text>
        </View>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#000',
  },
  container: {
    flex: 1,
    backgroundColor: '#000',
    paddingHorizontal: 16,
    paddingVertical: 12,
    justifyContent: 'space-between',
    gap: 16,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  statusCard: {
    backgroundColor: 'rgba(18, 25, 34, 0.88)',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  statusTitle: {
    color: '#f5f7fa',
    fontSize: 18,
    fontWeight: '700',
  },
  statusLine: {
    color: '#b4c2d1',
    fontSize: 13,
  },
  statusError: {
    color: '#f2b0b0',
    fontSize: 12,
  },
  exitButton: {
    backgroundColor: 'rgba(194, 64, 64, 0.9)',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  exitButtonText: {
    color: '#fff8f8',
    fontSize: 14,
    fontWeight: '700',
  },
  connectCard: {
    backgroundColor: 'rgba(13, 17, 24, 0.94)',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  connectInput: {
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: 'rgba(27, 35, 45, 0.96)',
    borderWidth: 1,
    borderColor: '#223242',
    color: '#f3f7fb',
    fontSize: 13,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  connectActions: {
    flexDirection: 'row',
    gap: 10,
  },
  connectButton: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: '#2f7ef7',
    paddingVertical: 11,
    alignItems: 'center',
  },
  connectButtonText: {
    color: '#f7fbff',
    fontSize: 13,
    fontWeight: '700',
  },
  disconnectButton: {
    minWidth: 96,
    borderRadius: 12,
    backgroundColor: 'rgba(68, 76, 87, 0.9)',
    paddingVertical: 11,
    alignItems: 'center',
  },
  disconnectButtonText: {
    color: '#eef4fa',
    fontSize: 13,
    fontWeight: '700',
  },
  stage: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 24,
    paddingHorizontal: 28,
  },
  currentLabel: {
    color: '#8ea7c1',
    fontSize: 16,
    letterSpacing: 1,
  },
  currentText: {
    color: '#f6f8fb',
    fontSize: 42,
    lineHeight: 58,
    fontWeight: '800',
    textAlign: 'center',
  },
  nextBlock: {
    width: '100%',
    borderRadius: 20,
    backgroundColor: 'rgba(19, 25, 31, 0.88)',
    paddingHorizontal: 20,
    paddingVertical: 18,
    gap: 10,
  },
  nextLabel: {
    color: '#7ea4c6',
    fontSize: 15,
  },
  nextText: {
    color: '#9ab0c5',
    fontSize: 26,
    lineHeight: 36,
    textAlign: 'center',
    fontWeight: '600',
  },
  bottomBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
  },
  bottomText: {
    color: '#6d7b8b',
    fontSize: 12,
  },
})
