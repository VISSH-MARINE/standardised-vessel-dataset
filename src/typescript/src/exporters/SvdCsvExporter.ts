import { StandardisedVesselDataset } from '../models/StandardisedVesselDataset'
import { ExportResult } from './ExportResult'

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return ''
  const str = value instanceof Date ? value.toISOString() : String(value)
  return str.includes(',') || str.includes('"') || str.includes('\n')
    ? `"${str.replace(/"/g, '""')}"`
    : str
}

export function exportToCsv(svd: StandardisedVesselDataset): ExportResult {
  const headers: string[] = []
  const values: string[] = []

  for (const [section, fields] of Object.entries(svd) as [string, Record<string, unknown>][]) {
    for (const [field, value] of Object.entries(fields)) {
      headers.push(`${section}.${field}`)
      values.push(escapeCsv(value))
    }
  }

  const date = svd.General.ShipReportingDate?.slice(0, 10) ?? 'unknown'
  return {
    content: [headers.join(','), values.join(',')].join('\n'),
    filename: `SVD_${svd.General.Imo}_${date}.csv`,
    mimeType: 'text/csv',
  }
}
