import { useEffect, useState } from 'react'

import {
  createDemoCueDocument,
  parseCueDocumentByExtension,
  parsePlainTextDocument,
} from './document'
import { applyPromptCommand, createInitialPromptState } from './stateMachine'
import type { CueDocument, PromptCommand, PromptState } from './types'

export type PromptTransportRole = 'controller' | 'receiver'
export type PromptConnectionState = 'local' | 'connecting' | 'connected' | 'error'

export interface PromptSessionState {
  promptState: PromptState
  sourceLabel: string
  sourcePath: string | null
  transportLabel: string
  transportRole: PromptTransportRole
  transportHost: string
  transportType: 'local_loopback' | 'wifi_websocket'
  connectionState: PromptConnectionState
  sessionId: string
  lastError: string
  remoteDeviceId: string | null
  lastEventAt: string
}

const listeners = new Set<(state: PromptSessionState) => void>()

const nowIso = () => new Date().toISOString()
const createSessionId = () => `prompt-${Math.random().toString(36).slice(2, 8)}`
const deviceId = `device-${Math.random().toString(36).slice(2, 10)}`

type PromptTransportMessage =
  | {
    type: 'prompt_hello'
    sessionId: string
    role: PromptTransportRole
    deviceId: string
    revision: number
  }
  | {
    type: 'prompt_request_state'
    sessionId: string
    role: PromptTransportRole
    deviceId: string
  }
  | {
    type: 'prompt_sync'
    sessionId: string
    role: PromptTransportRole
    deviceId: string
    state: Pick<PromptSessionState,
      'promptState'
      | 'sourceLabel'
      | 'sourcePath'
      | 'lastEventAt'
    >
  }

const buildSessionState = (
  document: CueDocument,
  sourceLabel: string,
  sourcePath: string | null = null,
): PromptSessionState => ({
  promptState: createInitialPromptState(document),
  sourceLabel,
  sourcePath,
  transportLabel: 'local_loopback',
  transportRole: 'controller',
  transportHost: '',
  transportType: 'local_loopback',
  connectionState: 'local',
  sessionId: createSessionId(),
  lastError: '',
  remoteDeviceId: null,
  lastEventAt: nowIso(),
})

let promptSessionState: PromptSessionState = buildSessionState(createDemoCueDocument(), '演示文档')
let transportSocket: WebSocket | null = null
let isApplyingRemoteState = false

const emitPromptSession = () => {
  const snapshot = promptSessionState
  listeners.forEach(listener => listener(snapshot))
}

const updatePromptSession = (updater: (state: PromptSessionState) => PromptSessionState) => {
  promptSessionState = updater(promptSessionState)
  emitPromptSession()
  if (!isApplyingRemoteState) sendPromptTransportState()
}

const normalizeTransportUrl = (host: string) => {
  const value = host.trim()
  if (/^wss?:\/\//i.test(value)) return value
  if (/^https?:\/\//i.test(value)) {
    return value.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:')
  }
  return `ws://${value}`
}

const postPromptTransportMessage = (message: PromptTransportMessage) => {
  if (!transportSocket || transportSocket.readyState != WebSocket.OPEN) return
  transportSocket.send(JSON.stringify(message))
}

const sendPromptTransportState = () => {
  if (
    !transportSocket ||
    transportSocket.readyState != WebSocket.OPEN ||
    promptSessionState.transportRole != 'controller' ||
    promptSessionState.connectionState != 'connected'
  ) return
  postPromptTransportMessage({
    type: 'prompt_sync',
    sessionId: promptSessionState.sessionId,
    role: promptSessionState.transportRole,
    deviceId,
    state: {
      promptState: promptSessionState.promptState,
      sourceLabel: promptSessionState.sourceLabel,
      sourcePath: promptSessionState.sourcePath,
      lastEventAt: promptSessionState.lastEventAt,
    },
  })
}

const applyRemotePromptState = (message: Extract<PromptTransportMessage, { type: 'prompt_sync' }>) => {
  isApplyingRemoteState = true
  try {
    updatePromptSession(state => ({
      ...state,
      promptState: message.state.promptState,
      sourceLabel: message.state.sourceLabel,
      sourcePath: message.state.sourcePath,
      transportLabel: 'wifi_websocket',
      transportType: 'wifi_websocket',
      connectionState: 'connected',
      lastError: '',
      remoteDeviceId: message.deviceId,
      lastEventAt: message.state.lastEventAt,
    }))
  } finally {
    isApplyingRemoteState = false
  }
}

const handlePromptTransportMessage = (raw: string) => {
  let message: PromptTransportMessage
  try {
    message = JSON.parse(raw) as PromptTransportMessage
  } catch {
    updatePromptSession(state => ({
      ...state,
      connectionState: 'error',
      lastError: 'invalid transport message',
      transportLabel: state.transportType == 'wifi_websocket' ? 'wifi_websocket' : state.transportLabel,
      lastEventAt: nowIso(),
    }))
    return
  }

  if (message.sessionId != promptSessionState.sessionId || message.deviceId == deviceId) return

  switch (message.type) {
    case 'prompt_hello':
      updatePromptSession(state => ({
        ...state,
        remoteDeviceId: message.deviceId,
        lastEventAt: nowIso(),
      }))
      if (promptSessionState.transportRole == 'controller') sendPromptTransportState()
      return
    case 'prompt_request_state':
      if (promptSessionState.transportRole == 'controller') sendPromptTransportState()
      return
    case 'prompt_sync':
      if (promptSessionState.transportRole != 'controller') {
        applyRemotePromptState(message)
      }
      return
  }
}

export const getPromptSessionState = () => promptSessionState

export const subscribePromptSession = (listener: (state: PromptSessionState) => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const usePromptSession = () => {
  const [state, setState] = useState(() => getPromptSessionState())

  useEffect(() => {
    return subscribePromptSession(setState)
  }, [])

  return state
}

export const resetPromptSessionToDemo = () => {
  promptSessionState = buildSessionState(createDemoCueDocument(), '演示文档')
  emitPromptSession()
}

export const setPromptTransportRole = (role: PromptTransportRole) => {
  updatePromptSession(state => ({
    ...state,
    transportRole: role,
    lastEventAt: nowIso(),
  }))
}

export const setPromptTransportHost = (host: string) => {
  updatePromptSession(state => ({
    ...state,
    transportHost: host.trim(),
    lastEventAt: nowIso(),
  }))
}

export const setPromptSessionId = (sessionId: string) => {
  const value = sessionId.trim() || createSessionId()
  updatePromptSession(state => ({
    ...state,
    sessionId: value,
    lastEventAt: nowIso(),
  }))
}

export const connectPromptTransport = async() => {
  const host = promptSessionState.transportHost.trim()
  if (!host) {
    updatePromptSession(state => ({
      ...state,
      connectionState: 'error',
      lastError: 'missing host',
      lastEventAt: nowIso(),
    }))
    throw new Error('missing host')
  }

  if (transportSocket) {
    try {
      transportSocket.close()
    } catch {}
    transportSocket = null
  }

  updatePromptSession(state => ({
    ...state,
    transportLabel: 'wifi_websocket',
    transportType: 'wifi_websocket',
    connectionState: 'connecting',
    lastError: '',
    remoteDeviceId: null,
    lastEventAt: nowIso(),
  }))

  const url = normalizeTransportUrl(host)

  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(url)
    transportSocket = socket

    socket.addEventListener('open', () => {
      updatePromptSession(state => ({
        ...state,
        connectionState: 'connected',
        transportLabel: 'wifi_websocket',
        transportType: 'wifi_websocket',
        lastError: '',
        lastEventAt: nowIso(),
      }))
      postPromptTransportMessage({
        type: 'prompt_hello',
        sessionId: promptSessionState.sessionId,
        role: promptSessionState.transportRole,
        deviceId,
        revision: promptSessionState.promptState.revision,
      })
      if (promptSessionState.transportRole == 'controller') {
        sendPromptTransportState()
      } else {
        postPromptTransportMessage({
          type: 'prompt_request_state',
          sessionId: promptSessionState.sessionId,
          role: promptSessionState.transportRole,
          deviceId,
        })
      }
      resolve()
    })

    socket.addEventListener('message', event => {
      if (typeof event.data != 'string') return
      handlePromptTransportMessage(event.data)
    })

    socket.addEventListener('close', () => {
      transportSocket = null
      updatePromptSession(state => ({
        ...state,
        connectionState: state.transportType == 'wifi_websocket' ? 'error' : state.connectionState,
        lastError: state.transportType == 'wifi_websocket' ? (state.lastError || 'socket closed') : state.lastError,
        remoteDeviceId: null,
        lastEventAt: nowIso(),
      }))
    })

    socket.addEventListener('error', () => {
      updatePromptSession(state => ({
        ...state,
        connectionState: 'error',
        transportType: 'wifi_websocket',
        transportLabel: 'wifi_websocket',
        lastError: 'socket error',
        lastEventAt: nowIso(),
      }))
      reject(new Error('socket error'))
    })
  })
}

export const disconnectPromptTransport = () => {
  if (transportSocket) {
    try {
      transportSocket.close()
    } catch {}
    transportSocket = null
  }
  updatePromptSession(state => ({
    ...state,
    transportLabel: 'local_loopback',
    transportType: 'local_loopback',
    connectionState: 'local',
    lastError: '',
    remoteDeviceId: null,
    lastEventAt: nowIso(),
  }))
}

export const loadPromptSessionDocument = (
  document: CueDocument,
  options: {
    sourceLabel?: string
    sourcePath?: string | null
  } = {},
) => {
  updatePromptSession(state => ({
    ...state,
    promptState: applyPromptCommand(state.promptState, {
      type: 'LOAD_DOCUMENT',
      document,
    }),
    sourceLabel: options.sourceLabel ?? document.title,
    sourcePath: options.sourcePath ?? null,
    lastEventAt: nowIso(),
  }))
}

export const loadPromptSessionFromText = (
  text: string,
  fileName: string,
  sourcePath: string | null = null,
) => {
  const document = parseCueDocumentByExtension(fileName, text)
  loadPromptSessionDocument(document, {
    sourceLabel: fileName,
    sourcePath,
  })
  return document
}

export const loadPromptSessionFromPaste = (text: string, title = '粘贴提词文本') => {
  const document = parsePlainTextDocument(text, title, 'paste')
  loadPromptSessionDocument(document, {
    sourceLabel: title,
    sourcePath: null,
  })
  return document
}

export const dispatchPromptSessionCommand = (command: PromptCommand) => {
  updatePromptSession(state => ({
    ...state,
    promptState: applyPromptCommand(state.promptState, command),
    lastEventAt: nowIso(),
  }))
}
