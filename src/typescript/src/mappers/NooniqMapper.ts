/**
 * Mapper between the nooniq application's flat noon-report format and SVD.
 *
 * Structural differences to be aware of:
 *
 * 1. FUEL MODEL – nooniq stores a consumer × fuel-type matrix
 *    (mainEngineHFO, auxEngineMGO, boilerLSFO …).  SVD stores one
 *    FuelAndBunker object per fuel type with per-consumer breakdown.
 *    toSvd() merges all fuel types into a single record whose FuelType
 *    is the dominant (highest-consumption) type.  For vessels operating
 *    on multiple fuel types simultaneously, produce one SVD per fuel type
 *    by calling toSvdByFuelType().
 *
 * 2. ENGINE PARAMETERS – fields like ScavAirPressure, ExhaustGasTemp,
 *    TurboChargerRPM, AuxEngine running hours, etc. exist in nooniq but
 *    have no SVD equivalent.  They are preserved in nooniq's own database
 *    and silently dropped in the SVD direction.
 *
 * 3. SVD-ONLY SECTIONS – PortInformation, ArrivalTimes,
 *    DeviationFromPlanned, and ElectricityConsumption are not captured in
 *    nooniq's noon report.  toSvd() returns zero/empty values for these
 *    sections; populate them separately if your workflow provides the data.
 *
 * 4. VESSEL IDENTITY – nooniq stores vessel info (IMO, name) in a separate
 *    vessels table, not inside the noon report record.  Pass the vessel
 *    details via NooniqVesselInfo when calling toSvd().
 */

import { StandardisedVesselDataset } from '../models/StandardisedVesselDataset'
import { GeneralInformation } from '../models/GeneralInformation'
import { PortInformation } from '../models/PortInformation'
import { ArrivalTimes } from '../models/ArrivalTimes'
import { DeviationFromPlanned } from '../models/DeviationFromPlanned'
import { SpeedAndDistance } from '../models/SpeedAndDistance'
import { WeatherInformation } from '../models/WeatherInformation'
import { FreshWater } from '../models/FreshWater'
import { CargoInformation } from '../models/CargoInformation'
import { ElectricityConsumption } from '../models/ElectricityConsumption'
import { FuelAndBunkerInformation } from '../models/FuelAndBunkerInformation'
import { Emissions } from '../models/Emissions'
import { CylinderLubeOilInformation } from '../models/CylinderLubeOilInformation'

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

/** Vessel-level data held in nooniq's vessels table, needed to populate SVD General. */
export type NooniqVesselInfo = {
  imo: string
  name: string
  type?: string | null
  flagState?: string | null
}

/**
 * Flat noon-report record as produced by nooniq's csv-parser / database.
 * All numeric/boolean fields are nullable to match nooniq's ParsedNoonReportData.
 */
export type NooniqReport = {
  voyageNumber?: string | number | null
  reportDate?: string | null    // dd/mm/yyyy  OR  yyyy-mm-dd
  reportTime?: string | null    // HH:MM
  timeZone?: string | null

  // Position & navigation
  latitude?: number | null
  longitude?: number | null
  courseMade?: number | null
  courseGyro?: number | null
  speedMade?: number | null
  speedLog?: number | null
  distanceRun?: number | null
  engineDistance?: number | null
  distanceToGo?: number | null
  slip?: number | null

  // Draft
  forwardDraft?: number | null
  aftDraft?: number | null
  trim?: number | null
  meanDraft?: number | null

  // Weather
  windDirection?: number | null
  windForce?: number | null
  seaDirection?: number | null
  seaState?: number | null
  swellDirection?: number | null
  swellHeight?: number | null
  airTemperature?: number | null
  seaTemperature?: number | null
  barometer?: number | null
  visibility?: string | null

  // Fuel consumption: consumer × fuel-type matrix (MT since last report)
  mainEngineHFO?: number | null
  mainEngineLSFO?: number | null
  mainEngineMDO?: number | null
  mainEngineMGO?: number | null
  mainEngineLNG?: number | null
  auxEngineHFO?: number | null
  auxEngineLSFO?: number | null
  auxEngineMDO?: number | null
  auxEngineMGO?: number | null
  boilerHFO?: number | null
  boilerLSFO?: number | null
  boilerMDO?: number | null
  boilerMGO?: number | null
  inertGasGenerator?: number | null
  totalHFO?: number | null
  totalLSFO?: number | null
  totalMDO?: number | null
  totalMGO?: number | null
  totalLNG?: number | null

  // Main engine performance (nooniq-only, no SVD equivalent)
  mainEnginePower?: number | null
  mainEngineRPM?: number | null
  mainEngineLoadPercent?: number | null

  // Fresh water / utilities
  fwGeneratorProduction?: number | null
  evaporatorProduction?: number | null

  // Remaining on board
  robHFO?: number | null
  robLSFO?: number | null
  robMDO?: number | null
  robMGO?: number | null
  robLNG?: number | null
  robCylinderOil?: number | null
  robSystemOil?: number | null
  robAuxEngineOil?: number | null
  robFreshWaterDomestic?: number | null
  robFreshWaterTechnical?: number | null
  robBallastWater?: number | null

  // Calculated
  co2EmissionsTotal?: number | null

  // Operational / cargo
  operationalMode?: string | null
  isInECA?: boolean | null
  isScrubberInUse?: boolean | null
  cargoAmount?: number | null
  cargoUnit?: string | null
  ballastAmount?: number | null

  // Remarks
  remarksMaster?: string | null
  remarksEngine?: string | null
  remarksCargoOps?: string | null
  nonRoutineEvents?: string | null
}

// ---------------------------------------------------------------------------
// Supported fuel type codes (SVD FuelType field)
// ---------------------------------------------------------------------------

export type SvdFuelType = 'HFO' | 'LSFO' | 'MDO' | 'MGO' | 'LNG'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function n(v: number | null | undefined): number {
  return v ?? 0
}

/**
 * Convert nooniq reportDate (dd/mm/yyyy or yyyy-mm-dd) + reportTime (HH:MM)
 * into an ISO 8601 UTC string, e.g. "2025-05-09T12:00:00Z".
 */
function toIso8601(
  reportDate: string | null | undefined,
  reportTime: string | null | undefined,
): string {
  if (!reportDate) return new Date().toISOString()

  let dateStr: string
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(reportDate)) {
    const [d, m, y] = reportDate.split('/')
    dateStr = `${y}-${m}-${d}`
  } else {
    dateStr = reportDate
  }

  const time = reportTime?.match(/^\d{2}:\d{2}$/) ? reportTime : '12:00'
  return `${dateStr}T${time}:00Z`
}

/**
 * Convert an ISO 8601 date string back to nooniq's dd/mm/yyyy + HH:MM pair.
 */
function fromIso8601(iso: string): { reportDate: string; reportTime: string } {
  const dt = new Date(iso)
  const day = String(dt.getUTCDate()).padStart(2, '0')
  const month = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const year = dt.getUTCFullYear()
  const hours = String(dt.getUTCHours()).padStart(2, '0')
  const minutes = String(dt.getUTCMinutes()).padStart(2, '0')
  return {
    reportDate: `${day}/${month}/${year}`,
    reportTime: `${hours}:${minutes}`,
  }
}

/** Return the fuel type code with the highest total consumption. */
function dominantFuelType(r: NooniqReport): SvdFuelType {
  const candidates: { type: SvdFuelType; total: number }[] = [
    { type: 'HFO',  total: n(r.totalHFO) },
    { type: 'LSFO', total: n(r.totalLSFO) },
    { type: 'MDO',  total: n(r.totalMDO) },
    { type: 'MGO',  total: n(r.totalMGO) },
    { type: 'LNG',  total: n(r.totalLNG) },
  ]
  const best = candidates.reduce((a, b) => (b.total > a.total ? b : a))
  return best.total > 0 ? best.type : 'LSFO'
}

/** Build the FuelAndBunker section for a specific fuel type. */
function buildFuelAndBunker(r: NooniqReport, fuelType: SvdFuelType): FuelAndBunkerInformation {
  const fuelMap: Record<SvdFuelType, {
    me: number; ae: number; boiler: number; total: number; rob: number
  }> = {
    HFO:  { me: n(r.mainEngineHFO),  ae: n(r.auxEngineHFO),  boiler: n(r.boilerHFO),  total: n(r.totalHFO),  rob: n(r.robHFO)  },
    LSFO: { me: n(r.mainEngineLSFO), ae: n(r.auxEngineLSFO), boiler: n(r.boilerLSFO), total: n(r.totalLSFO), rob: n(r.robLSFO) },
    MDO:  { me: n(r.mainEngineMDO),  ae: n(r.auxEngineMDO),  boiler: n(r.boilerMDO),  total: n(r.totalMDO),  rob: n(r.robMDO)  },
    MGO:  { me: n(r.mainEngineMGO),  ae: n(r.auxEngineMGO),  boiler: n(r.boilerMGO),  total: n(r.totalMGO),  rob: n(r.robMGO)  },
    LNG:  { me: n(r.mainEngineLNG),  ae: 0,                  boiler: 0,               total: n(r.totalLNG),  rob: n(r.robLNG)  },
  }

  const f = fuelMap[fuelType]
  const totalFuelRob = n(r.robHFO) + n(r.robLSFO) + n(r.robMDO) + n(r.robMGO) + n(r.robLNG)

  return {
    FuelType: fuelType,
    FuelTypeTradeName: '',
    BunkerDeliveryNoteNumber: '',
    BunkerDeliveryDateTime: new Date(0),
    FuelProofOfSustainabilityReference: '',
    FuelBunkered: 0,
    FuelMass: 0,
    FuelDensity: 0,
    FuelSulphurContent: 0,
    FuelViscosity: 0,
    FuelWaterContent: 0,
    FuelHigherHeatingValue: 0,
    FuelLowerHeatingValue: 0,
    FuelCalorificValueReportingSchemeCode: '',
    FuelLowerCalorificValue: 0,
    FuelGrade: '',
    FuelGHGIntensityIMOManual: 0,
    FuelGHGIntensityIMOVoyage: 0,
    FuelBunkerPort: '',
    FuelBunkerPortName: '',
    FuelCarbonDioxideEmission: 0,
    TotalFuelConsumed: f.total,
    FuelConsumedByMainEngine: f.me,
    FuelConsumedByDieselElectricPropulsion: 0,
    FuelConsumedByDieselGenerator: f.ae,
    FuelConsumedByAuxiliaryBoiler: f.boiler,
    FuelConsumedByAuxiliaryEngine: 0,
    FuelConsumedByCargoHeating: 0,
    FuelConsumedByReeferContainers: 0,
    FuelConsumedByDischargePump: 0,
    FuelConsumedByOtherDevices: fuelType === dominantFuelType(r) ? n(r.inertGasGenerator) : 0,
    FuelRemainingOnBoard: totalFuelRob,
    SludgeRemainingOnBoard: 0,
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert a nooniq noon report + vessel info into a single SVD record.
 *
 * When the vessel burns multiple fuel types, all consumption is merged into
 * one FuelAndBunker entry whose FuelType is the dominant (highest-volume) type.
 * Use toSvdByFuelType() to produce one SVD record per fuel type instead.
 */
export function toSvd(
  report: NooniqReport,
  vessel: NooniqVesselInfo,
): StandardisedVesselDataset {
  return toSvdByFuelType(report, vessel, dominantFuelType(report))
}

/**
 * Like toSvd() but lets you specify which fuel type to use for the
 * FuelAndBunker section.  Call once per active fuel type to produce
 * multiple SVD records for a multi-fuel noon report.
 */
export function toSvdByFuelType(
  report: NooniqReport,
  vessel: NooniqVesselInfo,
  fuelType: SvdFuelType,
): StandardisedVesselDataset {
  const reportingDate = toIso8601(report.reportDate, report.reportTime)

  const General: GeneralInformation = {
    EventType: 'NOON',
    OperationType: report.operationalMode ?? 'Sea Passage',
    OperationDescription: '',
    PerformanceReportType: '',
    ElapsedTime: 'PT24H',
    ShipLatitude: n(report.latitude),
    ShipLongitude: n(report.longitude),
    ShipReportingDate: reportingDate,
    ShipFlagState: vessel.flagState ?? '',
    ShipRegistryPortCode: '',
    ShipRegistryPortName: '',
    ShipName: vessel.name,
    Imo: vessel.imo,
    Mmsi: '',
    ShipType: vessel.type ?? '',
    ShipTypeMarpolAnnexVi: '',
    NumberOfPassengers: 0,
    NumberOfCrew: 0,
    VoyageNumber: String(report.voyageNumber ?? ''),
    VoyageRemarks: report.remarksMaster ?? '',
    VoyageLegIdentifier: '',
    VoyageLegRemarks: report.remarksEngine ?? '',
  }

  const PortInformation: PortInformation = {
    DeparturePortCode: '',
    DeparturePortName: '',
    ArrivalPortCode: '',
    ArrivalPortName: '',
    InboundPortJurisdictionCode: '',
    OutboundPortJurisdictionCode: '',
    PilotBoardingPlaceName: '',
    PilotBoardingPlaceLocation: '',
    BerthName: '',
  }

  const ArrivalTimes: ArrivalTimes = {
    Arrival: '',
    Departure: '',
    LocationEta: '',
    LocationActual: '',
    PilotBoardingPlaceEta: '',
    PilotBoardingPlaceActual: '',
    VtsEta: '',
    VtsActual: '',
    NextPortEta: '',
    VoyageTime: 0,
  }

  const DeviationFromPlanned: DeviationFromPlanned = {
    Reason: '',
    Latitude: 0,
    Longitude: 0,
    ShipDeviationStartedTime: '',
    ShipDeviationStoppedTime: '',
  }

  const SpeedAndDistance: SpeedAndDistance = {
    DistanceThroughWater: n(report.engineDistance),
    DistanceOverGround: n(report.distanceRun),
    DistanceSailedInIce: 0,
    DistanceToNextPort: n(report.distanceToGo),
    DistanceToNextWaypoint: 0,
    TotalDistanceOnSeaPassage: 0,
    DistanceExcluded: 0,
    SpeedOverGround: n(report.speedMade),
    SpeedThroughWater: n(report.speedLog),
    SpeedPropeller: n(report.mainEngineRPM),
    SpeedProjected: 0,
    SpeedOrder: 0,
    Slip: n(report.slip),
    CourseOverGround: n(report.courseMade),
    ShipTrueHeading: n(report.courseGyro),
    ShipDraught: report.meanDraft != null ? String(report.meanDraft) : '',
    DraughtForward: n(report.forwardDraft),
    DraughtAft: n(report.aftDraft),
    ShipActualDeadweightTonnage: 0,
    ShipMaximumDeadweight: 0,
    LadenIndicator: n(report.cargoAmount) > 0,
    TotalBallastWaterOnboard: n(report.robBallastWater),
  }

  const Weather: WeatherInformation = {
    WeatherRemarks: report.visibility != null ? `Visibility: ${report.visibility}` : '',
    BadWeatherHours: 0,
    BadWeatherDistance: 0,
    WindForce: n(report.windForce),
    WindSpeed: '',
    WindDirection: report.windDirection != null ? String(report.windDirection) : '',
    WindDirectionEstimatedRelative: 0,
    WindDirectionEstimated: n(report.windDirection),
    AirTemperature: n(report.airTemperature),
    AtmosphericPressure: n(report.barometer),
    StateOfSea: report.seaState != null ? String(report.seaState) : '',
    SeaDirectionRelative: 0,
    SeaDirection: n(report.seaDirection),
    SeaHeight: 0,
    SwellDirectionRelative: 0,
    SwellDirection: n(report.swellDirection),
    SwellHeight: n(report.swellHeight),
    OceanCurrentDirectionRelative: 0,
    OceanCurrentDirection: 0,
    OceanCurrentDirectionWeatherProvider: 0,
  }

  const FreshWater: FreshWater = {
    FreshWaterBunkered: 0,
    FreshWaterProduced: n(report.fwGeneratorProduction),
    FreshWaterConsumed: 0,
    TechnicalWaterProduced: n(report.evaporatorProduction),
    TechnicalWaterConsumed: 0,
    WashWaterConsumed: 0,
    FreshWaterRemaining: n(report.robFreshWaterDomestic),
  }

  const Cargo: CargoInformation = {
    CargoDescription: report.operationalMode ?? '',
    GrossWeight: n(report.cargoAmount),
    GrossVolume: 0,
    BillOfLadingReference: '',
    BillOfLadingIssuedDate: new Date(0),
    TotalContainersTEU: 0,
    TotalFullContainersTEU: 0,
    TotalFullReeferContainersTEU: 0,
    ReeferSocketsInUse: 0,
    Chilled20FtReeferContainers: 0,
    Chilled40FtReeferContainers: 0,
    Frozen20FtReeferContainers: 0,
    Frozen40FtReeferContainers: 0,
    TotalVehiclesCEU: 0,
  }

  const ElectricityConsumption: ElectricityConsumption = {
    BoilerElectricityConsumption: 0,
    GeneratorProduction: 0,
    OffsetElectricityConsumption: 0,
    PowerConsumptionForPlant: 0,
    ElectricalForCargoCooling: 0,
    ElectricalForDischargePump: 0,
    ElectricalForReeferContainers: 0,
    ElectricalFromOnShorePowerSupply: 0,
    ElectricalFromZeroEmissionsTechnologies: 0,
    FuelTypeUsedForCargoCooling: '',
    FuelTypeUsedForDischargePump: '',
    FuelTypeUsedForReeferContainers: '',
    FuelOilConsumptionForCargoCooling: 0,
    FuelOilConsumptionForDischargePump: 0,
    FuelOilConsumptionForReeferContainers: 0,
  }

  const FuelAndBunker = buildFuelAndBunker(report, fuelType)

  const co2 = n(report.co2EmissionsTotal)
  const Emissions: Emissions = {
    TotalCo2: co2,
    TotalCo2Percentage: 0,
    TotalCo2TankToWake: co2,
    TotalCo2Captured: 0,
    TotalCh4: 0,
    TotalCh4ConvertedToCo2: 0,
    TotalN2o: 0,
    TotalN2oConvertedToCo2: 0,
    Ch4EmissionConversionFactor: 0,
    N2oEmissionConversionFactor: 0,
  }

  const CylinderLubeOil: CylinderLubeOilInformation = {
    RemainingOnBoard: n(report.robCylinderOil),
    FeedRate: 0,
    Consumption: 0,
    ReceivedDuringBunkering: 0,
  }

  return {
    General,
    PortInformation,
    ArrivalTimes,
    DeviationFromPlanned,
    SpeedAndDistance,
    Weather,
    FreshWater,
    Cargo,
    ElectricityConsumption,
    FuelAndBunker,
    Emissions,
    CylinderLubeOil,
  }
}

/**
 * Convert an SVD record into nooniq's flat noon-report format.
 *
 * Fields that exist only in nooniq (engine performance parameters, running
 * hours, scrubber flag, etc.) will be absent from the result — set them from
 * other sources before saving to the nooniq database.
 *
 * SVD's FuelAndBunker contains one fuel type.  Fuel consumption is written to
 * the matching nooniq column (e.g. FuelType=LSFO → mainEngineLSFO).  If you
 * are converting multiple SVD records (one per fuel type), call fromSvd() for
 * each and merge the fuel fields.
 */
export function fromSvd(svd: StandardisedVesselDataset): Partial<NooniqReport> {
  const { General: g, SpeedAndDistance: spd, Weather: wx, FreshWater: fw,
          Cargo: cargo, FuelAndBunker: fuel, Emissions: em, CylinderLubeOil: cyl } = svd

  const { reportDate, reportTime } = fromIso8601(g.ShipReportingDate)

  const ft = fuel.FuelType as SvdFuelType

  const fuelConsumption: Partial<NooniqReport> = {
    mainEngineHFO:  ft === 'HFO'  ? fuel.FuelConsumedByMainEngine         : null,
    mainEngineLSFO: ft === 'LSFO' ? fuel.FuelConsumedByMainEngine         : null,
    mainEngineMDO:  ft === 'MDO'  ? fuel.FuelConsumedByMainEngine         : null,
    mainEngineMGO:  ft === 'MGO'  ? fuel.FuelConsumedByMainEngine         : null,
    mainEngineLNG:  ft === 'LNG'  ? fuel.FuelConsumedByMainEngine         : null,
    auxEngineHFO:   ft === 'HFO'  ? fuel.FuelConsumedByDieselGenerator    : null,
    auxEngineLSFO:  ft === 'LSFO' ? fuel.FuelConsumedByDieselGenerator    : null,
    auxEngineMDO:   ft === 'MDO'  ? fuel.FuelConsumedByDieselGenerator    : null,
    auxEngineMGO:   ft === 'MGO'  ? fuel.FuelConsumedByDieselGenerator    : null,
    boilerHFO:      ft === 'HFO'  ? fuel.FuelConsumedByAuxiliaryBoiler    : null,
    boilerLSFO:     ft === 'LSFO' ? fuel.FuelConsumedByAuxiliaryBoiler    : null,
    boilerMDO:      ft === 'MDO'  ? fuel.FuelConsumedByAuxiliaryBoiler    : null,
    boilerMGO:      ft === 'MGO'  ? fuel.FuelConsumedByAuxiliaryBoiler    : null,
    totalHFO:       ft === 'HFO'  ? fuel.TotalFuelConsumed                : null,
    totalLSFO:      ft === 'LSFO' ? fuel.TotalFuelConsumed                : null,
    totalMDO:       ft === 'MDO'  ? fuel.TotalFuelConsumed                : null,
    totalMGO:       ft === 'MGO'  ? fuel.TotalFuelConsumed                : null,
    totalLNG:       ft === 'LNG'  ? fuel.TotalFuelConsumed                : null,
  }

  return {
    voyageNumber: g.VoyageNumber,
    reportDate,
    reportTime,
    timeZone: 'UTC',

    latitude: g.ShipLatitude,
    longitude: g.ShipLongitude,
    courseMade: spd.CourseOverGround,
    courseGyro: spd.ShipTrueHeading,
    speedMade: spd.SpeedOverGround,
    speedLog: spd.SpeedThroughWater,
    distanceRun: spd.DistanceOverGround,
    engineDistance: spd.DistanceThroughWater,
    distanceToGo: spd.DistanceToNextPort,
    slip: spd.Slip,
    forwardDraft: spd.DraughtForward,
    aftDraft: spd.DraughtAft,

    windDirection: parseFloat(wx.WindDirection) || null,
    windForce: wx.WindForce,
    seaDirection: wx.SeaDirection,
    seaState: parseFloat(wx.StateOfSea) || null,
    swellDirection: wx.SwellDirection,
    swellHeight: wx.SwellHeight,
    airTemperature: wx.AirTemperature,
    barometer: wx.AtmosphericPressure,

    ...fuelConsumption,

    fwGeneratorProduction: fw.FreshWaterProduced,
    evaporatorProduction: fw.TechnicalWaterProduced,

    robCylinderOil: cyl.RemainingOnBoard,
    robFreshWaterDomestic: fw.FreshWaterRemaining,
    robBallastWater: spd.TotalBallastWaterOnboard,

    co2EmissionsTotal: em.TotalCo2,
    operationalMode: g.OperationType,
    cargoAmount: cargo.GrossWeight,
    remarksMaster: g.VoyageRemarks,
    remarksEngine: g.VoyageLegRemarks,
  }
}

/**
 * Merge multiple partial NooniqReport objects produced by fromSvd() into one.
 * Use this when you have one SVD record per fuel type.
 *
 * @example
 * const merged = mergeFromSvdRecords(lsfoSvd, mgoSvd)
 */
export function mergeFromSvdRecords(...reports: Partial<NooniqReport>[]): Partial<NooniqReport> {
  return reports.reduce<Partial<NooniqReport>>((acc, cur) => {
    const merged = { ...acc }
    for (const [key, value] of Object.entries(cur) as [keyof NooniqReport, unknown][]) {
      const existing = merged[key]
      if (typeof value === 'number' && typeof existing === 'number') {
        // Sum numeric fuel/ROB fields from multiple fuel-type records
        ;(merged as Record<string, unknown>)[key] = existing + value
      } else if (value !== null && value !== undefined) {
        ;(merged as Record<string, unknown>)[key] = value
      }
    }
    return merged
  }, {})
}
