/**
 * ============================================================================
 * aeroRAG API Service Client
 * Connects frontend to the Express backend with offline demo resilience
 * ============================================================================
 */

const API_BASE_URL = '/api';

// Token storage helpers - Default to demo pilot session if not present
export const getAuthToken = () => {
  let token = localStorage.getItem('aerorag_token');
  if (!token) {
    token = 'demo-mock-jwt-token-aerorag';
    localStorage.setItem('aerorag_token', token);
  }
  return token;
};

export const setAuthToken = (token) => {
  if (token) localStorage.setItem('aerorag_token', token);
  else localStorage.removeItem('aerorag_token');
};

const getHeaders = (isJson = true) => {
  const headers = {};
  if (isJson) headers['Content-Type'] = 'application/json';
  const token = getAuthToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
};

// Built-in synthetic procedural responses for offline/demo reliability
const DEMO_PROCEDURAL_RESPONSES = {
  'emergency descent': {
    answer: "EMERGENCY DESCENT PROCEDURAL ACTIONS:\n\n1. OXYGEN MASKS - DON AND SET TO 100% (Flight Crew immediate memory item).\n2. CREW COMMUNICATIONS - ESTABLISH (Interphone on, verify hot mic).\n3. ALTITUDE - SET TARGET (10,000 feet MSL or Minimum Enroute Altitude / MEA, whichever is higher).\n4. THRUST LEVERS - CLOSE TO IDLE.\n5. SPEEDBRAKE LEVER - EXTEND FULLY TO FLIGHT DETENT.\n6. DESCENT PROFILE - Initiate descent at Vmo/Mmo structural limit airspeed unless structural damage is suspected.",
    confidence: 0.98,
    isGrounded: true,
    sources: [
      {
        documentId: "DOC-QRH-737-01",
        title: "Quick Reference Handbook: Non-Normal Procedures",
        effectiveDate: "2026-01-01",
        status: "APPROVED"
      }
    ],
    retrievedChunks: 4,
    status: "APPROVED",
    disclaimer: "Semantic similarity alone does not establish regulatory validity. Always verify aircraft effectivity & operational approval."
  },
  'engine failure': {
    answer: "ENGINE FAILURE AFTER V1 TAKEOFF ACTIONS:\n\n1. DIRECTIONAL CONTROL - MAINTAIN WITH RUDDER PEDALS (keep runway centerline).\n2. ROTATION - ROTATE SMOOTHLY AT Vr TOWARD 10° TO 12° PITCH ATTITUDE.\n3. AIRSPEED - CLIMB AND MAINTAIN V2 UNTIL ACCELERATION HEIGHT.\n4. LANDING GEAR - SELECT UP (Only after confirming positive rate of climb on altimeter/VSI).\n5. SAFETY RESTRICTION - DO NOT SECURE ENGINE SWITCHES, APU, OR THRUST LEVERS BELOW 400 FEET AGL.\n6. LEVEL-OFF & CLEAN-UP - At engine-out acceleration altitude (typically 1000 ft AGL), accelerate and retract flaps on schedule.",
    confidence: 0.96,
    isGrounded: true,
    sources: [
      {
        documentId: "DOC-FCTM-737-03",
        title: "Flight Crew Training Manual",
        effectiveDate: "2026-01-15",
        status: "APPROVED"
      }
    ],
    retrievedChunks: 5,
    status: "APPROVED",
    disclaimer: "Semantic similarity alone does not establish regulatory validity. Always verify aircraft effectivity & operational approval."
  },
  'sterile cockpit': {
    answer: "STERILE FLIGHT DECK REGULATIONS (FAR 121.542 / EASA CAT.GEN.MPA.175):\n\n1. APPLICABLE PHASES - During all critical flight operations below 10,000 feet MSL (excluding cruise flight), and during all ground taxi, takeoff, and landing operations.\n2. PROHIBITED ACTIVITIES - Flight crew members shall NOT engage in:\n   • Casual or extraneous conversation.\n   • Company paperwork unrelated to immediate flight safety.\n   • Reading publications or using personal electronic devices.\n   • Non-essential cabin-to-flight-deck interphone calls.\n3. CABIN CREW PROTOCOL - Interphone contacts restricted strictly to emergency conditions (smoke, fire, medical distress, security threat).",
    confidence: 0.99,
    isGrounded: true,
    sources: [
      {
        documentId: "DOC-FOM-GEN-04",
        title: "Flight Operations Manual: General Policies",
        effectiveDate: "2026-02-01",
        status: "APPROVED"
      }
    ],
    retrievedChunks: 3,
    status: "APPROVED",
    disclaimer: "Semantic similarity alone does not establish regulatory validity. Always verify aircraft effectivity & operational approval."
  },
  'go around': {
    answer: "MISSED APPROACH & GO-AROUND EXECUTION:\n\n1. PILOT FLYING - Press TO/GA switch and push thrust levers to Go-Around thrust.\n2. CALLOUT - Call 'GO-AROUND, FLAPS 15' (or Flaps 20 per aircraft type).\n3. ROTATION - Smoothly rotate toward go-around pitch target (~15° nose up).\n4. PILOT MONITORING - Verify go-around thrust is set, call 'THRUST SET', select flap lever to 15.\n5. POSITIVE CLIMB - When positive rate confirmed on both altimeters, call 'POSITIVE RATE'.\n6. GEAR - PF calls 'GEAR UP', PM selects landing gear lever UP.\n7. MISSED APPROACH TRACK - Engage LNAV / HDG SEL and track published missed approach procedure.",
    confidence: 0.97,
    isGrounded: true,
    sources: [
      {
        documentId: "DOC-SOP-737-08",
        title: "Standard Operating Procedures: Approach & Landing",
        effectiveDate: "2026-03-01",
        status: "APPROVED"
      }
    ],
    retrievedChunks: 4,
    status: "APPROVED",
    disclaimer: "Semantic similarity alone does not establish regulatory validity. Always verify aircraft effectivity & operational approval."
  },
  'contaminated runway': {
    answer: "CONTAMINATED RUNWAY TAKEOFF PERFORMANCE (CURRENT MANDATORY DIRECTIVE):\n\n1. REGULATORY NOTICE (FAA SAFO 19001 / ICAO GRF) - Takeoff credit for reverse thrust is STRICTLY PROHIBITED for contaminated runway stopping distance dispatch calculations.\n2. FRICTION BASELINE - Use updated Runway Condition Code (RWYCC 2) baseline friction coefficient of 0.14.\n3. CROSSWIND LIMIT - Maximum recommended crosswind on contaminated runway (standing water/slush > 3mm) is 15 knots.\n4. SUPERSEDED POLICY WARNING - Previous 2023 manual revisions permitting reverse thrust credit are officially SUPERSEDED and must not be used for flight planning.",
    confidence: 0.95,
    isGrounded: true,
    sources: [
      {
        documentId: "DOC-FCOM-OPS-2026-SB04",
        title: "Flight Crew Operations Manual: Winter Operations Directive",
        effectiveDate: "2026-01-10",
        status: "CURRENT"
      }
    ],
    retrievedChunks: 5,
    status: "CURRENT",
    disclaimer: "Semantic similarity alone does not establish regulatory validity. High similarity with superseded 2023 bulletin detected; always prioritize CURRENT revision status."
  }
};

/**
 * Directly tests the backend HTTP connection and returns detailed diagnostics
 */
export async function testBackendConnection() {
  const start = performance.now();
  try {
    const res = await fetch(`${API_BASE_URL}/health`);
    const latency = Math.round(performance.now() - start);
    if (res.ok) {
      const data = await res.json();
      return {
        success: true,
        endpoint: `${API_BASE_URL}/health`,
        status: res.status,
        latencyMs: latency,
        data
      };
    } else {
      return {
        success: false,
        endpoint: `${API_BASE_URL}/health`,
        status: res.status,
        error: `HTTP Error ${res.status}`
      };
    }
  } catch (err) {
    return {
      success: false,
      endpoint: `${API_BASE_URL}/health`,
      error: err.message || 'Connection refused (server not running on port 5000)'
    };
  }
}

/**
 * Executes an Airline Procedure Intelligence RAG Query
 */
export async function queryProcedure(queryText, options = {}) {
  try {
    const res = await fetch(`${API_BASE_URL}/rag/query`, {
      method: 'POST',
      headers: getHeaders(true),
      body: JSON.stringify({ query: queryText, options })
    });

    if (res.ok) {
      const data = await res.json();
      return {
        ...data,
        isSimulated: false,
        isLiveBackend: true,
        backendServer: 'http://localhost:5000'
      };
    } else {
      console.warn(`[aeroRAG Client] Backend responded with status ${res.status}`);
    }
  } catch (err) {
    console.warn('[aeroRAG Client] Backend offline or unreachable, employing high-fidelity simulated response.');
  }

  // Fallback to high-fidelity simulated intelligence response
  const lower = queryText.toLowerCase();
  let matched = null;
  for (const [key, val] of Object.entries(DEMO_PROCEDURAL_RESPONSES)) {
    if (lower.includes(key)) {
      matched = val;
      break;
    }
  }

  if (!matched) {
    matched = {
      answer: `TACTICAL PROCEDURE RECOMMENDATION FOR: "${queryText}"\n\n1. VERIFY FLIGHT ENVELOPE - Maintain airspeed within operational limits for current configuration.\n2. CONSULT QUICK REFERENCE HANDBOOK (QRH) - Reference relevant checklist index under Flight Crew Procedures.\n3. CREW COORDINATION - Pilot Flying maintains aircraft trajectory; Pilot Monitoring executes non-normal checklist.\n4. INFORM ATC - Advise Air Traffic Control of flight intentions and operational requirements.`,
      confidence: 0.91,
      isGrounded: true,
      sources: [
        {
          documentId: "DOC-FOM-737-GEN",
          title: "Flight Operations General Manual",
          effectiveDate: "2026-01-01",
          status: "APPROVED"
        }
      ],
      retrievedChunks: 3,
      status: "APPROVED",
      disclaimer: "Semantic similarity alone does not establish regulatory validity. Always verify aircraft effectivity & operational approval."
    };
  }

  return {
    ...matched,
    isSimulated: true,
    isLiveBackend: false
  };
}

/**
 * Fetches available airline flight manuals and procedures
 */
export async function getDocuments() {
  try {
    const res = await fetch(`${API_BASE_URL}/documents`, {
      headers: getHeaders(true)
    });
    if (res.ok) {
      const data = await res.json();
      return data;
    }
  } catch (err) {
    console.warn('[aeroRAG Client] Backend documents unreachable, loading offline manuals catalog.');
  }

  // Default synthetic airline documents catalog
  return [
    {
      _id: "doc-1",
      documentId: "DOC-QRH-737-01",
      title: "Quick Reference Handbook: Non-Normal Procedures",
      documentType: "Operational QRH",
      status: "APPROVED",
      effectiveDate: "2026-01-01",
      sectionsCount: 14,
      pages: 184,
      aircraftType: "Boeing 737-800 / MAX",
      description: "Flight deck emergency and non-normal quick reference checklists."
    },
    {
      _id: "doc-2",
      documentId: "DOC-FCTM-737-03",
      title: "Flight Crew Training Manual",
      documentType: "Training Manual",
      status: "APPROVED",
      effectiveDate: "2026-01-15",
      sectionsCount: 22,
      pages: 310,
      aircraftType: "Boeing 737 Series",
      description: "Comprehensive flight crew maneuver techniques, engine failure profiles, and aerodynamics."
    },
    {
      _id: "doc-3",
      documentId: "DOC-FOM-GEN-04",
      title: "Flight Operations Manual: General Policies",
      documentType: "Operations Policy",
      status: "APPROVED",
      effectiveDate: "2026-02-01",
      sectionsCount: 18,
      pages: 240,
      aircraftType: "Fleet Wide",
      description: "Regulatory sterile cockpit policies, CRM directives, dispatch limitations."
    },
    {
      _id: "doc-4",
      documentId: "DOC-SOP-737-08",
      title: "Standard Operating Procedures: Approach & Landing",
      documentType: "SOP Manual",
      status: "APPROVED",
      effectiveDate: "2026-03-01",
      sectionsCount: 12,
      pages: 142,
      aircraftType: "Boeing 737-800 / MAX",
      description: "Standardized callouts, stabilized approach criteria, and missed approach profiles."
    },
    {
      _id: "doc-5",
      documentId: "DOC-FCOM-OPS-2026-SB04",
      title: "Flight Crew Operations Manual: Winter Operations Directive",
      documentType: "Safety Bulletin",
      status: "CURRENT",
      effectiveDate: "2026-01-10",
      sectionsCount: 8,
      pages: 45,
      aircraftType: "Fleet Wide",
      description: "Mandatory FAA SAFO 19001 / ICAO GRF contaminated runway takeoff calculations."
    },
    {
      _id: "doc-6",
      documentId: "DOC-FCOM-OPS-2023",
      title: "Winter Operations Manual 2023 (OBSOLETE)",
      documentType: "Safety Bulletin",
      status: "SUPERSEDED",
      effectiveDate: "2023-11-01",
      supersededBy: "DOC-FCOM-OPS-2026-SB04",
      sectionsCount: 7,
      pages: 40,
      aircraftType: "Fleet Wide",
      description: "Historical reverse thrust credit calculation - superseded by 2026 Winter Directive."
    }
  ];
}

/**
 * Uploads a new flight manual document
 */
export async function uploadDocumentFile(file, metadata = {}) {
  const formData = new FormData();
  formData.append('file', file);
  Object.keys(metadata).forEach(key => {
    formData.append(key, metadata[key]);
  });

  const res = await fetch(`${API_BASE_URL}/documents/upload`, {
    method: 'POST',
    headers: getHeaders(false),
    body: formData
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'Upload failed' }));
    throw new Error(error.message || 'Failed to upload document');
  }

  return await res.json();
}

/**
 * Checks system health and vector database reachability
 */
export async function getSystemHealth() {
  const start = performance.now();
  try {
    const res = await fetch(`${API_BASE_URL}/health`);
    const latency = Math.round(performance.now() - start);
    if (res.ok) {
      const data = await res.json();
      return {
        ...data,
        online: true,
        latencyMs: latency
      };
    }
  } catch (err) {
    // Offline / fallback
  }

  return {
    status: 'standalone_mode',
    mongodb: 'demo_memory',
    chromadb: 'connected (in-memory mock)',
    demoMode: true,
    online: false,
    latencyMs: 0,
    timestamp: new Date().toISOString()
  };
}

/**
 * Authenticates user or sets demo pilot profile
 */
export async function loginUser(email, password) {
  try {
    const res = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    if (res.ok) {
      const data = await res.json();
      setAuthToken(data.token);
      return data.user;
    }
  } catch (e) {
    // Fallback to demo login
  }

  // Demo user fallback
  const demoUser = {
    _id: "demo-captain-01",
    name: "Captain Vance Sterling",
    email: email || "captain.sterling@aerorag.aero",
    role: "admin",
    callsign: "SPEEDBIRD-737",
    fleet: "Boeing 737 MAX",
    license: "ATPL-A-849204"
  };
  setAuthToken("demo-mock-jwt-token-aerorag");
  return demoUser;
}

export default {
  queryProcedure,
  getDocuments,
  uploadDocumentFile,
  getSystemHealth,
  testBackendConnection,
  loginUser,
  getAuthToken,
  setAuthToken
};
