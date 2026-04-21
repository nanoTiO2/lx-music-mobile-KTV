import type { CueDocument, PromptCue } from './types'

const createCueId = (prefix: string, index: number) => `${prefix}-${index + 1}`

const nowIso = () => new Date().toISOString()

const trimCueText = (text: string) => {
  return text
    .replace(/\{.*?\}/g, '')
    .replace(/\\N/gi, '\n')
    .replace(/\r/g, '')
    .trim()
}

const finalizeDocument = (
  title: string,
  sourceType: CueDocument['sourceType'],
  rawText: string,
  cues: PromptCue[],
): CueDocument => ({
  id: `doc-${sourceType}-${Date.now()}`,
  title,
  sourceType,
  rawText,
  createdAt: nowIso(),
  cues: cues.filter(cue => cue.text.trim()),
})

const parseTimeToMs = (value: string) => {
  const normalized = value.trim().replace(',', '.')
  const match = normalized.match(/(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)/)
  if (!match) return null
  const hours = Number(match[1] || 0)
  const minutes = Number(match[2] || 0)
  const seconds = Number(match[3] || 0)
  return Math.round((((hours * 60) + minutes) * 60 + seconds) * 1000)
}

export const parsePlainTextDocument = (text: string, title = '未命名提词文档', sourceType: CueDocument['sourceType'] = 'txt'): CueDocument => {
  const cues = text
    .split(/\n\s*\n|\r\n\s*\r\n|\r/g)
    .flatMap(block => block.split(/\r?\n/))
    .map((line, index) => ({
      id: createCueId('txt', index),
      text: line.trim(),
      sourceLine: index + 1,
    }))
    .filter(item => item.text)

  return finalizeDocument(title, sourceType, text, cues)
}

export const parseLrcDocument = (text: string, title = 'LRC 提词文档'): CueDocument => {
  const cues: PromptCue[] = []
  const tagPattern = /\[(\d{1,2}:\d{2}(?:[.:]\d{1,3})?)\]/g

  text.split(/\r?\n/).forEach((line, lineIndex) => {
    const tags = [...line.matchAll(tagPattern)]
    if (!tags.length) return
    const content = trimCueText(line.replace(tagPattern, ''))
    if (!content) return
    tags.forEach((tag, index) => {
      const startMs = parseTimeToMs(tag[1])
      cues.push({
        id: createCueId('lrc', cues.length),
        text: content,
        startMs,
        sourceLine: lineIndex + 1 + index,
      })
    })
  })

  return finalizeDocument(title, 'lrc', text, cues)
}

export const parseSrtDocument = (text: string, title = 'SRT 提词文档'): CueDocument => {
  const cues: PromptCue[] = []
  const blocks = text.split(/\r?\n\r?\n/).map(item => item.trim()).filter(Boolean)

  blocks.forEach((block, index) => {
    const lines = block.split(/\r?\n/).filter(Boolean)
    if (lines.length < 2) return
    const timeline = lines[1].match(/(.+?)\s*-->\s*(.+)/)
    const textLines = lines.slice(2).join('\n').trim()
    if (!textLines) return
    cues.push({
      id: createCueId('srt', index),
      text: trimCueText(textLines),
      startMs: timeline ? parseTimeToMs(timeline[1]) : null,
      endMs: timeline ? parseTimeToMs(timeline[2]) : null,
      sourceLine: index + 1,
    })
  })

  return finalizeDocument(title, 'srt', text, cues)
}

export const parseAssDocument = (text: string, title = 'ASS 提词文档'): CueDocument => {
  const cues: PromptCue[] = []
  const lines = text.split(/\r?\n/)

  lines.forEach((line, index) => {
    if (!line.startsWith('Dialogue:')) return
    const payload = line.replace(/^Dialogue:\s*/, '')
    const parts = payload.split(',')
    if (parts.length < 10) return
    const startMs = parseTimeToMs(parts[1] || '')
    const endMs = parseTimeToMs(parts[2] || '')
    const textValue = trimCueText(parts.slice(9).join(','))
    if (!textValue) return
    cues.push({
      id: createCueId('ass', cues.length),
      text: textValue,
      startMs,
      endMs,
      sourceLine: index + 1,
    })
  })

  return finalizeDocument(title, 'ass', text, cues)
}

export const parseCueDocumentByExtension = (fileName: string, text: string): CueDocument => {
  const normalized = fileName.toLowerCase()
  if (normalized.endsWith('.lrc')) return parseLrcDocument(text, fileName)
  if (normalized.endsWith('.srt')) return parseSrtDocument(text, fileName)
  if (normalized.endsWith('.ass')) return parseAssDocument(text, fileName)
  return parsePlainTextDocument(text, fileName, 'txt')
}

export const createDemoCueDocument = (): CueDocument => {
  return finalizeDocument(
    '舞台提词演示',
    'demo',
    '',
    [
      '这不是普通歌词页面',
      '这是舞台现场的低延迟提词骨架',
      '顺序点按模式适合常规提词',
      'JK 接力模式适合左右手交替控屏',
      '支持当前句 下一句 和多端镜像同步',
      '后续会接入 WebSocket WebRTC 与蓝牙链路',
    ].map((text, index) => ({
      id: createCueId('demo', index),
      text,
      sourceLine: index + 1,
    })),
  )
}

