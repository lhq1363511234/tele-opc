export type PaperclipIssueStatus = 'backlog' | 'todo' | 'in_progress' | 'blocked' | 'in_review' | 'done' | 'cancelled';

export interface PaperclipIssue {
  id: string;
  companyId?: string;
  title: string;
  description?: string | null;
  status?: PaperclipIssueStatus | string;
  priority?: string | null;
  assigneeAgentId?: string | null;
  projectId?: string | null;
  goalId?: string | null;
  parentId?: string | null;
  [key: string]: unknown;
}

export interface PaperclipCompany {
  id: string;
  name: string;
  description?: string | null;
  status?: string;
  budgetMonthlyCents?: number;
  spentMonthlyCents?: number;
  [key: string]: unknown;
}

export interface PaperclipAgent {
  id: string;
  companyId?: string;
  name?: string;
  shortname?: string;
  urlKey?: string;
  role?: string;
  status?: string;
  [key: string]: unknown;
}

export interface PaperclipClientOptions {
  apiUrl: string;
  apiKey?: string;
  fetch?: typeof fetch;
}

export class PaperclipClient {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: PaperclipClientOptions) {
    this.apiUrl = options.apiUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey ?? '';
    this.fetchImpl = options.fetch ?? fetch;
  }

  get configured() { return Boolean(this.apiUrl); }

  async health() {
    return this.request<Record<string, unknown>>('/health', { method: 'GET' }, false);
  }

  async getIssue(issueId: string) {
    return this.request<PaperclipIssue>(`/api/issues/${encodeURIComponent(issueId)}`, { method: 'GET' });
  }

  async getAgent(agentId: string) {
    return this.request<PaperclipAgent>(`/api/agents/${encodeURIComponent(agentId)}`, { method: 'GET' });
  }

  async listCompanies() {
    return this.request<PaperclipCompany[]>('/api/companies', { method: 'GET' });
  }

  async listGoals(companyId: string) {
    return this.request<Array<Record<string, unknown>>>(`/api/companies/${encodeURIComponent(companyId)}/goals`, { method: 'GET' });
  }

  async listProjects(companyId: string) {
    return this.request<Array<Record<string, unknown>>>(`/api/companies/${encodeURIComponent(companyId)}/projects`, { method: 'GET' });
  }

  async listAgents(companyId: string) {
    return this.request<PaperclipAgent[]>(`/api/companies/${encodeURIComponent(companyId)}/agents`, { method: 'GET' });
  }

  async listIssues(companyId: string) {
    return this.request<PaperclipIssue[]>(`/api/companies/${encodeURIComponent(companyId)}/issues`, { method: 'GET' });
  }

  async getDashboard(companyId: string) {
    return this.request<Record<string, unknown>>(`/api/companies/${encodeURIComponent(companyId)}/dashboard`, { method: 'GET' });
  }

  async listIssueRuns(issueId: string) {
    return this.request<Array<Record<string, unknown>>>(`/api/issues/${encodeURIComponent(issueId)}/runs`, { method: 'GET' });
  }

  async listIssueComments(issueId: string) {
    return this.request<Array<Record<string, unknown>>>(`/api/issues/${encodeURIComponent(issueId)}/comments`, { method: 'GET' });
  }

  async createIssue(companyId: string, payload: Record<string, unknown>) {
    return this.request<PaperclipIssue>(`/api/companies/${encodeURIComponent(companyId)}/issues`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  async updateIssue(
    issueId: string,
    patch: Partial<Pick<PaperclipIssue, 'title' | 'description' | 'status' | 'priority' | 'assigneeAgentId' | 'projectId' | 'goalId' | 'parentId'>> & { comment?: string },
    runId?: string
  ) {
    return this.request<PaperclipIssue>(`/api/issues/${encodeURIComponent(issueId)}`, {
      method: 'PATCH',
      headers: runId ? { 'x-paperclip-run-id': runId } : undefined,
      body: JSON.stringify(patch)
    });
  }

  private async request<T>(path: string, init: RequestInit, auth = true): Promise<T> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...((init.headers as Record<string, string> | undefined) ?? {})
    };
    if (auth && this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    const response = await this.fetchImpl(`${this.apiUrl}${path}`, { ...init, headers });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      const message = typeof payload.message === 'string'
        ? payload.message
        : typeof payload.error === 'string'
          ? payload.error
          : response.statusText;
      throw new Error(`Paperclip API ${init.method ?? 'GET'} ${path} failed: ${response.status} ${message}`);
    }
    return payload as T;
  }
}
