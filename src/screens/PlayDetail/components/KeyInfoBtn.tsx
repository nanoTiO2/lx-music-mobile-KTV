import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { ScrollView, TouchableOpacity, View } from 'react-native'
import Popup, { type PopupType } from '@/components/common/Popup'
import Text from '@/components/common/Text'
import { BorderWidths } from '@/theme'
import { useTheme } from '@/store/theme/hook'
import { usePlayMusicInfo } from '@/store/player/hook'
import settingState from '@/store/setting/state'
import { scaleSizeW } from '@/utils/pixelRatio'
import { createStyle, toast } from '@/utils/tools'
import { getCachedMusicProfile, getMusicProfile, getMusicProfilePath, type MusicProfile } from '@/core/musicProfile'
import { getMusicUrl as getOnlineMusicUrl } from '@/core/music/online'
import { downloadFile, existsFile, mkdir, temporaryDirectoryPath } from '@/utils/fs'
import SettingPitch from './SettingPopup/settings/SettingPitch'
import SettingPlaybackRate from './SettingPopup/settings/SettingPlaybackRate'
import ButtonPrimary from '@/components/common/ButtonPrimary'
import { updateSetting } from '@/core/common'
import { useSettingValue } from '@/store/setting/hook'
import { setPitch, setPlaybackRate, updateMetaData } from '@/plugins/player'
import { setPlaybackRate as setLyricPlaybackRate } from '@/core/lyric'
import playerState from '@/store/player/state'
import { playHaptic } from '@/utils/haptics'
import Slider, { type SliderProps } from '@/components/common/Slider'
import { getSystemVolume, setSystemVolume } from '@/utils/nativeModules/utils'

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
const ANALYZE_MAX_MS = 90_000
const ANALYZE_TICK_MS = 250
const ONLINE_PROFILE_DIR = `${temporaryDirectoryPath}/lxmusic_profile_cache`

const sanitizeName = (name: string) => name.replace(/[\\/:*?"<>|]/g, '_').trim() || `track_${Date.now()}`

const getOnlineAnalyzePath = (musicInfo: LX.Music.MusicInfo) => {
  const ext = musicInfo.source == 'local' ? musicInfo.meta.ext.trim() || 'mp3' : 'mp3'
  return `${ONLINE_PROFILE_DIR}/${sanitizeName(`${musicInfo.source}_${musicInfo.id}_${musicInfo.name}_${musicInfo.singer}`)}.${ext}`
}

export default memo(({ direction }: {
  direction: 'vertical' | 'horizontal'
}) => {
  const theme = useTheme()
  const popupRef = useRef<PopupType>(null)
  const playMusicInfo = usePlayMusicInfo()
  const [visible, setVisible] = useState(false)
  const [profile, setProfile] = useState<MusicProfile | null>(null)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [etaMs, setEtaMs] = useState(0)
  const [onlineAnalyzePath, setOnlineAnalyzePath] = useState('')
  const [systemVolume, setSystemVolumeState] = useState(0.5)
  const [sliderValue, setSliderValue] = useState(50)
  const [isSystemVolumeSliding, setSystemVolumeSliding] = useState(false)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const mountedRef = useRef(true)
  const pitchSemitones = useSettingValue('player.pitchSemitones')
  const playbackRate = useSettingValue('player.playbackRate')
  const musicInfo = playMusicInfo.musicInfo && !('progress' in playMusicInfo.musicInfo) ? playMusicInfo.musicInfo : null
  const profilePath = useMemo(() => getMusicProfilePath(musicInfo) || onlineAnalyzePath, [musicInfo, onlineAnalyzePath])
  const latestProfilePathRef = useRef(profilePath)

  useEffect(() => {
    latestProfilePathRef.current = profilePath
  }, [profilePath])

  useEffect(() => {
    setOnlineAnalyzePath('')
  }, [musicInfo?.id])

  useEffect(() => {
    let canceled = false
    setProfile(null)
    if (!profilePath) return
    void getCachedMusicProfile(profilePath).then(result => {
      if (canceled) return
      if (result) setProfile(result)
    })
    return () => {
      canceled = true
    }
  }, [profilePath])

  useEffect(() => {
    return () => {
      mountedRef.current = false
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!visible) return
    void getSystemVolume().then(value => {
      const nextValue = Math.max(0, Math.min(1, value))
      setSystemVolumeState(nextValue)
      setSliderValue(Math.round(nextValue * 100))
    }).catch(() => {})
  }, [visible])

  if (!musicInfo) return null

  const btnStyle = BTN_SIZES[direction]
  const label = loading ? '分析中' : profile?.majorKey || '调号'
  const bpmText = profile ? `${Math.round(profile.bpm)} BPM` : '未分析'

  const ensureAnalyzePath = async() => {
    const localPath = getMusicProfilePath(musicInfo)
    if (localPath) return localPath
    const onlineMusicInfo = musicInfo as LX.Music.MusicInfoOnline
    await mkdir(ONLINE_PROFILE_DIR).catch(() => {})
    const tempPath = getOnlineAnalyzePath(musicInfo)
    if (!await existsFile(tempPath).catch(() => false)) {
      const url = await getOnlineMusicUrl({
        musicInfo: onlineMusicInfo,
        quality: settingState.setting['player.playQuality'],
        isRefresh: true,
        allowToggleSource: true,
        onToggleSource: () => {},
      })
      await downloadFile(url, tempPath, {
        connectionTimeout: 20000,
        readTimeout: 30000,
      }).promise
    }
    setOnlineAnalyzePath(tempPath)
    return tempPath
  }

  const handleAnalyze = () => {
    if (loading) return
    setLoading(true)
    setProgress(0.02)
    setEtaMs(ANALYZE_MAX_MS)
    const startTime = Date.now()
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime
      const nextProgress = Math.min(0.96, elapsed / ANALYZE_MAX_MS)
      setProgress(nextProgress)
      setEtaMs(Math.max(0, ANALYZE_MAX_MS - elapsed))
    }, ANALYZE_TICK_MS)
    void ensureAnalyzePath().then(async taskPath => {
      latestProfilePathRef.current = taskPath
      const result = await getMusicProfile(taskPath)
      if (!mountedRef.current || latestProfilePathRef.current != taskPath) return
      if (timerRef.current) clearInterval(timerRef.current)
      timerRef.current = null
      setProgress(1)
      setEtaMs(0)
      setProfile(result)
      playHaptic('success')
      toast(getMusicProfilePath(musicInfo) ? '分析完成，结果已写入歌词/缓存' : '分析完成，已缓存在线歌曲调号')
    }).catch(err => {
      if (!mountedRef.current) return
      if (timerRef.current) clearInterval(timerRef.current)
      timerRef.current = null
      setProgress(0)
      setEtaMs(0)
      toast((err as Error).message || '调号分析失败')
    }).finally(() => {
      if (!mountedRef.current) return
      setLoading(false)
    })
  }

  const handleOpen = () => {
    if (visible) popupRef.current?.setVisible(true)
    else {
      setVisible(true)
      requestAnimationFrame(() => {
        popupRef.current?.setVisible(true)
      })
    }
  }

  const etaText = etaMs > 0 ? `预计剩余 ${Math.max(1, Math.ceil(etaMs / 1000))} 秒` : '即将完成'

  const handlePitchStep = (delta: number) => {
    const nextValue = Math.max(-12, Math.min(12, pitchSemitones + delta))
    if (nextValue == pitchSemitones) return
    playHaptic('selection')
    void setPitch(nextValue).then(() => {
      updateSetting({ 'player.pitchSemitones': nextValue })
    }).catch(() => {
      toast('升降调设置失败')
    })
  }

  const handlePitchReset = () => {
    if (pitchSemitones == 0) return
    playHaptic('selection')
    void setPitch(0).then(() => {
      updateSetting({ 'player.pitchSemitones': 0 })
    }).catch(() => {
      toast('升降调设置失败')
    })
  }

  const handlePlaybackRateStep = (delta: number) => {
    const nextRate = Math.max(0.6, Math.min(2, parseFloat((playbackRate + delta).toFixed(2))))
    if (nextRate == playbackRate) return
    playHaptic('selection')
    void setPlaybackRate(nextRate).then(() => {
      void setLyricPlaybackRate(nextRate)
      void updateMetaData(playerState.musicInfo, playerState.isPlay, playerState.lastLyric, true)
      updateSetting({ 'player.playbackRate': nextRate })
    }).catch(() => {
      toast('播放速率设置失败')
    })
  }

  const handlePlaybackRateReset = () => {
    if (playbackRate == 1) return
    playHaptic('selection')
    void setPlaybackRate(1).then(() => {
      void setLyricPlaybackRate(1)
      void updateMetaData(playerState.musicInfo, playerState.isPlay, playerState.lastLyric, true)
      updateSetting({ 'player.playbackRate': 1 })
    }).catch(() => {
      toast('播放速率设置失败')
    })
  }

  const applySystemVolume = (value: number) => {
    const nextValue = Math.max(0, Math.min(100, Math.round(value)))
    setSliderValue(nextValue)
    setSystemVolumeSliding(false)
    playHaptic('selection')
    void setSystemVolume(nextValue / 100).then(result => {
      const actualValue = Math.max(0, Math.min(1, result))
      setSystemVolumeState(actualValue)
      setSliderValue(Math.round(actualValue * 100))
    }).catch(() => {
      toast('系统音量调整失败')
    })
  }

  const handleSystemVolumeStart: SliderProps['onSlidingStart'] = () => {
    setSystemVolumeSliding(true)
  }

  const handleSystemVolumeChange: SliderProps['onValueChange'] = value => {
    setSliderValue(Math.round(value))
  }

  const handleSystemVolumeComplete: SliderProps['onSlidingComplete'] = value => {
    playHaptic('dragCommit')
    applySystemVolume(value)
  }

  const stepSystemVolume = (delta: number) => {
    applySystemVolume((isSystemVolumeSliding ? sliderValue : Math.round(systemVolume * 100)) + delta)
  }

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
        <Text
          numberOfLines={1}
          size={direction == 'vertical' ? 11 : 12}
          color={loading ? theme['c-500'] : theme['c-font-label']}
        >
          {label}
        </Text>
      </TouchableOpacity>
      {visible ? (
        <Popup ref={popupRef} title="调号 / 节拍">
          <ScrollView style={styles.popup}>
            <View onStartShouldSetResponder={() => true}>
              <View style={{ ...styles.row, borderBottomColor: theme['c-border-background'] }}>
                <Text style={styles.rowIndex}>1.</Text>
                <Text style={styles.rowLabel}>调号</Text>
                <Text color={theme['c-font-label']}>{profile?.majorKey || '未分析'}</Text>
              </View>
              <View style={{ ...styles.row, borderBottomColor: theme['c-border-background'] }}>
                <Text style={styles.rowIndex}>2.</Text>
                <Text style={styles.rowLabel}>拍速</Text>
                <Text color={theme['c-font-label']}>{bpmText}</Text>
              </View>
              <View style={{ ...styles.row, borderBottomColor: theme['c-border-background'] }}>
                <Text style={styles.rowIndex}>3.</Text>
                <Text style={styles.rowLabel}>分析</Text>
                <ButtonPrimary disabled={loading} onPress={handleAnalyze}>{loading ? '分析中' : '手动分析并缓存'}</ButtonPrimary>
              </View>
              {
                loading
                  ? (
                    <View style={{ ...styles.progressWrap, borderBottomColor: theme['c-border-background'] }}>
                      <View style={styles.progressBarBg}>
                        <View style={{ ...styles.progressBarActive, width: `${Math.max(4, Math.round(progress * 100))}%`, backgroundColor: theme['c-primary-font-active'] }} />
                      </View>
                      <Text size={12} color={theme['c-font-label']}>{`${Math.round(progress * 100)}% · ${etaText}`}</Text>
                    </View>
                  )
                  : null
              }
              <View style={{ ...styles.row, borderBottomColor: theme['c-border-background'] }}>
                <Text style={styles.rowIndex}>4.</Text>
                <Text style={styles.rowLabel}>升降调</Text>
                <Text color={theme['c-font-label']}>{`${pitchSemitones > 0 ? '+' : ''}${pitchSemitones} st`}</Text>
              </View>
              <View style={styles.quickBtnRow}>
                <TouchableOpacity style={styles.quickBtn} onPress={() => { handlePitchStep(-1) }}>
                  <Text color="#f6f6f6" size={13}>-1</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.quickBtn} onPress={handlePitchReset}>
                  <Text color="#f6f6f6" size={13}>复位</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.quickBtn} onPress={() => { handlePitchStep(1) }}>
                  <Text color="#f6f6f6" size={13}>+1</Text>
                </TouchableOpacity>
              </View>
              <SettingPitch />
              <View style={{ ...styles.row, borderBottomColor: theme['c-border-background'] }}>
                <Text style={styles.rowIndex}>5.</Text>
                <Text style={styles.rowLabel}>播放速率</Text>
                <Text color={theme['c-font-label']}>{`${playbackRate.toFixed(2)}x`}</Text>
              </View>
              <View style={styles.quickBtnRow}>
                <TouchableOpacity style={styles.quickBtn} onPress={() => { handlePlaybackRateStep(-0.1) }}>
                  <Text color="#f6f6f6" size={13}>-0.1</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.quickBtn} onPress={handlePlaybackRateReset}>
                  <Text color="#f6f6f6" size={13}>复位</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.quickBtn} onPress={() => { handlePlaybackRateStep(0.1) }}>
                  <Text color="#f6f6f6" size={13}>+0.1</Text>
                </TouchableOpacity>
              </View>
              <SettingPlaybackRate />
              <View style={{ ...styles.row, borderBottomColor: theme['c-border-background'] }}>
                <Text style={styles.rowIndex}>6.</Text>
                <Text style={styles.rowLabel}>系统音量</Text>
                <Text color={theme['c-font-label']}>{`${isSystemVolumeSliding ? sliderValue : Math.round(systemVolume * 100)}%`}</Text>
              </View>
              <View style={styles.quickBtnRow}>
                <TouchableOpacity style={styles.quickBtn} onPress={() => { stepSystemVolume(-8) }}>
                  <Text color="#f6f6f6" size={13}>-8%</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.quickBtn} onPress={() => { applySystemVolume(50) }}>
                  <Text color="#f6f6f6" size={13}>50%</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.quickBtn} onPress={() => { stepSystemVolume(8) }}>
                  <Text color="#f6f6f6" size={13}>+8%</Text>
                </TouchableOpacity>
              </View>
              <Slider
                minimumValue={0}
                maximumValue={100}
                onSlidingStart={handleSystemVolumeStart}
                onValueChange={handleSystemVolumeChange}
                onSlidingComplete={handleSystemVolumeComplete}
                step={1}
                value={isSystemVolumeSliding ? sliderValue : Math.round(systemVolume * 100)}
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
  rowIndex: {
    width: 22,
  },
  rowLabel: {
    flex: 1,
  },
  progressWrap: {
    paddingTop: 10,
    paddingBottom: 10,
    borderBottomWidth: BorderWidths.normal,
    gap: 8,
  },
  progressBarBg: {
    height: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  progressBarActive: {
    height: '100%',
    borderRadius: 999,
  },
  quickBtnRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    marginBottom: 8,
  },
  quickBtn: {
    flex: 1,
    minHeight: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
})
