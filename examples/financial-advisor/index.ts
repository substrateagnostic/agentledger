/**
 * Financial Advisor Agent Example
 * FINRA 4511/3110 compliant AI agent with full audit trail
 */

import OpenAI from 'openai';
import { createLedger, generateSigningKeys, hashContent } from '@agentledger/core';
import { createAuditedOpenAI } from '@agentledger/openai';

// ============================================================================
// CONFIGURATION
// ============================================================================

// Generate or load signing keys (in production, load from secure storage)
const signingKeys = generateSigningKeys();

// Create the audit ledger
const ledger = createLedger({
  orgId: 'acme-financial',
  agentId: 'financial-advisor-v1',
  agentVersion: '1.0.0',
  environment: 'production',
  compliance: ['FINRA_4511', 'FINRA_3110'],
  retentionDays: 2555, // 7 years per FINRA
  storage: {
    type: 'filesystem',
    path: './audit-logs',
  },
  signingKeys,
});

// Create audited OpenAI client
const openai = new OpenAI();
const auditedOpenAI = createAuditedOpenAI(openai, {
  ledger,
  storeContent: true, // Store full prompts/completions for FINRA
});

// ============================================================================
// AGENT TOOLS
// ============================================================================

interface PortfolioData {
  clientId: string;
  holdings: { symbol: string; shares: number; value: number }[];
  riskTolerance: 'conservative' | 'moderate' | 'aggressive';
}

async function getPortfolio(clientId: string): Promise<PortfolioData> {
  // Simulate database lookup
  const startTime = Date.now();
  
  const portfolio: PortfolioData = {
    clientId,
    holdings: [
      { symbol: 'VTI', shares: 100, value: 25000 },
      { symbol: 'BND', shares: 50, value: 5000 },
      { symbol: 'AAPL', shares: 20, value: 3500 },
    ],
    riskTolerance: 'moderate',
  };
  
  // Log tool invocation
  await ledger.logToolInvocation({
    toolName: 'getPortfolio',
    inputHash: hashContent(JSON.stringify({ clientId })),
    outputHash: hashContent(JSON.stringify(portfolio)),
    durationMs: Date.now() - startTime,
    success: true,
    resourcesAccessed: [{
      type: 'database',
      identifier: 'client_portfolios',
      operation: 'read',
    }],
  });
  
  return portfolio;
}

async function executeRecommendation(
  clientId: string,
  action: string,
  approverId: string
): Promise<void> {
  // Log decision point
  const decisionEntry = await ledger.logDecision({
    decisionId: `recommendation_${Date.now()}`,
    category: 'routing',
    optionsConsidered: [
      { option_id: 'execute', description: 'Execute the recommendation' },
      { option_id: 'defer', description: 'Defer to human advisor' },
      { option_id: 'reject', description: 'Reject recommendation' },
    ],
    selectedOption: 'execute',
    reasoningHash: hashContent(`Executing recommendation for client ${clientId}: ${action}`),
    humanReviewRequired: true, // Requires supervisor approval
    triggeredBy: {
      type: 'policy',
      policy_id: 'FINRA_3110_SUPERVISION',
    },
  });
  
  // Log human approval
  await ledger.logApproval({
    approverId,
    approverRole: 'Registered Representative',
    decisionRef: decisionEntry.entry.entry_id,
    approvalType: 'APPROVE',
    reviewDurationSeconds: 45,
  });
  
  console.log(`✓ Recommendation approved and executed for client ${clientId}`);
}

// ============================================================================
// MAIN AGENT FLOW
// ============================================================================

async function runFinancialAdvisor(
  clientId: string,
  userQuery: string,
  representativeId: string
): Promise<void> {
  console.log('\n=== Financial Advisor Agent (FINRA Compliant) ===\n');
  
  // Start audit session
  const sessionId = await ledger.start({
    type: 'user',
    identifier: clientId,
    ip_address: '192.168.1.100',
  }, {
    representative_id: representativeId,
    client_id: clientId,
  });
  
  console.log(`Session started: ${sessionId}`);
  
  try {
    // Get portfolio data
    const portfolio = await getPortfolio(clientId);
    console.log(`Portfolio loaded: ${portfolio.holdings.length} holdings`);
    
    // Generate recommendation
    const response = await auditedOpenAI.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are a FINRA-compliant financial advisor AI. You must:
1. Always disclose that you are an AI assistant
2. Never guarantee investment returns
3. Always recommend diversification
4. Flag high-risk recommendations for human review
5. Document your reasoning clearly

Current client portfolio:
${JSON.stringify(portfolio.holdings, null, 2)}
Risk tolerance: ${portfolio.riskTolerance}`,
        },
        {
          role: 'user',
          content: userQuery,
        },
      ],
      temperature: 0.3, // Lower temperature for financial advice
      max_tokens: 500,
    });
    
    const recommendation = response.choices[0]?.message?.content || '';
    console.log('\nRecommendation:', recommendation);
    
    // Execute with human approval
    await executeRecommendation(clientId, recommendation, representativeId);
    
    // Take final state snapshot
    await ledger.snapshot({
      trigger: 'checkpoint',
      stateHash: hashContent(JSON.stringify({
        recommendation,
        portfolio,
        approved: true,
      })),
      schemaVersion: '1.0.0',
      metrics: {
        total_tokens: response.usage?.total_tokens || 0,
        total_cost_usd: 0.01, // Estimated
        total_tool_calls: 1,
        total_decisions: 1,
        error_count: 0,
      },
    });
    
  } finally {
    // Close session and sign
    const log = await ledger.close();
    console.log(`\nSession closed. Merkle root: ${log.merkle_root?.slice(0, 16)}...`);
    console.log(`Signature: ${log.org_signature ? '✓' : '✗'}`);
    console.log(`Entries: ${log.entries.length}`);
  }
}

// ============================================================================
// RUN
// ============================================================================

// Example usage
runFinancialAdvisor(
  'CLIENT_12345',
  'Should I rebalance my portfolio? I\'m concerned about concentration in equities.',
  'REP_67890'
).catch(console.error);
