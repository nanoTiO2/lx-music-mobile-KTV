'use strict'

const os = require('os')
const { WebSocketServer } = require('ws')

const DEFAULT_PORT = Number(process.env.PROMPT_RELAY_PORT || 9528)
const DEFAULT_PATH = process.env.PROMPT_RELAY_PATH || '/prompt'

const sessionClients = new Map()

const now = () => new Date().toISOString()

const getNetworkAddresses = () => {
  const interfaces = os.networkInterfaces()
  const addresses = []
  for (const infoList of Object.values(interfaces)) {
    if (!infoList) continue
    for (const info of infoList) {
      if (info.family !== 'IPv4' || info.internal) continue
      addresses.push(info.address)
    }
  }
  return [...new Set(addresses)].sort()
}

const attachClientToSession = (sessionId, socket) => {
  const clients = sessionClients.get(sessionId) || new Set()
  clients.add(socket)
  sessionClients.set(sessionId, clients)
}

const detachClientFromSession = (sessionId, socket) => {
  const clients = sessionClients.get(sessionId)
  if (!clients) return
  clients.delete(socket)
  if (!clients.size) sessionClients.delete(sessionId)
}

const safeSend = (socket, payload) => {
  if (socket.readyState !== socket.OPEN) return
  socket.send(payload)
}

const relayMessage = (sender, sessionId, payload) => {
  const clients = sessionClients.get(sessionId)
  if (!clients) return
  for (const socket of clients) {
    if (socket === sender) continue
    safeSend(socket, payload)
  }
}

const server = new WebSocketServer({
  host: '0.0.0.0',
  port: DEFAULT_PORT,
  path: DEFAULT_PATH,
})

server.on('listening', () => {
  const addresses = getNetworkAddresses()
  console.log(`[${now()}] prompt relay ready`)
  console.log(`ws://127.0.0.1:${DEFAULT_PORT}${DEFAULT_PATH}`)
  for (const address of addresses) {
    console.log(`ws://${address}:${DEFAULT_PORT}${DEFAULT_PATH}`)
  }
  console.log('Use the same sessionId on controller and receiver.')
})

server.on('connection', socket => {
  let boundSessionId = null

  socket.on('message', raw => {
    const payload = String(raw)
    let message
    try {
      message = JSON.parse(payload)
    } catch {
      safeSend(socket, JSON.stringify({
        type: 'prompt_error',
        error: 'invalid_json',
        at: now(),
      }))
      return
    }

    const sessionId = typeof message.sessionId === 'string' ? message.sessionId.trim() : ''
    if (!sessionId) {
      safeSend(socket, JSON.stringify({
        type: 'prompt_error',
        error: 'missing_session_id',
        at: now(),
      }))
      return
    }

    if (boundSessionId !== sessionId) {
      if (boundSessionId) detachClientFromSession(boundSessionId, socket)
      boundSessionId = sessionId
      attachClientToSession(boundSessionId, socket)
    }

    relayMessage(socket, boundSessionId, payload)
  })

  socket.on('close', () => {
    if (boundSessionId) detachClientFromSession(boundSessionId, socket)
  })

  socket.on('error', () => {
    if (boundSessionId) detachClientFromSession(boundSessionId, socket)
  })
})

server.on('error', error => {
  console.error(`[${now()}] prompt relay failed: ${error.message}`)
  process.exitCode = 1
})
