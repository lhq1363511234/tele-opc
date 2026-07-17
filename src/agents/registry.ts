export type AgentMode = 'autonomous' | 'approval_gated';

export interface AgentDefinition {
  id: string;
  displayName: string;
  role: string;
  mode: AgentMode;
  capabilities: string[];
  approvalRequiredFor: string[];
}

export const AGENT_REGISTRY: AgentDefinition[] = [
  {
    id: 'chief_of_staff',
    displayName: 'Chief Agent',
    role: 'Understands Telegram commands, routes domains and skills, delegates work, and reports outcomes.',
    mode: 'autonomous',
    capabilities: ['intent_router', 'domain_routing', 'skill_routing', 'task_delegation', 'owner_briefing'],
    approvalRequiredFor: []
  },
  {
    id: 'domain_router',
    displayName: 'Domain Router',
    role: 'Classifies industry, function, task type, and risk level for V3 requests.',
    mode: 'autonomous',
    capabilities: ['industry_classification', 'function_classification', 'risk_classification'],
    approvalRequiredFor: []
  },
  {
    id: 'skill_router',
    displayName: 'Skill Router',
    role: 'Selects Industry, Function, and Execution Skills from the Skill Registry.',
    mode: 'autonomous',
    capabilities: ['skill_selection', 'skill_versioning', 'skill_trace'],
    approvalRequiredFor: []
  },
  {
    id: 'planner',
    displayName: 'Planner Agent',
    role: 'Breaks owner goals into executable multi-agent tasks.',
    mode: 'autonomous',
    capabilities: ['task_decomposition', 'dependency_mapping', 'priority_routing'],
    approvalRequiredFor: []
  },
  {
    id: 'solution',
    displayName: 'Solution Engine',
    role: 'Frames multi-domain business questions, calls skills, and drafts structured options and execution plans.',
    mode: 'autonomous',
    capabilities: ['problem_framing', 'skill_orchestration', 'option_generation', 'risk_review', 'execution_plan'],
    approvalRequiredFor: []
  },
  {
    id: 'research',
    displayName: 'Research Agent',
    role: 'Collects evidence, source notes, and context for solution and prospecting work.',
    mode: 'autonomous',
    capabilities: ['web_research_plan', 'source_notes', 'evidence_capture'],
    approvalRequiredFor: ['paid_data_source', 'restricted_source']
  },
  {
    id: 'prospecting',
    displayName: 'Prospecting & Sales Engine',
    role: 'Builds ICPs, lead source strategies, lead scoring, outreach drafts, and CRM pipeline tasks.',
    mode: 'autonomous',
    capabilities: ['icp_design', 'account_sourcing_plan', 'lead_scoring', 'outreach_drafting', 'sales_sequence'],
    approvalRequiredFor: ['bulk_non_email_outreach', 'paid_data_source', 'ad_spend', 'submit_external_form']
  },
  {
    id: 'icp',
    displayName: 'ICP Agent',
    role: 'Defines ideal customer profiles, exclusion rules, and account priorities.',
    mode: 'autonomous',
    capabilities: ['icp_design', 'segment_rules', 'exclusion_criteria'],
    approvalRequiredFor: []
  },
  {
    id: 'lead_scoring',
    displayName: 'Lead Scoring Agent',
    role: 'Scores prospects by fit, intent, urgency, accessibility, value, risk, and confidence.',
    mode: 'autonomous',
    capabilities: ['fit_score', 'intent_score', 'risk_score', 'priority_grouping'],
    approvalRequiredFor: []
  },
  {
    id: 'sales_sequence',
    displayName: 'Sales Sequence Agent',
    role: 'Designs outreach cadences, follow-up tasks, and reply handling playbooks.',
    mode: 'autonomous',
    capabilities: ['outreach_cadence', 'follow_up_plan', 'reply_playbook'],
    approvalRequiredFor: ['bulk_non_email_outreach']
  },
  {
    id: 'memory',
    displayName: 'Memory Agent',
    role: 'Maintains company memory, preferences, playbooks, and task context.',
    mode: 'autonomous',
    capabilities: ['memory_write', 'memory_recall', 'playbook_reuse'],
    approvalRequiredFor: []
  },
  {
    id: 'crm',
    displayName: 'CRM Agent',
    role: 'Manages leads, customers, opportunities, and follow-up work.',
    mode: 'autonomous',
    capabilities: ['lead_capture', 'follow_up_tracking', 'customer_risk'],
    approvalRequiredFor: []
  },
  {
    id: 'quote',
    displayName: 'Quote Agent',
    role: 'Generates quote drafts from pricing rules, service packages, contract terms, and company knowledge.',
    mode: 'autonomous',
    capabilities: ['pricing_rules', 'quote_draft', 'discount_check', 'contract_term_check'],
    approvalRequiredFor: ['financial_commitment', 'issue_invoice']
  },
  {
    id: 'email',
    displayName: 'Email Agent',
    role: 'Triage emails, draft replies, and execute normal mailbox work.',
    mode: 'autonomous',
    capabilities: ['email_triage', 'reply_drafting', 'follow_up_creation'],
    approvalRequiredFor: []
  },
  {
    id: 'calendar',
    displayName: 'Calendar Agent',
    role: 'Manages events, meeting prep, scheduling, and conflicts.',
    mode: 'autonomous',
    capabilities: ['event_capture', 'meeting_prep', 'conflict_detection'],
    approvalRequiredFor: []
  },
  {
    id: 'browser',
    displayName: 'Browser Agent',
    role: 'Runs controlled browser automation and captures evidence.',
    mode: 'autonomous',
    capabilities: ['web_inspection', 'form_work', 'evidence_capture'],
    approvalRequiredFor: ['payment', 'refund', 'billing_change']
  },
  {
    id: 'finance',
    displayName: 'Finance Agent',
    role: 'Tracks cash, invoices, subscriptions, and finance-risk actions.',
    mode: 'approval_gated',
    capabilities: ['cash_ledger', 'invoice_tracking', 'subscription_tracking', 'finance_approval'],
    approvalRequiredFor: ['payment', 'refund', 'transfer', 'tax_filing', 'billing_change', 'financial_commitment']
  },
  {
    id: 'dev',
    displayName: 'Dev Agent Team',
    role: 'Coordinates spec, repo context, architecture, implementation, tests, review, and release preparation.',
    mode: 'autonomous',
    capabilities: ['spec', 'repo_context', 'claude_code', 'tests', 'code_review', 'release_plan'],
    approvalRequiredFor: ['production_deploy', 'destructive_command', 'secret_change']
  },
  {
    id: 'content',
    displayName: 'Content Agent',
    role: 'Drafts content, campaign copy, and publishing plans.',
    mode: 'autonomous',
    capabilities: ['content_draft', 'campaign_plan', 'publish_prep'],
    approvalRequiredFor: []
  },
  {
    id: 'ops',
    displayName: 'Ops Agent',
    role: 'Monitors health, retries jobs, exports audits, and runs backups.',
    mode: 'autonomous',
    capabilities: ['healthcheck', 'retry', 'audit_export', 'backup'],
    approvalRequiredFor: []
  }
];

const registryById = new Map(AGENT_REGISTRY.map((agent) => [agent.id, agent]));

export function getAgentDefinition(agentId: string | null | undefined) {
  return registryById.get(agentId ?? '') ?? registryById.get('chief_of_staff')!;
}

export function isKnownAgent(agentId: string) {
  return registryById.has(agentId);
}

export function listAgentIds() {
  return AGENT_REGISTRY.map((agent) => agent.id);
}

export function listAgentDefinitions() {
  return [...AGENT_REGISTRY];
}
