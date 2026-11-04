/**
 * Synthetic Airline Flight Operations Documents Fixture
 * Used for deterministic end-to-end vector indexing and idempotency verification.
 */

export const DOC_SOP_787_ICE = {
  documentId: 'SOP-AIR-787-ICE',
  title: 'Boeing 787 Engine and Wing Anti-Ice Operational Procedures',
  documentType: 'SOP',
  version: '3.1',
  status: 'APPLICABLE',
  applicabilityStatus: 'APPLICABLE',
  verificationStatus: 'VERIFIED_OFFICIAL',
  effectiveDate: '2025-01-15T00:00:00.000Z',
  publicationDate: '2024-12-01T00:00:00.000Z',
  fleet: 'B787-8/9',
  source: 'Boeing 787 Flight Crew Operations Manual Chapter 3',
  text: `
SECTION 1: ICING CONDITIONS DEFINITION
Icing conditions exist on ground or in flight when Outside Air Temperature (OAT) on ground or Total Air Temperature (TAT) in flight is 10°C (50°F) or below, and visible moisture in any form is present (such as clouds, fog with visibility of one statute mile or less, rain, snow, sleet, or ice crystals).
Icing conditions also exist when operating on ramps, taxiways, or runways where surface snow, ice, standing water, or slush may be ingested by engines or freeze on nacelles or engine sensor probes.

SECTION 2: AUTOMATIC ANTI-ICE OPERATION
The Boeing 787 is equipped with an automatic ice detection and anti-ice management system.
1. Engine Anti-Ice Selector: Leave in AUTO for all normal flight operations, including ground taxi, takeoff, climb, cruise, and descent.
2. When ice crystals or moisture are sensed below 10°C, the engine anti-ice valves automatically command OPEN.
3. The EICAS memo message ENG ANTI-ICE appears when engine anti-ice valves are open.
4. If AUTO mode fails, select manual ON immediately when operating in icing conditions.

SECTION 3: WING ANTI-ICE SYSTEM
1. Wing anti-ice uses electrical heating mats embedded in the wing leading edges.
2. In AUTO mode, wing anti-ice operates automatically only after liftoff. Wing anti-ice will NOT operate on the ground during taxi.
3. CAUTION: Do not operate Wing Anti-Ice manually when Total Air Temperature is above 10°C to avoid structural overheating.
4. During descent through freezing levels, monitor EICAS advisory messages for any asymmetric wing heating indications.
`
};

export const DOC_QRH_320_SMOKE = {
  documentId: 'QRH-AIR-320-SMK',
  title: 'Airbus A320 Smoke, Fire and Fumes Emergency Procedure',
  documentType: 'QRH',
  version: '5.0',
  status: 'APPLICABLE',
  applicabilityStatus: 'APPLICABLE',
  verificationStatus: 'VERIFIED_OFFICIAL',
  effectiveDate: '2024-06-01T00:00:00.000Z',
  publicationDate: '2024-05-15T00:00:00.000Z',
  fleet: 'A320-200/NEO',
  source: 'Airbus A320 Quick Reference Handbook Abnormal Procedures',
  text: `
EMERGENCY PROCEDURE: SMOKE / COCKPIT FUMES (MEMORY ITEMS)
WARNING: Flight crew safety is primary. Do not delay emergency descent or oxygen donning to troubleshoot smoke origins.

STEP 1: CREW OXYGEN MASKS ................................. DON / 100% / EMER
Ensure positive pressure delivery. Adjust interphone switches to MASK position to preserve flight deck communication.

STEP 2: SMOKE GOGGLES ..................................... DON (IF APPLICABLE)
Clear moisture and verify 100% seal around facial contour.

STEP 3: COMMUNICATION ..................................... ESTABLISH
Establish clear audio communication between Pilot Flying (PF) and Pilot Monitoring (PM). Notify senior cabin crew via emergency interphone.

STEP 4: VENTILATION BLOWER ................................ OVRD
Push the BLOWER push button on ventilation panel to OVERRIDE to initiate emergency avionics smoke extraction overboard.

STEP 5: AIR CONDITIONING PACKS ............................ CHECK FLOW
Verify PACK 1 and PACK 2 operation. If smoke source is identified in air conditioning duct, isolate the affected pack immediately.
Land at nearest suitable airport without delay if smoke does not immediately clear.
`
};

export const DOC_SB_WINTER_OPS = {
  documentId: 'SB-OPS-2024-11',
  title: 'Winter Operations: Runway Condition Assessment & TALPA Matrix',
  documentType: 'SAFETY_BULLETIN',
  version: '1.0',
  status: 'APPLICABLE',
  applicabilityStatus: 'APPLICABLE',
  verificationStatus: 'VERIFIED_OFFICIAL',
  effectiveDate: '2024-11-01T00:00:00.000Z',
  publicationDate: '2024-10-20T00:00:00.000Z',
  fleet: 'ALL',
  source: 'Flight Operations Technical Advisory Bulletin 2024-11',
  text: `
OVERVIEW: RUNWAY CONDITION CODES (RWYCC)
In accordance with FAA Takeoff and Landing Performance Assessment (TALPA) criteria, flight crews must compute landing performance using Runway Condition Codes from 6 (Dry) down to 0 (Nil).

1. RWYCC 6: Dry runway surface. Normal crosswind limits apply.
2. RWYCC 5: Good braking action. Wet runway surface with water depth 3mm or less. Maximum crosswind limit: 33 knots.
3. RWYCC 3: Medium braking action. Slippery wet, dry snow, or compacted snow. Maximum crosswind limit: 20 knots.
4. RWYCC 1: Poor braking action. Ice or wet snow over ice. Maximum crosswind limit: 10 knots.
5. RWYCC 0: Nil braking action. Operations are PROHIBITED. Do not attempt takeoff or landing when RWYCC is 0.

CREW ACTION GUIDELINES:
Before commencing approach in freezing precipitation, obtain latest ATIS or digital NOTAM for field condition reports (FICON).
Always apply reverse thrust symmetrically and maintain runway centerline with rudder and differential braking.
`
};

/**
 * Updated revision of DOC_SOP_787_ICE with modified content to test
 * idempotent document updates and orphan point cleanup.
 */
export const DOC_SOP_787_ICE_REV2 = {
  documentId: 'SOP-AIR-787-ICE',
  title: 'Boeing 787 Engine and Wing Anti-Ice Operational Procedures (Revision 4)',
  documentType: 'SOP',
  version: '4.0',
  status: 'APPLICABLE',
  applicabilityStatus: 'APPLICABLE',
  verificationStatus: 'VERIFIED_OFFICIAL',
  effectiveDate: '2025-06-01T00:00:00.000Z',
  publicationDate: '2025-05-10T00:00:00.000Z',
  fleet: 'B787-8/9/10',
  source: 'Boeing 787 FCOM Revision 4 Section 3',
  text: `
SECTION 1: REVISED ICING CRITERIA
Icing conditions exist when Outside Air Temperature (OAT) on ground or Total Air Temperature (TAT) in flight is 10°C (50°F) or below in visible moisture.
In Revision 4, ground operations with engine anti-ice active have been updated to require 120-second warmup before takeoff in heavy freezing fog.

SECTION 2: AUTOMATIC SYSTEM HEALTH MONITORING
The B787 engine anti-ice system uses dual-channel ice detection probes.
If one channel reports FAULT, the remaining channel continues autonomous operation with an advisory EICAS status message.
`
};

export const ALL_SYNTHETIC_DOCS = [
  DOC_SOP_787_ICE,
  DOC_QRH_320_SMOKE,
  DOC_SB_WINTER_OPS
];

