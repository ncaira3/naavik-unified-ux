import { createContext, useContext, useState, useCallback, useRef, useEffect, ReactNode } from 'react';
import { ChatMessage, ParsedIntent } from '../types';
import type { WorkflowJSON } from '../types';
import type { BuilderState } from '../types';
import { v4 as uuidv4 } from 'uuid';

/** Chat stream/context – determines which module handles the conversation */
export type ChatStream = 'universal' | 'knowledge' | 'appgen' | 'observability' | 'provision';

interface ConversationContext {
  conversationId: string;
  lastQuery?: string;
  lastIntent?: ParsedIntent;
  lastResults?: any;
  followUpQuestions?: string[];
  appBuilderThreadId?: string | null;
  appBuilderState?: BuilderState | null;
  /** App builder: workflow and code (synced across all chat UIs) */
  appBuilderWorkflow?: WorkflowJSON | null;
  appBuilderCode?: string | null;
  appBuilderAppName?: string | null;
  appBuilderGenerating?: boolean;
}

interface ChatContextType {
  /** Current stream filter – chat content and routing follow this */
  activeStream: ChatStream;
  setActiveStream: (stream: ChatStream) => void;
  /** Active chat view messages — cleared on "New Chat" */
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  /** Active chat view by stream — used internally */
  messagesByStream: Record<ChatStream, ChatMessage[]>;
  /** Cumulative history — never cleared, persists across new chats and session resets */
  historyByStream: Record<ChatStream, ChatMessage[]>;
  clearChat: () => void;
  conversationContext: ConversationContext;
  updateContext: (updates: Partial<ConversationContext>) => void;
  /** Stable session thread ID shared across all views for the duration of the session (8h TTL) */
  sessionId: string;
  /** Track messages that finished typing – show instantly on remount (e.g. navigation) */
  markAnimationComplete: (messageId: string) => void;
  hasCompletedAnimation: (messageId: string) => boolean;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

const STREAMS: ChatStream[] = ['universal', 'knowledge', 'appgen', 'observability', 'provision'];

const SESSION_KEY = 'naavik-session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const MAX_MESSAGES_PER_STREAM = 500;
const MAX_HISTORY_PER_STREAM = 500;

interface PersistedSession {
  sessionId: string;
  startedAt: number;
  lastActivityAt: number;
  /** Active chat view — cleared on "New Chat" */
  messagesByStream: Record<ChatStream, ChatMessage[]>;
  /** Cumulative history — never cleared, carried forward across session resets */
  historyByStream: Record<ChatStream, ChatMessage[]>;
  conversationContext: ConversationContext;
}

function emptyStreamRecord(): Record<ChatStream, ChatMessage[]> {
  return STREAMS.reduce((acc, s) => { acc[s] = []; return acc; }, {} as Record<ChatStream, ChatMessage[]>);
}

function createFreshSession(priorHistory?: Record<ChatStream, ChatMessage[]>): PersistedSession {
  const sessionId = uuidv4();
  return {
    sessionId,
    startedAt: Date.now(),
    lastActivityAt: Date.now(),
    messagesByStream: emptyStreamRecord(),
    historyByStream: priorHistory ?? emptyStreamRecord(),
    conversationContext: { conversationId: sessionId },
  };
}

function loadOrCreateSession(): PersistedSession {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) {
      const s: PersistedSession = JSON.parse(raw);
      // Ensure historyByStream exists (migrate sessions created before this field)
      if (!s.historyByStream) s.historyByStream = emptyStreamRecord();
      for (const stream of STREAMS) {
        if (!s.messagesByStream[stream]) s.messagesByStream[stream] = [];
        if (!s.historyByStream[stream]) s.historyByStream[stream] = [];
      }
      const age = Date.now() - (s.lastActivityAt ?? 0);
      if (age < SESSION_TTL_MS && s.sessionId) {
        return s;
      }
      // Session expired — start fresh but carry the history forward
      return createFreshSession(s.historyByStream);
    }
  } catch {
    // fall through
  }
  return createFreshSession();
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<PersistedSession>(loadOrCreateSession);
  const [activeStream, setActiveStreamState] = useState<ChatStream>('universal');
  const activeStreamRef = useRef<ChatStream>('universal');
  const completedAnimationIdsRef = useRef<Set<string>>(new Set());

  const messages = session.messagesByStream[activeStream];

  // Persist session to localStorage on every change
  useEffect(() => {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {
      // localStorage quota exceeded — in-memory session continues normally
    }
  }, [session]);

  const setActiveStream = useCallback((stream: ChatStream) => {
    activeStreamRef.current = stream;
    setActiveStreamState(stream);
  }, []);

  const markAnimationComplete = useCallback((messageId: string) => {
    completedAnimationIdsRef.current.add(messageId);
  }, []);

  const hasCompletedAnimation = useCallback((messageId: string) => {
    return completedAnimationIdsRef.current.has(messageId);
  }, []);

  const setMessages = useCallback((fn: React.SetStateAction<ChatMessage[]>) => {
    setSession((prev) => {
      const stream = activeStreamRef.current;
      const current = prev.messagesByStream[stream];
      const updated = typeof fn === 'function' ? (fn as (prev: ChatMessage[]) => ChatMessage[])(current) : fn;
      const capped = updated.length > MAX_MESSAGES_PER_STREAM
        ? updated.slice(updated.length - MAX_MESSAGES_PER_STREAM)
        : updated;

      // Append any new messages to history (deduplicate by id)
      const currentHistory = prev.historyByStream[stream] ?? [];
      const historyIds = new Set(currentHistory.map((m) => m.id));
      const newMsgs = capped.filter((m) => !historyIds.has(m.id));
      const updatedHistory = newMsgs.length > 0
        ? [...currentHistory, ...newMsgs].slice(-MAX_HISTORY_PER_STREAM)
        : currentHistory;

      return {
        ...prev,
        lastActivityAt: Date.now(),
        messagesByStream: { ...prev.messagesByStream, [stream]: capped },
        historyByStream: { ...prev.historyByStream, [stream]: updatedHistory },
      };
    });
  }, []);

  // clearChat resets the active chat view only — history is untouched
  const clearChat = useCallback(() => {
    completedAnimationIdsRef.current.clear();
    setSession((prev) => ({
      ...prev,
      messagesByStream: { ...prev.messagesByStream, [activeStreamRef.current]: [] },
      conversationContext: {
        ...prev.conversationContext,
        appBuilderThreadId: null,
        appBuilderState: null,
        appBuilderWorkflow: null,
        appBuilderCode: null,
        appBuilderAppName: null,
      },
    }));
  }, []);

  const updateContext = useCallback((updates: Partial<ConversationContext>) => {
    setSession((prev) => ({
      ...prev,
      conversationContext: { ...prev.conversationContext, ...updates },
    }));
  }, []);

  return (
    <ChatContext.Provider value={{
      activeStream,
      setActiveStream,
      messages,
      setMessages,
      messagesByStream: session.messagesByStream,
      historyByStream: session.historyByStream,
      clearChat,
      conversationContext: session.conversationContext,
      updateContext,
      sessionId: session.sessionId,
      markAnimationComplete,
      hasCompletedAnimation,
    }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (context === undefined) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
}
