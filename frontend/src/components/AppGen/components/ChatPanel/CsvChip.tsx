import { Paperclip, X } from 'lucide-react'

interface CsvChipProps {
  filename: string
  columnCount: number
  onRemove?: () => void
  disabled?: boolean
}

export function CsvChip({ filename, columnCount, onRemove, disabled }: CsvChipProps) {
  return (
    <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-sky-50 border border-sky-200 text-sm text-sky-800">
      <Paperclip className="w-3.5 h-3.5" />
      <span className="font-medium truncate max-w-[150px]">{filename}</span>
      <span className="text-sky-500">&middot;</span>
      <span className="text-xs text-sky-600">{columnCount} runtime columns</span>
      {onRemove && !disabled && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-1 hover:text-red-500 transition-colors"
          aria-label="Remove CSV"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}
