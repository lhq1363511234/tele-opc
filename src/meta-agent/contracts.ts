import { z } from 'zod';

export const metaAgentRoleSchema = z.object({
  id: z.string().min(1).max(80),
  role: z.string().min(2).max(160),
  responsibility: z.string().min(4).max(1200),
  systemPrompt: z.string().min(20).max(12000),
  requiredCapabilities: z.array(z.string().min(1).max(120)).max(20).default([])
});

export const metaAgentBlueprintSchema = z.object({
  systemName: z.string().min(2).max(160),
  objective: z.string().min(4).max(2000),
  productionAgent: metaAgentRoleSchema,
  auditorAgent: metaAgentRoleSchema,
  supportingAgents: z.array(metaAgentRoleSchema).max(8).default([]),
  successCriteria: z.array(z.string().min(2).max(500)).min(1).max(20),
  searchQueries: z.array(z.string().min(2).max(240)).min(1).max(8),
  minimumAuditScore: z.number().min(0).max(100).default(80),
  maxAttempts: z.number().int().min(1).max(5).default(3),
  approvalBoundaries: z.array(z.string().min(2).max(500)).max(20).default([]),
  assemblyPolicy: z.object({
    allowReferenceMount: z.boolean().default(true),
    allowExecutableInstall: z.boolean().default(false),
    executableInstallRequiresApproval: z.boolean().default(true)
  }).default({
    allowReferenceMount: true,
    allowExecutableInstall: false,
    executableInstallRequiresApproval: true
  })
});

export type MetaAgentBlueprint = z.infer<typeof metaAgentBlueprintSchema>;

export interface MetaAgentBlueprintRecord {
  id: string;
  requirement: string;
  system_name: string;
  status: string;
  blueprint: MetaAgentBlueprint;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MetaAgentComponentRecord {
  id: string;
  blueprint_id: string;
  source: 'github' | 'mcp_registry' | 'local';
  external_id: string;
  name: string;
  description: string | null;
  url: string | null;
  version: string | null;
  stars: number;
  score: number;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface MetaAgentRunRecord {
  id: string;
  blueprint_id: string;
  task_input: string;
  status: string;
  selected_component_id: string | null;
  final_output: string | null;
  audit_summary: Record<string, unknown>;
  metadata: Record<string, unknown>;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MetaAgentAttemptRecord {
  id: string;
  run_id: string;
  attempt_no: number;
  component_id: string | null;
  producer_role: string;
  auditor_role: string;
  output: string;
  audit_status: 'passed' | 'failed';
  audit_score: number;
  feedback: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface DiscoveredComponent {
  source: 'github' | 'mcp_registry' | 'local';
  externalId: string;
  name: string;
  description: string;
  url?: string;
  version?: string;
  stars?: number;
  score: number;
  metadata: Record<string, unknown>;
}

export const metaAgentAuditSchema = z.object({
  status: z.enum(['passed', 'failed']),
  score: z.number().min(0).max(100),
  feedback: z.string().max(6000).default(''),
  failedCriteria: z.array(z.string().max(500)).max(20).default([]),
  auditMode: z.enum(['model', 'deterministic_fallback']).default('model')
});

export type MetaAgentAudit = z.infer<typeof metaAgentAuditSchema>;
