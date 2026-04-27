import { getAuthToken } from './api'

export interface RuntimeColumnDef {
  name: string
  dtype: string
  description: string | null
  min_value: string | null
  max_value: string | null
}

export interface CsvSchemaMetadata {
  filename: string
  raw_row_count: number
  runtime_columns: RuntimeColumnDef[]
  runtime_column_count: number
  file_path: string
  uploaded_at: string
}

export const csvApi = {
  async upload(sessionId: string, file: File): Promise<CsvSchemaMetadata> {
    const formData = new FormData()
    formData.append('file', file)
    const token = getAuthToken()
    const resp = await fetch(
      `/api/csv/upload?session_id=${encodeURIComponent(sessionId)}`,
      {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
        // Note: do NOT set Content-Type header; browser sets it with boundary
      }
    )
    if (!resp.ok) {
      const text = await resp.text()
      let message = text || `Upload failed: ${resp.status}`
      if (resp.status === 400) {
        // Try to extract detail from JSON error response
        try {
          const parsed = JSON.parse(text)
          if (parsed.detail) message = parsed.detail
        } catch { /* use raw text */ }
      }
      throw new Error(message)
    }
    return resp.json()
  },

  async getMetadata(sessionId: string): Promise<CsvSchemaMetadata | null> {
    const token = getAuthToken()
    const resp = await fetch(
      `/api/csv/metadata?session_id=${encodeURIComponent(sessionId)}`,
      {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }
    )
    if (resp.status === 404) return null
    if (!resp.ok) throw new Error(`Failed to get CSV metadata: ${resp.status}`)
    return resp.json()
  },

  async remove(sessionId: string): Promise<void> {
    const token = getAuthToken()
    const resp = await fetch(
      `/api/csv?session_id=${encodeURIComponent(sessionId)}`,
      {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }
    )
    if (!resp.ok && resp.status !== 404) throw new Error(`Failed to delete CSV: ${resp.status}`)
  },
}
