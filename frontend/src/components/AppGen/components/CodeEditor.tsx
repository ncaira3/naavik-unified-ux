import { useEffect, useCallback, useRef } from 'react'
import Editor, { OnMount } from '@monaco-editor/react'
import { Save, FileCode } from 'lucide-react'

interface CodeEditorProps {
  content: string
  filePath: string | null
  onChange: (content: string) => void
  onSave: () => void
  readOnly?: boolean
}

function getLanguageFromPath(path: string | null): string {
  if (!path) return 'plaintext'
  
  const extension = path.split('.').pop()?.toLowerCase()
  
  const languageMap: Record<string, string> = {
    'ts': 'typescript',
    'tsx': 'typescript',
    'js': 'javascript',
    'jsx': 'javascript',
    'py': 'python',
    'json': 'json',
    'html': 'html',
    'css': 'css',
    'scss': 'scss',
    'md': 'markdown',
    'yaml': 'yaml',
    'yml': 'yaml',
    'xml': 'xml',
    'sql': 'sql',
    'sh': 'shell',
    'bash': 'shell',
    'go': 'go',
    'rs': 'rust',
    'java': 'java',
    'c': 'c',
    'cpp': 'cpp',
    'h': 'c',
    'hpp': 'cpp',
  }
  
  return languageMap[extension || ''] || 'plaintext'
}

export function CodeEditor({ content, filePath, onChange, onSave, readOnly = false }: CodeEditorProps) {
  const editorRef = useRef<any>(null)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleEditorMount: OnMount = (editor) => {
    editorRef.current = editor
    
    // Add save shortcut
    if (!readOnly) {
      editor.addCommand(
        2048 | 49,
        () => {
          onSave()
        }
      )
    }
  }

  const handleChange = useCallback((value: string | undefined) => {
    if (value !== undefined) {
      onChange(value)
      if (!readOnly) {
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current)
        }
        saveTimeoutRef.current = setTimeout(() => {
          onSave()
        }, 1000)
      }
    }
  }, [onChange, onSave, readOnly])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [])

  const language = getLanguageFromPath(filePath)

  return (
    <div className="h-full min-h-0 flex flex-col bg-cream-surface">
      {/* Header */}
      <div className="flex h-11 items-center justify-between border-b border-border bg-cream-bg px-4">
        <div className="flex items-center gap-2">
          <FileCode className="w-4 h-4 text-text-secondary" />
          <span className="text-sm font-medium text-text-primary">
            {filePath || 'No file selected'}
          </span>
          {filePath && (
            <span className="rounded-full bg-cream-surface px-2 py-0.5 text-xs text-text-muted border border-border">
              {language}
            </span>
          )}
        </div>
        
        {filePath && !readOnly && (
          <button
            onClick={onSave}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-text-secondary hover:text-slate-900 hover:bg-white transition-colors"
            title="Save (Ctrl+S)"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Save</span>
          </button>
        )}
      </div>

      {/* Editor */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {filePath ? (
          <Editor
            height="100%"
            language={language}
            value={content}
            onChange={handleChange}
            onMount={handleEditorMount}
            theme="vs"
            options={{
              fontSize: 14,
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              readOnly,
              minimap: { enabled: false },
              // Keep scrolling bounded to pane while still allowing full end-of-file reach.
              scrollBeyondLastLine: true,
              lineNumbers: 'on',
              renderLineHighlight: 'line',
              cursorBlinking: 'smooth',
              smoothScrolling: true,
              padding: { top: 16 },
              automaticLayout: true,
              tabSize: 2,
              wordWrap: 'on',
            }}
          />
        ) : (
          <div className="h-full flex items-center justify-center bg-[linear-gradient(180deg,_rgba(248,250,252,0.92)_0%,_rgba(255,255,255,0.98)_100%)] text-text-muted">
            <div className="text-center">
              <FileCode className="w-12 h-12 mx-auto mb-4 opacity-40" />
              <p className="text-sm font-medium text-text-secondary">Select a file to edit</p>
              <p className="mt-1 text-xs text-text-muted">Use the explorer to inspect generated code and config.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
