import { useCallback, useRef, useState } from 'react'
import { fetchApi } from '../lib/api'

interface IOCSummary {
  iocName: string
  path: string
  configParamCount: number
  pmCount: number
  children?: string[]
  associations?: string[]
}

interface IOCListResponse {
  domain: string
  datasourceReference: string
  totalIOCs: number
  iocs: IOCSummary[]
}

interface PMEntry {
  identifier: string
  category?: string
  dataType?: string
  unit?: string
  hasSubcounters?: boolean
}

interface ConfigParamEntry {
  paramName: string
  paramCategory?: string
  dataType?: string
  unit?: string
  isWritable?: string
  description?: string
}

interface IOCDetailsResponse {
  iocName: string
  configurationParameters?: {
    total: number
    shown: number
    params: ConfigParamEntry[]
  }
  pmAndKPIs?: PMEntry[]
}

export interface DropdownItem {
  label: string
  secondary?: string
  value: string
  group?: string
}

const iocCache: { data: IOCSummary[] | null; timestamp: number } = { data: null, timestamp: 0 }
const IOC_CACHE_TTL = 60_000

export async function fetchIOCList(): Promise<DropdownItem[]> {
  const now = Date.now()
  if (iocCache.data && now - iocCache.timestamp < IOC_CACHE_TTL) {
    return iocCache.data.map(iocToDropdownItem)
  }
  const resp = await fetchApi<IOCListResponse>('/datadict/iocs')
  iocCache.data = resp.iocs
  iocCache.timestamp = now
  return resp.iocs.map(iocToDropdownItem)
}

function iocToDropdownItem(ioc: IOCSummary): DropdownItem {
  return {
    label: ioc.iocName,
    secondary: `${ioc.pmCount} PMs, ${ioc.configParamCount} CMs`,
    value: ioc.iocName,
  }
}

const iocDetailsCache = new Map<string, { data: DropdownItem[]; timestamp: number }>()

export async function fetchMetricsForIOC(iocName: string): Promise<DropdownItem[]> {
  const now = Date.now()
  const cached = iocDetailsCache.get(iocName)
  if (cached && now - cached.timestamp < IOC_CACHE_TTL) {
    return cached.data
  }
  const resp = await fetchApi<IOCDetailsResponse>(`/datadict/ioc/${encodeURIComponent(iocName)}`)
  const items: DropdownItem[] = []

  if (resp.pmAndKPIs) {
    for (const pm of resp.pmAndKPIs) {
      items.push({
        label: pm.identifier,
        secondary: pm.category || '',
        value: pm.identifier,
        group: 'PM/KPI',
      })
    }
  }

  if (resp.configurationParameters?.params) {
    for (const param of resp.configurationParameters.params) {
      items.push({
        label: param.paramName,
        secondary: param.dataType || '',
        value: param.paramName,
        group: 'Config Param',
      })
    }
  }

  iocDetailsCache.set(iocName, { data: items, timestamp: now })
  return items
}

export function useDataDict() {
  const [iocs, setIocs] = useState<IOCSummary[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const loaded = useRef(false)

  const loadIOCs = useCallback(async () => {
    if (loaded.current) return
    setIsLoading(true)
    try {
      await fetchIOCList()
      if (iocCache.data) {
        setIocs(iocCache.data)
        loaded.current = true
      }
    } finally {
      setIsLoading(false)
    }
  }, [])

  return { iocs, isLoading, loadIOCs, fetchIOCList, fetchMetricsForIOC }
}
