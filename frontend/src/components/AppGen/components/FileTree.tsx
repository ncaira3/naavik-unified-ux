import { useState, useRef, useEffect, useCallback } from 'react'
import {
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
  FileCode,
  FileJson,
  FileText,
  FileType,
  FilePlus,
  FolderPlus,
  Pencil,
  Trash2,
} from 'lucide-react'

interface FileNode {
  name: string
  type: 'file' | 'directory'
  path: string
  extension?: string | null
  children?: FileNode[]
}

interface ContextMenuState {
  x: number
  y: number
  node: FileNode
}

interface InlineCreateState {
  parentPath: string
  type: 'file' | 'directory'
}

interface FileTreeProps {
  tree: FileNode | null
  selectedFile: string | null
  onFileSelect: (path: string) => void
  onCreateFile?: (path: string) => void
  onCreateDirectory?: (path: string) => void
  onDeleteFile?: (path: string) => void
  onRenameFile?: (oldPath: string, newPath: string) => void
}

function sortNodes(nodes: FileNode[]): FileNode[] {
  const dirs = nodes.filter(n => n.type === 'directory')
  const files = nodes.filter(n => n.type === 'file')
  const compareName = (a: FileNode, b: FileNode) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  dirs.sort(compareName)
  files.sort(compareName)
  return [...dirs, ...files]
}

function getFileIcon(extension: string | null | undefined) {
  switch (extension) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
      return <FileCode className="w-4 h-4 text-amber-600 flex-shrink-0" />
    case 'json':
      return <FileJson className="w-4 h-4 text-amber-700 flex-shrink-0" />
    case 'md':
    case 'txt':
      return <FileText className="w-4 h-4 text-text-secondary flex-shrink-0" />
    case 'py':
      return <FileCode className="w-4 h-4 text-blue-600 flex-shrink-0" />
    case 'css':
    case 'scss':
      return <FileType className="w-4 h-4 text-pink-600 flex-shrink-0" />
    case 'html':
      return <FileCode className="w-4 h-4 text-orange-600 flex-shrink-0" />
    case 'yaml':
    case 'yml':
      return <FileCode className="w-4 h-4 text-teal-500 flex-shrink-0" />
    case 'sh':
    case 'bash':
      return <FileCode className="w-4 h-4 text-green-600 flex-shrink-0" />
    default:
      return <File className="w-4 h-4 text-text-muted flex-shrink-0" />
  }
}

function parentPath(filePath: string): string {
  const parts = filePath.split('/')
  parts.pop()
  return parts.join('/')
}

// ---------------------------------------------------------------------------
// Inline name input (shared for create and rename)
// ---------------------------------------------------------------------------

interface InlineInputProps {
  initialValue?: string
  depth: number
  onConfirm: (value: string) => void
  onCancel: () => void
}

function InlineInput({ initialValue = '', depth, onConfirm, onCancel }: InlineInputProps) {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const trimmed = value.trim()
      if (trimmed) onConfirm(trimmed)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
    e.stopPropagation()
  }

  return (
    <div
      className="flex items-center gap-1 py-0.5"
      style={{ paddingLeft: depth * 12 + 8 }}
    >
      <input
        ref={inputRef}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={onCancel}
        className="min-w-0 flex-1 rounded-lg border border-sky-300 bg-cream-surface px-2 py-1 text-sm outline-none ring-2 ring-sky-100"
        onClick={e => e.stopPropagation()}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

interface ContextMenuProps {
  menu: ContextMenuState
  onClose: () => void
  onNewFile: () => void
  onNewFolder: () => void
  onRename: () => void
  onDelete: () => void
}

function ContextMenu({ menu, onClose, onNewFile, onNewFolder, onRename, onDelete }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const isDir = menu.node.type === 'directory'

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  const item = (
    icon: React.ReactNode,
    label: string,
    action: () => void,
    danger = false
  ) => (
    <button
      onMouseDown={e => { e.preventDefault(); e.stopPropagation(); action(); onClose() }}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors ${
        danger ? 'text-red-500 hover:bg-red-50 hover:text-red-600' : 'text-text-secondary hover:bg-slate-50'
      }`}
    >
      {icon}
      {label}
    </button>
  )

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[160px] rounded-xl border border-border bg-cream-surface py-1 shadow-aira"
      style={{ top: menu.y, left: menu.x }}
    >
      {isDir && item(<FilePlus className="w-3.5 h-3.5" />, 'New File', onNewFile)}
      {isDir && item(<FolderPlus className="w-3.5 h-3.5" />, 'New Folder', onNewFolder)}
      {isDir && <div className="my-1 border-t border-border" />}
      {item(<Pencil className="w-3.5 h-3.5" />, 'Rename', onRename)}
      {item(<Trash2 className="w-3.5 h-3.5" />, 'Delete', onDelete, true)}
    </div>
  )
}

// ---------------------------------------------------------------------------
// TreeNode
// ---------------------------------------------------------------------------

interface TreeNodeProps {
  node: FileNode
  depth: number
  selectedFile: string | null
  inlineCreate: InlineCreateState | null
  renamingPath: string | null
  onFileSelect: (path: string) => void
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void
  onInlineCreateConfirm: (name: string) => void
  onInlineCreateCancel: () => void
  onRenameConfirm: (node: FileNode, newName: string) => void
  onRenameCancel: () => void
}

function TreeNode({
  node,
  depth,
  selectedFile,
  inlineCreate,
  renamingPath,
  onFileSelect,
  onContextMenu,
  onInlineCreateConfirm,
  onInlineCreateCancel,
  onRenameConfirm,
  onRenameCancel,
}: TreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(depth < 2)
  const isSelected = node.path === selectedFile
  const isRenaming = renamingPath === node.path
  const paddingLeft = depth * 12 + 8
  const showCreate = inlineCreate?.parentPath === node.path && node.type === 'directory'

  // Auto-expand parent when a child create is triggered
  useEffect(() => {
    if (showCreate) setIsExpanded(true)
  }, [showCreate])

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      onContextMenu(e, node)
    },
    [node, onContextMenu]
  )

  if (isRenaming) {
    return (
      <InlineInput
        initialValue={node.name}
        depth={depth}
        onConfirm={name => onRenameConfirm(node, name)}
        onCancel={onRenameCancel}
      />
    )
  }

  if (node.type === 'file') {
    return (
      <div
        className={`file-tree-item ${isSelected ? 'selected' : ''}`}
        style={{ paddingLeft }}
        onClick={() => onFileSelect(node.path)}
        onContextMenu={handleContextMenu}
      >
        {getFileIcon(node.extension)}
        <span className="truncate text-sm">{node.name}</span>
      </div>
    )
  }

  const sortedChildren = node.children ? sortNodes(node.children) : []

  return (
    <div>
      <div
        className="file-tree-item"
        style={{ paddingLeft }}
        onClick={() => setIsExpanded(e => !e)}
        onContextMenu={handleContextMenu}
      >
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-text-muted flex-shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-text-muted flex-shrink-0" />
        )}
        {isExpanded ? (
          <FolderOpen className="w-4 h-4 text-sky-600 flex-shrink-0" />
        ) : (
          <Folder className="w-4 h-4 text-text-muted flex-shrink-0" />
        )}
        <span className="truncate text-sm font-medium text-text-secondary">{node.name}</span>
      </div>

      {isExpanded && (
        <div>
          {sortedChildren.map((child, index) => (
            <TreeNode
              key={`${child.path}-${index}`}
              node={child}
              depth={depth + 1}
              selectedFile={selectedFile}
              inlineCreate={inlineCreate}
              renamingPath={renamingPath}
              onFileSelect={onFileSelect}
              onContextMenu={onContextMenu}
              onInlineCreateConfirm={onInlineCreateConfirm}
              onInlineCreateCancel={onInlineCreateCancel}
              onRenameConfirm={onRenameConfirm}
              onRenameCancel={onRenameCancel}
            />
          ))}
          {showCreate && (
            <InlineInput
              depth={depth + 1}
              onConfirm={onInlineCreateConfirm}
              onCancel={onInlineCreateCancel}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// FileTree (root)
// ---------------------------------------------------------------------------

export function FileTree({
  tree,
  selectedFile,
  onFileSelect,
  onCreateFile,
  onCreateDirectory,
  onDeleteFile,
  onRenameFile,
}: FileTreeProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [inlineCreate, setInlineCreate] = useState<InlineCreateState | null>(null)
  const [renamingPath, setRenamingPath] = useState<string | null>(null)

  const sortedRoot = tree?.children ? sortNodes(tree.children) : []
  const rootPath = tree?.path ?? ''

  const handleContextMenu = useCallback((e: React.MouseEvent, node: FileNode) => {
    setContextMenu({ x: e.clientX, y: e.clientY, node })
    setInlineCreate(null)
    setRenamingPath(null)
  }, [])

  const handleNewFile = useCallback(() => {
    if (!contextMenu) return
    const parent = contextMenu.node.type === 'directory'
      ? contextMenu.node.path
      : parentPath(contextMenu.node.path) || rootPath
    setInlineCreate({ parentPath: parent, type: 'file' })
    setRenamingPath(null)
  }, [contextMenu, rootPath])

  const handleNewFolder = useCallback(() => {
    if (!contextMenu) return
    const parent = contextMenu.node.type === 'directory'
      ? contextMenu.node.path
      : parentPath(contextMenu.node.path) || rootPath
    setInlineCreate({ parentPath: parent, type: 'directory' })
    setRenamingPath(null)
  }, [contextMenu, rootPath])

  const handleRename = useCallback(() => {
    if (!contextMenu) return
    setRenamingPath(contextMenu.node.path)
    setInlineCreate(null)
  }, [contextMenu])

  const handleDelete = useCallback(() => {
    if (!contextMenu) return
    onDeleteFile?.(contextMenu.node.path)
  }, [contextMenu, onDeleteFile])

  const handleInlineCreateConfirm = useCallback((name: string) => {
    if (!inlineCreate) return
    const fullPath = inlineCreate.parentPath
      ? `${inlineCreate.parentPath}/${name}`
      : name
    if (inlineCreate.type === 'file') {
      onCreateFile?.(fullPath)
    } else {
      onCreateDirectory?.(fullPath)
    }
    setInlineCreate(null)
  }, [inlineCreate, onCreateFile, onCreateDirectory])

  const handleRenameConfirm = useCallback((node: FileNode, newName: string) => {
    if (newName === node.name) { setRenamingPath(null); return }
    const newPath = parentPath(node.path)
      ? `${parentPath(node.path)}/${newName}`
      : newName
    onRenameFile?.(node.path, newPath)
    setRenamingPath(null)
  }, [onRenameFile])

  // Close context menu on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null)
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [])

  return (
    <div className="h-full flex flex-col overflow-hidden rounded-2xl bg-cream-surface">
      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {sortedRoot.length > 0 || inlineCreate?.parentPath === rootPath ? (
          <>
            {sortedRoot.map((node, index) => (
              <TreeNode
                key={`${node.path}-${index}`}
                node={node}
                depth={0}
                selectedFile={selectedFile}
                inlineCreate={inlineCreate}
                renamingPath={renamingPath}
                onFileSelect={onFileSelect}
                onContextMenu={handleContextMenu}
                onInlineCreateConfirm={handleInlineCreateConfirm}
                onInlineCreateCancel={() => setInlineCreate(null)}
                onRenameConfirm={handleRenameConfirm}
                onRenameCancel={() => setRenamingPath(null)}
              />
            ))}
            {inlineCreate?.parentPath === rootPath && (
              <InlineInput
                depth={0}
                onConfirm={handleInlineCreateConfirm}
                onCancel={() => setInlineCreate(null)}
              />
            )}
          </>
        ) : (
          <div className="px-4 py-8 text-center text-text-muted">
            <Folder className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm font-medium text-text-secondary">Workspace is empty</p>
            <p className="text-xs mt-1">Ask the AI to create files or start from the plan.</p>
          </div>
        )}
      </div>

      {contextMenu && (
        <ContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onNewFile={handleNewFile}
          onNewFolder={handleNewFolder}
          onRename={handleRename}
          onDelete={handleDelete}
        />
      )}
    </div>
  )
}
