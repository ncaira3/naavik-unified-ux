import { useEffect, useRef, useCallback, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { TerminalIcon } from 'lucide-react'
import { createTerminalWebSocketUrl, terminalApi } from '../lib/api'
import '@xterm/xterm/css/xterm.css'

export function Terminal({ sessionId = 'default' }: { sessionId?: string }) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const shouldReconnectRef = useRef(true)
  const [isConnected, setIsConnected] = useState(false)
  const [terminalError, setTerminalError] = useState<string | null>(null)
  const [terminalMode, setTerminalMode] = useState<'sandbox' | 'local' | 'unavailable' | 'unknown'>('unknown')

  const connectWebSocket = useCallback((xterm: XTerm) => {
    // Clear any pending reconnect
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
    shouldReconnectRef.current = true

    // Don't connect if already connected or connecting
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return
    }

    // Close existing connection if in closing state
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    const wsUrl = createTerminalWebSocketUrl(sessionId)
    
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      setIsConnected(true)
      setTerminalError(null)
      // Send initial resize
      ws.send(JSON.stringify({
        type: 'resize',
        data: { rows: xterm.rows, cols: xterm.cols }
      }))
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'output') {
          xterm.write(data.data)
        } else if (data.type === 'status') {
          const nextMode =
            data.mode === 'sandbox'
              ? 'sandbox'
              : data.mode === 'local'
                ? 'local'
                : data.mode === 'unavailable'
                  ? 'unavailable'
                  : 'unknown'
          setTerminalMode(nextMode)
          if (nextMode === 'unavailable') {
            shouldReconnectRef.current = false
          }
        } else if (data.type === 'error') {
          const message = data.message || data.content || 'Terminal error'
          setTerminalError(message)
          if (/sandbox is unavailable/i.test(message) || /fallback is disabled/i.test(message)) {
            shouldReconnectRef.current = false
            setTerminalMode('unavailable')
          }
        }
      } catch {
        // If not JSON, write directly
        xterm.write(event.data)
      }
    }

    ws.onerror = () => {
      setIsConnected(false)
      setTerminalError('Terminal connection error. Check backend logs.')
    }

    ws.onclose = (event) => {
      wsRef.current = null
      setIsConnected(false)
      
      // Only reconnect if not a clean close and not component unmounting
      const permanentClose =
        !shouldReconnectRef.current ||
        /sandbox unavailable/i.test(event.reason) ||
        /fallback is disabled/i.test(event.reason)

      if (event.code !== 1000 && event.code !== 1001 && !permanentClose) {
        setTerminalError(event.reason || 'Terminal disconnected. Reconnecting...')
        xterm.write('\r\n\x1b[33mDisconnected. Reconnecting...\x1b[0m\r\n')
        reconnectTimeoutRef.current = setTimeout(() => {
          if (xtermRef.current) {
            connectWebSocket(xtermRef.current)
          }
        }, 2000)
      } else if (permanentClose) {
        setTerminalError((current) => current || event.reason || 'Sandbox is unavailable for terminal access.')
      }
    }
  }, [sessionId])

  useEffect(() => {
    if (!terminalRef.current) return

    // Create terminal instance
    const xterm = new XTerm({
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        cursorAccent: '#1e1e1e',
        selectionBackground: '#264f78',
        black: '#1e1e1e',
        red: '#f44747',
        green: '#6a9955',
        yellow: '#d7ba7d',
        blue: '#569cd6',
        magenta: '#c586c0',
        cyan: '#4ec9b0',
        white: '#d4d4d4',
        brightBlack: '#808080',
        brightRed: '#f44747',
        brightGreen: '#b5cea8',
        brightYellow: '#dcdcaa',
        brightBlue: '#9cdcfe',
        brightMagenta: '#c586c0',
        brightCyan: '#4ec9b0',
        brightWhite: '#ffffff',
      },
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Menlo', monospace",
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 10000,
      allowProposedApi: true,
    })

    // Add addons
    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()
    
    xterm.loadAddon(fitAddon)
    xterm.loadAddon(webLinksAddon)

    // Open terminal
    xterm.open(terminalRef.current)
    
    // Fit after a small delay to ensure container is sized
    setTimeout(() => {
      fitAddon.fit()
    }, 100)

    xtermRef.current = xterm
    fitAddonRef.current = fitAddon

    let cancelled = false
    terminalApi
      .getStatus(sessionId)
      .then((status) => {
        if (cancelled) return
        setTerminalMode(status.mode)
        setIsConnected(status.connected)
        setTerminalError(status.reason || null)
        if (!status.available) {
          shouldReconnectRef.current = false
          return
        }
        connectWebSocket(xterm)
      })
      .catch((err) => {
        if (cancelled) return
        setTerminalError(err instanceof Error ? err.message : 'Failed to load terminal status')
        setTerminalMode('unavailable')
        shouldReconnectRef.current = false
      })

    // Handle terminal input - send to WebSocket
    const inputDisposable = xterm.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'input',
          data: data
        }))
      }
    })

    // Handle resize
    const handleResize = () => {
      if (fitAddonRef.current) {
        fitAddonRef.current.fit()
        if (wsRef.current?.readyState === WebSocket.OPEN && xtermRef.current) {
          wsRef.current.send(JSON.stringify({
            type: 'resize',
            data: { rows: xtermRef.current.rows, cols: xtermRef.current.cols }
          }))
        }
      }
    }

    window.addEventListener('resize', handleResize)
    
    // Use ResizeObserver for panel resizes
    const resizeObserver = new ResizeObserver(() => {
      handleResize()
    })
    resizeObserver.observe(terminalRef.current)

    // Focus terminal when clicking on it
    const handleClick = () => {
      xterm.focus()
    }
    terminalRef.current.addEventListener('click', handleClick)

    // Cleanup
    return () => {
      cancelled = true
      window.removeEventListener('resize', handleResize)
      resizeObserver.disconnect()
      inputDisposable.dispose()
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      shouldReconnectRef.current = false
      wsRef.current?.close(1000, 'Component unmounting')
      xterm.dispose()
    }
  }, [connectWebSocket])

  // Focus terminal on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      xtermRef.current?.focus()
    }, 200)
    return () => clearTimeout(timer)
  }, [])

  const handleTerminalClick = useCallback(() => {
    xtermRef.current?.focus()
  }, [])

  return (
    <div className="h-full flex flex-col overflow-hidden  bg-[#111827]">
      {/* Header */}
      <div 
        className="flex h-11 items-center gap-3 border-b border-slate-700 bg-[#0f172a] px-4 cursor-pointer"
        onClick={handleTerminalClick}
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-800 border border-slate-700">
          <TerminalIcon className="w-4 h-4 text-text-primary" />
        </span>
        <div>
          <p className="text-sm font-medium text-text-primary">Terminal</p>
          <p className="text-[11px] text-text-muted">Runtime shell and command output</p>
        </div>
        <div className="ml-auto flex items-center gap-3 text-xs text-text-muted">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${
            isConnected ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300'
          }`}>
            <span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-red-400'}`} />
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${
            terminalMode === 'sandbox'
              ? 'bg-sky-500/10 text-sky-300'
              : terminalMode === 'local'
                ? 'bg-amber-500/10 text-amber-300'
                : terminalMode === 'unavailable'
                  ? 'bg-rose-500/10 text-rose-300'
                : 'bg-slate-700 text-text-muted'
          }`}>
            {terminalMode === 'sandbox'
              ? 'Sandbox'
              : terminalMode === 'local'
                ? 'Local'
                : terminalMode === 'unavailable'
                  ? 'Unavailable'
                  : 'Mode unknown'}
          </span>
          <span className="hidden sm:inline">Click to focus</span>
        </div>
      </div>

      {/* Terminal */}
      {terminalError && (
        <div className="border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-300">
          {terminalError}
        </div>
      )}
      <div 
        ref={terminalRef} 
        className="flex-1 overflow-hidden cursor-text bg-[#111827]"
        onClick={handleTerminalClick}
      />
    </div>
  )
}
