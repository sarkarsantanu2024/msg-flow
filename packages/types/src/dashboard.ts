/** DTOs shared between server components, API routes and client components. */

export type HealthStateName = 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'UNKNOWN';

export interface HealthLayerStatus {
  layer: 'DATABASE' | 'WORKER' | 'WHATSAPP' | 'GROUP_LISTENER' | 'QUEUE' | 'AI' | 'WORKFLOW' | 'OUTPUT';
  label: string;
  state: HealthStateName;
  message: string;
  latencyMs?: number;
}

export interface SystemHealth {
  overall: HealthStateName;
  layers: HealthLayerStatus[];
  checkedAt: string;
}

export interface WhatsAppStatusSummary {
  connectionId: string | null;
  name: string;
  status: string;
  phoneNumber: string | null;
  connectedAt: string | null;
  lastHeartbeatAt: string | null;
  lastMessageAt: string | null;
  workerStatus: string;
  workerName: string | null;
  groupsMonitored: number;
  messagesToday: number;
  qrCode: string | null;
  lastError: string | null;
}

export interface DashboardStats {
  messages: number;
  important: number;
  extracted: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsSkipped: number;
  recordsFailed: number;
  reviewRequired: number;
  workflowSuccess: number;
  workflowFailed: number;
}

export interface TimeSeriesPoint {
  date: string;
  label: string;
  messages: number;
  important: number;
  records: number;
  runs: number;
}

export interface CategoryBreakdown {
  category: string;
  count: number;
}

export interface AutomationHealthRow {
  id: string;
  name: string;
  status: string;
  processingMode: string;
  lastSuccessfulRunAt: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  messagesProcessed: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsSkipped: number;
  errors: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export type DatePresetName =
  | 'today'
  | 'yesterday'
  | 'last7'
  | 'last30'
  | 'thisWeek'
  | 'lastWeek'
  | 'thisMonth'
  | 'lastMonth'
  | 'custom';
