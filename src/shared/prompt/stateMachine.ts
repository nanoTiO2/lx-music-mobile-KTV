import { DEFAULT_PRESSED_KEYS, DEFAULT_PROMPT_STYLE } from './types'
import type {
  CueDocument,
  PromptAdvanceMode,
  PromptCommand,
  PromptOwnerKey,
  PromptSnapshot,
  PromptState,
  PromptUndoEntry,
} from './types'

const UNDO_LIMIT = 20

const buildUndoEntry = (state: PromptState): PromptUndoEntry => ({
  activeCueIndex: state.activeCueIndex,
  nextCueIndex: state.nextCueIndex,
  ownerKey: state.ownerKey,
  pressedKeys: { ...state.pressedKeys },
  displayState: state.displayState,
})

const cloneWithHistory = (state: PromptState, includeUndo = false): PromptState => {
  const undoStack = includeUndo
    ? [...state.undoStack, buildUndoEntry(state)].slice(-UNDO_LIMIT)
    : [...state.undoStack]

  return {
    ...state,
    pressedKeys: { ...state.pressedKeys },
    style: { ...state.style },
    undoStack,
  }
}

const showNextCue = (state: PromptState) => {
  if (state.nextCueIndex >= state.document.cues.length) return state
  state.activeCueIndex = state.nextCueIndex
  state.nextCueIndex += 1
  state.displayState = 'showing'
  return state
}

const clearCue = (state: PromptState) => {
  state.activeCueIndex = null
  state.ownerKey = null
  state.displayState = state.document.cues.length ? 'cleared' : 'idle'
  return state
}

const handleSequentialCommand = (state: PromptState, command: PromptCommand) => {
  switch (command.type) {
    case 'SHOW_CURRENT':
    case 'ADVANCE':
      return showNextCue(state)
    case 'CLEAR_SCREEN':
      return clearCue(state)
    default:
      return state
  }
}

const handleRelayKeyDown = (state: PromptState, key: PromptOwnerKey) => {
  state.pressedKeys[key] = true
  if (!state.ownerKey) {
    state.ownerKey = key
    return showNextCue(state)
  }
  if (state.ownerKey == key) return state
  state.ownerKey = key
  return showNextCue(state)
}

const handleRelayKeyUp = (state: PromptState, key: PromptOwnerKey) => {
  state.pressedKeys[key] = false
  if (state.ownerKey != key) return state
  return clearCue(state)
}

const handleRelayCommand = (state: PromptState, command: PromptCommand) => {
  switch (command.type) {
    case 'KEY_DOWN':
      return handleRelayKeyDown(state, command.key)
    case 'KEY_UP':
      return handleRelayKeyUp(state, command.key)
    case 'CLEAR_SCREEN':
      return clearCue(state)
    case 'SHOW_CURRENT':
    case 'ADVANCE':
      return showNextCue(state)
    default:
      return state
  }
}

export const createInitialPromptState = (
  document: CueDocument,
  mode: PromptAdvanceMode = 'sequential_tap',
): PromptState => ({
  revision: 0,
  mode,
  document,
  activeCueIndex: null,
  nextCueIndex: 0,
  ownerKey: null,
  pressedKeys: { ...DEFAULT_PRESSED_KEYS },
  displayState: 'idle',
  style: { ...DEFAULT_PROMPT_STYLE },
  undoStack: [],
})

export const applyPromptCommand = (state: PromptState, command: PromptCommand): PromptState => {
  if (command.type == 'LOAD_DOCUMENT') {
    return {
      ...createInitialPromptState(command.document, state.mode),
      style: { ...state.style },
      revision: state.revision + 1,
    }
  }

  if (command.type == 'SET_MODE') {
    return {
      ...state,
      mode: command.mode,
      ownerKey: null,
      pressedKeys: { ...DEFAULT_PRESSED_KEYS },
      revision: state.revision + 1,
    }
  }

  if (command.type == 'SET_STYLE') {
    return {
      ...state,
      style: {
        ...state.style,
        ...command.style,
      },
      revision: state.revision + 1,
    }
  }

  if (command.type == 'UNDO') {
    const previous = state.undoStack[state.undoStack.length - 1]
    if (!previous) return state
    return {
      ...state,
      ...previous,
      pressedKeys: { ...previous.pressedKeys },
      undoStack: state.undoStack.slice(0, -1),
      revision: state.revision + 1,
    }
  }

  const nextState = cloneWithHistory(state, ['SHOW_CURRENT', 'ADVANCE', 'CLEAR_SCREEN', 'KEY_DOWN', 'KEY_UP'].includes(command.type))

  if (state.mode == 'jk_relay') {
    handleRelayCommand(nextState, command)
  } else {
    handleSequentialCommand(nextState, command)
  }

  nextState.revision = state.revision + 1
  return nextState
}

export const createPromptSnapshot = (state: PromptState): PromptSnapshot => ({
  revision: state.revision,
  mode: state.mode,
  activeCueIndex: state.activeCueIndex,
  nextCueIndex: state.nextCueIndex,
  ownerKey: state.ownerKey,
  pressedKeys: { ...state.pressedKeys },
  displayState: state.displayState,
  style: { ...state.style },
})

export const getPromptPreviewCues = (state: PromptState) => {
  const current = state.activeCueIndex == null ? null : state.document.cues[state.activeCueIndex] ?? null
  const next = state.document.cues[state.nextCueIndex] ?? null
  const afterNext = state.document.cues[state.nextCueIndex + 1] ?? null
  return { current, next, afterNext }
}

