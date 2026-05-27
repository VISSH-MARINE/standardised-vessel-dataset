import { StandardisedVesselDataset } from '../models/StandardisedVesselDataset'
import { ExportResult } from './ExportResult'

function escapeXml(value: unknown): string {
  const str = value instanceof Date ? value.toISOString() : String(value)
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function sectionToXml(fields: Record<string, unknown>, indent: string): string {
  return Object.entries(fields)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([key, value]) => `${indent}<${key}>${escapeXml(value)}</${key}>`)
    .join('\n')
}

export function exportToXml(svd: StandardisedVesselDataset): ExportResult {
  const sections = (Object.entries(svd) as [string, Record<string, unknown>][])
    .map(([section, fields]) => `  <${section}>\n${sectionToXml(fields, '    ')}\n  </${section}>`)
    .join('\n')

  const content = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<StandardisedVesselDataset>',
    sections,
    '</StandardisedVesselDataset>',
  ].join('\n')

  const date = svd.General.ShipReportingDate?.slice(0, 10) ?? 'unknown'
  return {
    content,
    filename: `SVD_${svd.General.Imo}_${date}.xml`,
    mimeType: 'application/xml',
  }
}
