import { StandardisedVesselDataset } from '../models/StandardisedVesselDataset'
import { ValidationError, ValidationResult } from './ValidationError'

/**
 * Validates a StandardisedVesselDataset object.
 * Returns a ValidationResult containing any errors found.
 * Extend this with additional rules for your application's requirements.
 */
export function validateSvd(svd: StandardisedVesselDataset): ValidationResult {
  const errors: ValidationError[] = []
  const { General } = svd

  if (!General.Imo) {
    errors.push({ field: 'General.Imo', message: 'Imo is required' })
  } else if (!/^\d{7}$/.test(General.Imo)) {
    errors.push({ field: 'General.Imo', message: 'Imo must be seven digits' })
  }

  if (!General.ShipName) {
    errors.push({ field: 'General.ShipName', message: 'ShipName is required' })
  }

  if (!General.ShipReportingDate) {
    errors.push({ field: 'General.ShipReportingDate', message: 'ShipReportingDate is required' })
  } else if (isNaN(Date.parse(General.ShipReportingDate))) {
    errors.push({
      field: 'General.ShipReportingDate',
      message: 'ShipReportingDate must be a valid ISO 8601 date',
    })
  }

  return { isValid: errors.length === 0, errors }
}
