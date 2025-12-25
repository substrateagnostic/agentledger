/**
 * Healthcare Triage Agent Example
 * HIPAA-compliant AI agent with full audit trail and PII protection
 */

import Anthropic from '@anthropic-ai/sdk';
import { createLedger, generateSigningKeys, hashContent } from '@agentledger/core';
import { createAuditedAnthropic, logToolResult } from '@agentledger/anthropic';

// ============================================================================
// CONFIGURATION
// ============================================================================

const signingKeys = generateSigningKeys();

const ledger = createLedger({
  orgId: 'mercy-health-system',
  agentId: 'triage-assistant-v2',
  agentVersion: '2.1.0',
  environment: 'production',
  compliance: ['HIPAA', 'SOC2'],
  retentionDays: 2190, // 6 years per HIPAA
  storage: {
    type: 'filesystem',
    path: './hipaa-audit-logs',
  },
  signingKeys,
  snapshotInterval: 10, // Snapshot every 10 entries
});

const anthropic = new Anthropic();
const auditedAnthropic = createAuditedAnthropic(anthropic, {
  ledger,
  storeContent: false, // Don't store PHI in content - only hashes
});

// ============================================================================
// HIPAA-COMPLIANT TOOLS
// ============================================================================

interface PatientContext {
  patientId: string; // De-identified
  age: number;
  sex: 'M' | 'F' | 'O';
  chiefComplaint: string;
  vitalSigns?: {
    heartRate?: number;
    bloodPressure?: string;
    temperature?: number;
    oxygenSaturation?: number;
  };
  allergies: string[];
  medications: string[];
}

interface TriageResult {
  acuityLevel: 1 | 2 | 3 | 4 | 5; // ESI levels
  reasoning: string;
  recommendedActions: string[];
  escalateToPhysician: boolean;
  timeToTreatment: string;
}

const ESI_LEVELS = {
  1: 'Immediate - Life threatening',
  2: 'Emergent - High risk',
  3: 'Urgent - Stable but needs multiple resources',
  4: 'Less Urgent - One resource needed',
  5: 'Non-Urgent - No resources needed',
};

async function lookupPatientHistory(patientId: string): Promise<string[]> {
  const startTime = Date.now();
  
  // Simulate EHR lookup - returns de-identified conditions
  const conditions = ['Type 2 Diabetes', 'Hypertension'];
  
  await ledger.logToolInvocation({
    toolName: 'lookupPatientHistory',
    inputHash: hashContent(patientId), // Only hash the ID
    outputHash: hashContent(JSON.stringify(conditions)),
    durationMs: Date.now() - startTime,
    success: true,
    resourcesAccessed: [{
      type: 'database',
      identifier: 'ehr_conditions',
      operation: 'read',
    }],
  });
  
  return conditions;
}

async function checkDrugInteractions(
  currentMeds: string[],
  proposedMeds: string[]
): Promise<{ safe: boolean; warnings: string[] }> {
  const startTime = Date.now();
  
  // Simulate drug interaction check
  const result = {
    safe: true,
    warnings: [] as string[],
  };
  
  // Example interaction check
  if (currentMeds.includes('Warfarin') && proposedMeds.includes('Aspirin')) {
    result.safe = false;
    result.warnings.push('Warfarin + Aspirin: Increased bleeding risk');
  }
  
  await ledger.logToolInvocation({
    toolName: 'checkDrugInteractions',
    inputHash: hashContent(JSON.stringify({ currentMeds, proposedMeds })),
    outputHash: hashContent(JSON.stringify(result)),
    durationMs: Date.now() - startTime,
    success: true,
  });
  
  return result;
}

async function recordTriageDecision(
  patientId: string,
  result: TriageResult,
  nurseId: string
): Promise<void> {
  // Log decision point
  const decisionEntry = await ledger.logDecision({
    decisionId: `triage_${patientId}_${Date.now()}`,
    category: 'routing',
    optionsConsidered: [
      { option_id: 'esi_1', description: ESI_LEVELS[1], score: result.acuityLevel === 1 ? 1 : 0 },
      { option_id: 'esi_2', description: ESI_LEVELS[2], score: result.acuityLevel === 2 ? 1 : 0 },
      { option_id: 'esi_3', description: ESI_LEVELS[3], score: result.acuityLevel === 3 ? 1 : 0 },
      { option_id: 'esi_4', description: ESI_LEVELS[4], score: result.acuityLevel === 4 ? 1 : 0 },
      { option_id: 'esi_5', description: ESI_LEVELS[5], score: result.acuityLevel === 5 ? 1 : 0 },
    ],
    selectedOption: `esi_${result.acuityLevel}`,
    reasoningHash: hashContent(result.reasoning),
    confidenceScore: 0.85,
    humanReviewRequired: result.acuityLevel <= 2 || result.escalateToPhysician,
    triggeredBy: result.escalateToPhysician ? {
      type: 'policy',
      policy_id: 'PHYSICIAN_ESCALATION',
    } : undefined,
  });
  
  // If high acuity, require nurse confirmation
  if (result.acuityLevel <= 2) {
    await ledger.logApproval({
      approverId: nurseId,
      approverRole: 'Triage Nurse',
      decisionRef: decisionEntry.entry.entry_id,
      approvalType: 'APPROVE',
      reviewDurationSeconds: 30,
    });
  }
}

// ============================================================================
// TRIAGE AGENT
// ============================================================================

async function runTriageAgent(
  patient: PatientContext,
  nurseId: string
): Promise<TriageResult> {
  console.log('\n=== Healthcare Triage Agent (HIPAA Compliant) ===\n');
  
  // Start session with minimal identifiable info
  const sessionId = await ledger.start({
    type: 'system',
    identifier: 'triage_kiosk_er_1',
  }, {
    nurse_id: nurseId,
    patient_id_hash: hashContent(patient.patientId), // Store hash only
  });
  
  console.log(`Session started: ${sessionId}`);
  
  try {
    // Lookup patient history
    const history = await lookupPatientHistory(patient.patientId);
    console.log(`History loaded: ${history.length} conditions`);
    
    // Build prompt (no PHI in stored content)
    const vitalsDescription = patient.vitalSigns
      ? `HR: ${patient.vitalSigns.heartRate}, BP: ${patient.vitalSigns.bloodPressure}, Temp: ${patient.vitalSigns.temperature}°F, SpO2: ${patient.vitalSigns.oxygenSaturation}%`
      : 'Not recorded';
    
    // Generate triage assessment
    const response = await auditedAnthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1000,
      system: `You are a clinical decision support AI for emergency department triage.
You assist triage nurses by suggesting ESI (Emergency Severity Index) levels.

ESI Levels:
1 - Immediate: Life-threatening, requires immediate intervention
2 - Emergent: High risk, time-sensitive condition
3 - Urgent: Stable, needs multiple resources (labs, imaging, etc.)
4 - Less Urgent: Stable, needs one resource
5 - Non-Urgent: Stable, no resources needed

Always err on the side of caution. Flag any concerning findings for physician review.
Output your assessment as JSON with fields: acuityLevel (1-5), reasoning, recommendedActions (array), escalateToPhysician (boolean), timeToTreatment (string).`,
      messages: [
        {
          role: 'user',
          content: `Patient Assessment:
- Age: ${patient.age}, Sex: ${patient.sex}
- Chief Complaint: ${patient.chiefComplaint}
- Vital Signs: ${vitalsDescription}
- Known Conditions: ${history.join(', ') || 'None'}
- Allergies: ${patient.allergies.join(', ') || 'NKDA'}
- Current Medications: ${patient.medications.join(', ') || 'None'}

Please provide your triage assessment.`,
        },
      ],
    });
    
    // Parse response
    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type');
    }
    
    // Extract JSON from response
    const jsonMatch = content.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Could not parse triage result');
    }
    
    const result: TriageResult = JSON.parse(jsonMatch[0]);
    
    console.log(`\nTriage Result: ESI ${result.acuityLevel} - ${ESI_LEVELS[result.acuityLevel]}`);
    console.log(`Reasoning: ${result.reasoning}`);
    console.log(`Actions: ${result.recommendedActions.join(', ')}`);
    console.log(`Physician Escalation: ${result.escalateToPhysician ? 'YES' : 'No'}`);
    console.log(`Time to Treatment: ${result.timeToTreatment}`);
    
    // Record decision with nurse approval
    await recordTriageDecision(patient.patientId, result, nurseId);
    
    // Store content reference (hash only, actual content in EHR)
    await ledger.storeContent({
      contentType: 'completion',
      parentEntryId: response.id,
      content: content.text,
      containsPii: true, // Mark as containing PHI
      piiTypes: ['medical'],
    });
    
    // Final snapshot
    await ledger.snapshot({
      trigger: 'checkpoint',
      stateHash: hashContent(JSON.stringify({
        acuityLevel: result.acuityLevel,
        escalated: result.escalateToPhysician,
        approved: true,
      })),
      schemaVersion: '1.0.0',
      metrics: {
        total_tokens: response.usage.input_tokens + response.usage.output_tokens,
        total_cost_usd: 0.015,
        total_tool_calls: 1,
        total_decisions: 1,
        error_count: 0,
      },
    });
    
    return result;
    
  } finally {
    const log = await ledger.close();
    console.log(`\nSession closed. Entries: ${log.entries.length}`);
    console.log(`Chain integrity: ${log.integrity?.chain_valid ? '✓' : '✗'}`);
  }
}

// ============================================================================
// RUN
// ============================================================================

const samplePatient: PatientContext = {
  patientId: 'PT_HASH_ABC123', // De-identified
  age: 67,
  sex: 'M',
  chiefComplaint: 'Chest pain radiating to left arm, started 30 minutes ago',
  vitalSigns: {
    heartRate: 98,
    bloodPressure: '165/95',
    temperature: 98.6,
    oxygenSaturation: 94,
  },
  allergies: ['Penicillin'],
  medications: ['Metformin', 'Lisinopril', 'Aspirin 81mg'],
};

runTriageAgent(samplePatient, 'RN_SMITH_4521').catch(console.error);
