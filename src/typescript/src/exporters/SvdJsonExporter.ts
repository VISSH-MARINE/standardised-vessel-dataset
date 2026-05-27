import { StandardisedVesselDataset } from '../models/StandardisedVesselDataset'
import { ExportResult } from './ExportResult'

export function exportToJson(svd: StandardisedVesselDataset): ExportResult {
  const date = svd.General.ShipReportingDate?.slice(0, 10) ?? 'unknown'
  return {
    content: JSON.stringify(svd, null, 2),
    filename: `SVD_${svd.General.Imo}_${date}.json`,
    mimeType: 'application/json',
  }
}
