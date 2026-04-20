import { useEffect, useRef, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import Button from '@/components/common/Button'
import Text from '@/components/common/Text'
import FileSelect from '@/components/common/FileSelect'
import { createStyle, toast } from '@/utils/tools'
import {
  clearCompletedDownloadTasks,
  getDefaultDownloadSaveDir,
  getDownloadSaveDir,
  getDownloadTasks,
  pauseDownloadTask,
  removeDownloadTask,
  resetDownloadSaveDir,
  setDownloadSaveDir,
  startDownloadTask,
} from '@/core/download'


const TEXT = {
  title: '\u4e0b\u8f7d\u4e0e\u4fdd\u5b58',
  desc: '\u5728\u7ebf\u6b4c\u66f2\u957f\u6309\u83dc\u5355\u548c\u64ad\u653e\u9875\u90fd\u53ef\u4ee5\u628a\u6b4c\u66f2\u4fdd\u5b58\u5230\u672c\u5730\uff0c\u4efb\u52a1\u4f1a\u5728\u8fd9\u91cc\u663e\u793a\u5e76\u652f\u6301\u7ee7\u7eed\u3001\u6682\u505c\u3001\u91cd\u8bd5\u548c\u5220\u9664\u3002',
  saveDir: '\u4fdd\u5b58\u76ee\u5f55',
  selectDir: '\u9009\u62e9\u76ee\u5f55',
  defaultDir: '\u9ed8\u8ba4\u76ee\u5f55',
  taskList: '\u4efb\u52a1\u5217\u8868',
  clearDone: '\u6e05\u7406\u5df2\u5b8c\u6210',
  remove: '\u5220\u9664',
  noTasks: '\u6682\u65e0\u4e0b\u8f7d\u4efb\u52a1\u3002\u53ef\u4ee5\u4ece\u5728\u7ebf\u6b4c\u66f2\u957f\u6309\u83dc\u5355\u6216\u64ad\u653e\u8be6\u60c5\u9875\u628a\u5f53\u524d\u6b4c\u66f2\u4fdd\u5b58\u5230\u672c\u5730\u3002',
  dirUpdated: '\u4e0b\u8f7d\u76ee\u5f55\u5df2\u66f4\u65b0',
  dirReset: '\u5df2\u6062\u590d\u9ed8\u8ba4\u4e0b\u8f7d\u76ee\u5f55',
  startFailed: '\u4efb\u52a1\u542f\u52a8\u5931\u8d25',
  status: '\u72b6\u6001',
  quality: '\u8d28\u91cf',
  progress: '\u8fdb\u5ea6',
  pause: '\u6682\u505c',
  resume: '\u7ee7\u7eed',
  retry: '\u91cd\u8bd5',
  done: '\u5220\u9664',
  start: '\u5f00\u59cb',
}

const getActionLabel = (status) => {
  switch (status) {
    case 'run':
      return TEXT.pause
    case 'pause':
      return TEXT.resume
    case 'error':
      return TEXT.retry
    case 'completed':
      return TEXT.done
    case 'waiting':
    default:
      return TEXT.start
  }
}

export default () => {
  const fileSelectRef = useRef(null)
  const [saveDir, setSaveDir] = useState(getDownloadSaveDir())
  const [tasks, setTasks] = useState([])

  useEffect(() => {
    const loadTasks = () => {
      getDownloadTasks().then(taskList => {
        setTasks(taskList)
        setSaveDir(getDownloadSaveDir())
      }).catch(() => {})
    }
    loadTasks()
    global.app_event.on('downloadListUpdate', loadTasks)
    global.state_event.on('configUpdated', loadTasks)
    return () => {
      global.app_event.off('downloadListUpdate', loadTasks)
      global.state_event.off('configUpdated', loadTasks)
    }
  }, [])

  const handleSelectDir = () => {
    fileSelectRef.current?.show({
      title: TEXT.selectDir,
      dirOnly: true,
      isPersist: true,
    }, (path) => {
      setDownloadSaveDir(path)
      setSaveDir(path)
      toast(TEXT.dirUpdated)
    })
  }

  const handleResetDir = () => {
    resetDownloadSaveDir()
    setSaveDir(getDefaultDownloadSaveDir())
    toast(TEXT.dirReset)
  }

  const handleClearCompleted = () => {
    clearCompletedDownloadTasks().catch(() => {})
  }

  const handlePrimaryAction = (task) => {
    switch (task.status) {
      case 'run':
        pauseDownloadTask(task.id).catch(() => {})
        break
      case 'completed':
        removeDownloadTask(task.id).catch(() => {})
        break
      case 'pause':
      case 'error':
      case 'waiting':
      default:
        startDownloadTask(task.id).catch((err) => {
          const message = err instanceof Error ? err.message : TEXT.startFailed
          toast(message, 'long')
        })
        break
    }
  }

  const handleDelete = (taskId) => {
    removeDownloadTask(taskId).catch(() => {})
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text size={18} style={styles.title}>{TEXT.title}</Text>
        <Text style={styles.desc}>{TEXT.desc}</Text>

        <View style={styles.section}>
          <Text size={16} style={styles.sectionTitle}>{TEXT.saveDir}</Text>
          <Text selectable style={styles.path}>{saveDir}</Text>
          <View style={styles.actions}>
            <Button style={styles.actionBtn} onPress={handleSelectDir}>
              <Text>{TEXT.selectDir}</Text>
            </Button>
            <Button style={styles.actionBtn} onPress={handleResetDir}>
              <Text>{TEXT.defaultDir}</Text>
            </Button>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.row}>
            <Text size={16} style={styles.sectionTitle}>{TEXT.taskList}</Text>
            <Button onPress={handleClearCompleted}>
              <Text>{TEXT.clearDone}</Text>
            </Button>
          </View>
          {
            tasks.length
              ? tasks.map(task => (
                <View key={task.id} style={styles.taskItem}>
                  <Text numberOfLines={1} style={styles.taskTitle}>
                    {task.metadata.musicInfo.name} - {task.metadata.musicInfo.singer}
                  </Text>
                  <Text size={13} style={styles.taskMeta}>{TEXT.status}: {task.statusText || task.status}</Text>
                  <Text size={13} style={styles.taskMeta}>{TEXT.quality}: {task.metadata.quality} / {task.metadata.ext}</Text>
                  <Text size={13} style={styles.taskMeta}>
                    {TEXT.progress}: {Math.round((task.progress || 0) * 100)}%{task.speed ? ` / ${task.speed}` : ''}
                  </Text>
                  <Text size={13} selectable numberOfLines={2} style={styles.taskMeta}>{task.metadata.filePath}</Text>
                  <View style={styles.taskActions}>
                    <Button style={styles.taskActionBtn} onPress={() => { handlePrimaryAction(task) }}>
                      <Text>{getActionLabel(task.status)}</Text>
                    </Button>
                    {
                      task.status !== 'completed'
                        ? <Button style={styles.taskActionBtn} onPress={() => { handleDelete(task.id) }}>
                            <Text>{TEXT.remove}</Text>
                          </Button>
                        : null
                    }
                  </View>
                </View>
              ))
              : <Text style={styles.empty}>{TEXT.noTasks}</Text>
          }
        </View>
      </ScrollView>
      <FileSelect ref={fileSelectRef} />
    </View>
  )
}

const styles = createStyle({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 16,
  },
  title: {
    fontWeight: '600',
  },
  desc: {
    lineHeight: 22,
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  path: {
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    gap: 16,
  },
  actionBtn: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  taskItem: {
    gap: 4,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.15)',
  },
  taskTitle: {
    fontWeight: '600',
  },
  taskMeta: {
    lineHeight: 18,
  },
  taskActions: {
    flexDirection: 'row',
    gap: 16,
    paddingTop: 4,
  },
  taskActionBtn: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  empty: {
    lineHeight: 22,
  },
})
