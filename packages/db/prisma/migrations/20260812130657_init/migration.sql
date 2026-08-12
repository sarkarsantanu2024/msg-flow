-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'OPERATOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MessageProviderType" AS ENUM ('WHATSAPP_WEB', 'WHATSAPP_CLOUD', 'DEMO');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('DISCONNECTED', 'QR_REQUIRED', 'CONNECTING', 'AUTHENTICATED', 'READY', 'RECONNECTING', 'ERROR', 'LOGGED_OUT');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('TEXT', 'IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT', 'LOCATION', 'CONTACT_CARD', 'STICKER', 'SYSTEM', 'OTHER');

-- CreateEnum
CREATE TYPE "IngestSource" AS ENUM ('LIVE', 'BACKLOG', 'MANUAL', 'DEMO');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('PENDING', 'CLASSIFIED', 'PROCESSING', 'EXTRACTED', 'SKIPPED', 'IGNORED', 'NEEDS_REVIEW', 'FAILED');

-- CreateEnum
CREATE TYPE "MessageCategory" AS ENUM ('SALES', 'ORDER', 'PURCHASE', 'INVENTORY', 'PAYMENT', 'CUSTOMER', 'COMPLAINT', 'MEETING', 'TASK', 'HR', 'FINANCE', 'DELIVERY', 'LOGISTICS', 'ANNOUNCEMENT', 'OTHER', 'IGNORE');

-- CreateEnum
CREATE TYPE "Importance" AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'IGNORE');

-- CreateEnum
CREATE TYPE "FieldType" AS ENUM ('STRING', 'TEXT', 'NUMBER', 'INTEGER', 'DECIMAL', 'BOOLEAN', 'DATE', 'DATETIME', 'ENUM', 'EMAIL', 'PHONE', 'CURRENCY');

-- CreateEnum
CREATE TYPE "AutomationStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED', 'ERROR');

-- CreateEnum
CREATE TYPE "ProcessingMode" AS ENUM ('REAL_TIME', 'DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM', 'MANUAL');

-- CreateEnum
CREATE TYPE "DateRangeMode" AS ENUM ('CURRENT_MESSAGE', 'TODAY', 'YESTERDAY', 'THIS_WEEK', 'LAST_WEEK', 'THIS_MONTH', 'LAST_MONTH', 'LAST_7_DAYS', 'CUSTOM', 'SINCE_LAST_SUCCESSFUL_RUN');

-- CreateEnum
CREATE TYPE "TriggerType" AS ENUM ('REAL_TIME', 'SCHEDULE', 'MANUAL', 'EVENT');

-- CreateEnum
CREATE TYPE "ActionType" AS ENUM ('SAVE_RECORD', 'SYNC_OUTPUT', 'CALL_API', 'SEND_WEBHOOK', 'GENERATE_DOCUMENT', 'NOTIFY');

-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('DRAFT', 'VALIDATED', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "OutputType" AS ENUM ('EXCEL', 'CSV', 'GOOGLE_SHEETS', 'PDF', 'POWERPOINT', 'WEBHOOK', 'REST_API', 'CLIENT_WEBSITE', 'CLIENT_ADMIN');

-- CreateEnum
CREATE TYPE "OutputOperation" AS ENUM ('CREATE_NEW', 'APPEND', 'UPDATE_EXISTING', 'UPSERT', 'REPLACE', 'GENERATE_NEW_VERSION');

-- CreateEnum
CREATE TYPE "OutputStatus" AS ENUM ('ACTIVE', 'PAUSED', 'SYNCING', 'SUCCESS', 'PARTIAL_SUCCESS', 'FAILED', 'CONFLICT', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "UpdateStrategy" AS ENUM ('ALWAYS_UPDATE', 'UPDATE_IF_EMPTY', 'NEVER_UPDATE', 'UPDATE_IF_NEWER');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'SYNCED', 'STALE', 'FAILED', 'CONFLICT', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ConflictResolution" AS ENUM ('PENDING', 'USE_LATEST_FILE', 'KEEP_AUTOMATION_VERSION', 'MERGED', 'IGNORED');

-- CreateEnum
CREATE TYPE "RunTrigger" AS ENUM ('SCHEDULE', 'MANUAL', 'REAL_TIME', 'SYNC_NOW', 'BACKLOG', 'REPROCESS');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCESS', 'PARTIAL_SUCCESS', 'FAILED', 'CANCELLED', 'RETRYING');

-- CreateEnum
CREATE TYPE "IntegrationType" AS ENUM ('GOOGLE_SHEETS', 'GOOGLE_DRIVE', 'REST_API', 'WEBHOOK', 'CLIENT_WEBSITE', 'CLIENT_ADMIN');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('NOT_CONFIGURED', 'CONNECTED', 'ERROR', 'EXPIRED', 'MOCK');

-- CreateEnum
CREATE TYPE "CredentialType" AS ENUM ('OAUTH2', 'API_KEY', 'BEARER_TOKEN', 'BASIC_AUTH', 'HMAC', 'NONE');

-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('QUEUED', 'PROCESSING', 'READY', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "WorkerStatus" AS ENUM ('STARTING', 'ONLINE', 'DEGRADED', 'OFFLINE');

-- CreateEnum
CREATE TYPE "HealthLayer" AS ENUM ('DATABASE', 'WORKER', 'WHATSAPP', 'GROUP_LISTENER', 'QUEUE', 'AI', 'WORKFLOW', 'OUTPUT');

-- CreateEnum
CREATE TYPE "HealthState" AS ENUM ('HEALTHY', 'DEGRADED', 'DOWN', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "NotificationSeverity" AS ENUM ('INFO', 'SUCCESS', 'WARNING', 'ERROR', 'CRITICAL');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false,
    "emailVerifiedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "image" TEXT,
    "resetToken" TEXT,
    "resetTokenExpires" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'TRIAL',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "priceInr" INTEGER NOT NULL DEFAULT 0,
    "interval" TEXT NOT NULL DEFAULT 'month',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "limits" JSONB NOT NULL DEFAULT '{}',
    "features" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "currentPeriodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "cancelAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Usage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "messages" INTEGER NOT NULL DEFAULT 0,
    "aiCalls" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "automationRuns" INTEGER NOT NULL DEFAULT 0,
    "workflowRuns" INTEGER NOT NULL DEFAULT 0,
    "recordsCreated" INTEGER NOT NULL DEFAULT 0,
    "recordsUpdated" INTEGER NOT NULL DEFAULT 0,
    "exports" INTEGER NOT NULL DEFAULT 0,
    "apiCalls" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppConnection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" "MessageProviderType" NOT NULL DEFAULT 'WHATSAPP_WEB',
    "status" "ConnectionStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "phoneNumber" TEXT,
    "displayName" TEXT,
    "connectedAt" TIMESTAMP(3),
    "disconnectedAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3),
    "sessionRef" TEXT,
    "qrCode" TEXT,
    "qrExpiresAt" TIMESTAMP(3),
    "workerId" TEXT,
    "lastErrorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectionEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "fromStatus" "ConnectionStatus",
    "toStatus" "ConnectionStatus",
    "message" TEXT,
    "context" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppGroup" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isGroup" BOOLEAN NOT NULL DEFAULT true,
    "isMonitored" BOOLEAN NOT NULL DEFAULT false,
    "monitoredAt" TIMESTAMP(3),
    "participantCount" INTEGER NOT NULL DEFAULT 0,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectionId" TEXT,
    "groupId" TEXT,
    "externalId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "senderId" TEXT,
    "senderName" TEXT,
    "senderPhone" TEXT,
    "text" TEXT,
    "messageType" "MessageType" NOT NULL DEFAULT 'TEXT',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "isFromMe" BOOLEAN NOT NULL DEFAULT false,
    "quotedMessageId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ingestSource" "IngestSource" NOT NULL DEFAULT 'LIVE',
    "status" "MessageStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageClassification" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "category" "MessageCategory" NOT NULL DEFAULT 'OTHER',
    "importance" "Importance" NOT NULL DEFAULT 'LOW',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reasoning" TEXT,
    "entities" JSONB NOT NULL DEFAULT '{}',
    "provider" TEXT,
    "model" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageClassification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractionSchema" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "systemPrompt" TEXT,
    "examples" JSONB NOT NULL DEFAULT '[]',
    "confidenceThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExtractionSchema_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractionField" (
    "id" TEXT NOT NULL,
    "schemaId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "FieldType" NOT NULL DEFAULT 'STRING',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "isKeyField" BOOLEAN NOT NULL DEFAULT false,
    "enumValues" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "description" TEXT,
    "validation" JSONB NOT NULL DEFAULT '{}',
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ExtractionField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Automation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "AutomationStatus" NOT NULL DEFAULT 'DRAFT',
    "schemaId" TEXT NOT NULL,
    "processingMode" "ProcessingMode" NOT NULL DEFAULT 'REAL_TIME',
    "dateRangeMode" "DateRangeMode" NOT NULL DEFAULT 'SINCE_LAST_SUCCESSFUL_RUN',
    "cronExpression" TEXT,
    "timezone" TEXT,
    "scheduleHour" INTEGER NOT NULL DEFAULT 23,
    "scheduleMinute" INTEGER NOT NULL DEFAULT 0,
    "scheduleWeekday" INTEGER NOT NULL DEFAULT 1,
    "scheduleDay" INTEGER NOT NULL DEFAULT 1,
    "customFrom" TIMESTAMP(3),
    "customTo" TIMESTAMP(3),
    "lastProcessedAt" TIMESTAMP(3),
    "lastProcessedMessageId" TEXT,
    "lastSuccessfulRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "requireImportant" BOOLEAN NOT NULL DEFAULT true,
    "minImportance" "Importance" NOT NULL DEFAULT 'MEDIUM',
    "categories" "MessageCategory"[] DEFAULT ARRAY[]::"MessageCategory"[],
    "keywordFilter" TEXT,
    "minConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "nlPrompt" TEXT,
    "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "pausedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Automation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationTrigger" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "type" "TriggerType" NOT NULL DEFAULT 'REAL_TIME',
    "groupId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL DEFAULT '{}',
    "lastProcessedMessageId" TEXT,
    "lastProcessedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationTrigger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationAction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "type" "ActionType" NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "outputTargetId" TEXT,
    "condition" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "retryPolicy" JSONB NOT NULL DEFAULT '{"maxAttempts":3,"backoff":"exponential","initialDelayMs":1000,"maxDelayMs":30000}',
    "timeoutMs" INTEGER NOT NULL DEFAULT 30000,
    "continueOnError" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractedRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "schemaId" TEXT NOT NULL,
    "automationId" TEXT,
    "naturalKey" TEXT NOT NULL,
    "naturalKeyHash" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "status" "RecordStatus" NOT NULL DEFAULT 'DRAFT',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "originMessageId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastEventAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExtractedRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecordSource" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "isOrigin" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecordSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecordFieldEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "previousValue" JSONB,
    "newValue" JSONB,
    "eventAt" TIMESTAMP(3) NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied" BOOLEAN NOT NULL DEFAULT true,
    "skipReason" TEXT,
    "messageId" TEXT,

    CONSTRAINT "RecordFieldEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Output" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "OutputType" NOT NULL,
    "status" "OutputStatus" NOT NULL DEFAULT 'ACTIVE',
    "config" JSONB NOT NULL DEFAULT '{}',
    "integrationId" TEXT,
    "currentVersion" INTEGER NOT NULL DEFAULT 0,
    "recordCount" INTEGER NOT NULL DEFAULT 0,
    "lastSyncAt" TIMESTAMP(3),
    "nextSyncAt" TIMESTAMP(3),
    "lastSyncStatus" TEXT,
    "lastError" TEXT,
    "lastKnownChecksum" TEXT,
    "lastKnownModifiedAt" TIMESTAMP(3),
    "allowDelete" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Output_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutputTarget" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "outputId" TEXT NOT NULL,
    "operation" "OutputOperation" NOT NULL DEFAULT 'UPSERT',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "cronExpression" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutputTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutputMapping" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "outputTargetId" TEXT NOT NULL,
    "sourceField" TEXT NOT NULL,
    "targetField" TEXT NOT NULL,
    "targetColumn" TEXT,
    "updateStrategy" "UpdateStrategy" NOT NULL DEFAULT 'ALWAYS_UPDATE',
    "transform" JSONB NOT NULL DEFAULT '{}',
    "defaultValue" TEXT,
    "isKeyPart" BOOLEAN NOT NULL DEFAULT false,
    "keyOrder" INTEGER,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OutputMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutputSyncRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "outputId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "externalRowId" TEXT,
    "externalRecordId" TEXT,
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "syncVersion" INTEGER NOT NULL DEFAULT 0,
    "lastSyncedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutputSyncRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutputVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "outputId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "storageRef" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "recordCount" INTEGER NOT NULL DEFAULT 0,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "operation" TEXT,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutputVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutputConflict" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "outputId" TEXT NOT NULL,
    "expectedChecksum" TEXT,
    "actualChecksum" TEXT,
    "expectedVersion" INTEGER,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "resolution" "ConflictResolution" NOT NULL DEFAULT 'PENDING',
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutputConflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "automationId" TEXT,
    "outputId" TEXT,
    "trigger" "RunTrigger" NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'QUEUED',
    "startedBy" TEXT,
    "windowStart" TIMESTAMP(3),
    "windowEnd" TIMESTAMP(3),
    "messagesScanned" INTEGER NOT NULL DEFAULT 0,
    "messagesProcessed" INTEGER NOT NULL DEFAULT 0,
    "recordsCreated" INTEGER NOT NULL DEFAULT 0,
    "recordsUpdated" INTEGER NOT NULL DEFAULT 0,
    "recordsSkipped" INTEGER NOT NULL DEFAULT 0,
    "recordsFailed" INTEGER NOT NULL DEFAULT 0,
    "rowsCreated" INTEGER NOT NULL DEFAULT 0,
    "rowsUpdated" INTEGER NOT NULL DEFAULT 0,
    "rowsSkipped" INTEGER NOT NULL DEFAULT 0,
    "rowsFailed" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "WorkflowRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowRunStep" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "actionId" TEXT,
    "name" TEXT NOT NULL,
    "type" "ActionType" NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "status" "RunStatus" NOT NULL DEFAULT 'QUEUED',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "input" JSONB,
    "output" JSONB,
    "errorMessage" TEXT,
    "durationMs" INTEGER,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowRunStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "IntegrationType" NOT NULL,
    "name" TEXT NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "config" JSONB NOT NULL DEFAULT '{}',
    "lastCheckedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationCredential" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "type" "CredentialType" NOT NULL DEFAULT 'API_KEY',
    "encryptedPayload" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "isValid" BOOLEAN NOT NULL DEFAULT true,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Export" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" "ExportStatus" NOT NULL DEFAULT 'QUEUED',
    "entity" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageRef" TEXT,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "recordCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "requestedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "Export_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIUsage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "errorMessage" TEXT,
    "messageId" TEXT,
    "automationId" TEXT,
    "runId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Worker" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "pid" INTEGER,
    "version" TEXT,
    "status" "WorkerStatus" NOT NULL DEFAULT 'STARTING',
    "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastHeartbeatAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Worker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerHeartbeat" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "status" "WorkerStatus" NOT NULL DEFAULT 'ONLINE',
    "cpuPercent" DOUBLE PRECISION,
    "memoryMb" DOUBLE PRECISION,
    "uptimeSec" INTEGER,
    "connections" INTEGER NOT NULL DEFAULT 0,
    "messagesSeen" INTEGER NOT NULL DEFAULT 0,
    "queueDepth" INTEGER NOT NULL DEFAULT 0,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthCheck" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "layer" "HealthLayer" NOT NULL,
    "state" "HealthState" NOT NULL DEFAULT 'UNKNOWN',
    "subjectId" TEXT,
    "message" TEXT,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "latencyMs" INTEGER,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "severity" "NotificationSeverity" NOT NULL DEFAULT 'INFO',
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "context" JSONB NOT NULL DEFAULT '{}',
    "readAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_resetToken_key" ON "User"("resetToken");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE INDEX "Tenant_status_idx" ON "Tenant"("status");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_tenantId_userId_key" ON "Membership"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_slug_key" ON "Plan"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_tenantId_key" ON "Subscription"("tenantId");

-- CreateIndex
CREATE INDEX "Subscription_planId_idx" ON "Subscription"("planId");

-- CreateIndex
CREATE INDEX "Usage_tenantId_periodStart_idx" ON "Usage"("tenantId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "Usage_tenantId_periodStart_key" ON "Usage"("tenantId", "periodStart");

-- CreateIndex
CREATE INDEX "WhatsAppConnection_tenantId_status_idx" ON "WhatsAppConnection"("tenantId", "status");

-- CreateIndex
CREATE INDEX "WhatsAppConnection_workerId_idx" ON "WhatsAppConnection"("workerId");

-- CreateIndex
CREATE INDEX "ConnectionEvent_tenantId_connectionId_occurredAt_idx" ON "ConnectionEvent"("tenantId", "connectionId", "occurredAt");

-- CreateIndex
CREATE INDEX "WhatsAppGroup_tenantId_isMonitored_idx" ON "WhatsAppGroup"("tenantId", "isMonitored");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppGroup_connectionId_externalId_key" ON "WhatsAppGroup"("connectionId", "externalId");

-- CreateIndex
CREATE INDEX "Message_tenantId_timestamp_idx" ON "Message"("tenantId", "timestamp");

-- CreateIndex
CREATE INDEX "Message_tenantId_groupId_timestamp_idx" ON "Message"("tenantId", "groupId", "timestamp");

-- CreateIndex
CREATE INDEX "Message_tenantId_status_timestamp_idx" ON "Message"("tenantId", "status", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "Message_tenantId_externalId_key" ON "Message"("tenantId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Message_tenantId_contentHash_key" ON "Message"("tenantId", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "MessageClassification_messageId_key" ON "MessageClassification"("messageId");

-- CreateIndex
CREATE INDEX "MessageClassification_tenantId_category_createdAt_idx" ON "MessageClassification"("tenantId", "category", "createdAt");

-- CreateIndex
CREATE INDEX "MessageClassification_tenantId_importance_createdAt_idx" ON "MessageClassification"("tenantId", "importance", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExtractionSchema_tenantId_slug_key" ON "ExtractionSchema"("tenantId", "slug");

-- CreateIndex
CREATE INDEX "ExtractionField_schemaId_order_idx" ON "ExtractionField"("schemaId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "ExtractionField_schemaId_key_key" ON "ExtractionField"("schemaId", "key");

-- CreateIndex
CREATE INDEX "Automation_tenantId_status_idx" ON "Automation"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Automation_status_nextRunAt_idx" ON "Automation"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "AutomationTrigger_tenantId_groupId_idx" ON "AutomationTrigger"("tenantId", "groupId");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationTrigger_automationId_groupId_key" ON "AutomationTrigger"("automationId", "groupId");

-- CreateIndex
CREATE INDEX "AutomationAction_tenantId_automationId_idx" ON "AutomationAction"("tenantId", "automationId");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationAction_automationId_order_key" ON "AutomationAction"("automationId", "order");

-- CreateIndex
CREATE INDEX "ExtractedRecord_tenantId_status_updatedAt_idx" ON "ExtractedRecord"("tenantId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "ExtractedRecord_tenantId_schemaId_lastEventAt_idx" ON "ExtractedRecord"("tenantId", "schemaId", "lastEventAt");

-- CreateIndex
CREATE INDEX "ExtractedRecord_tenantId_automationId_createdAt_idx" ON "ExtractedRecord"("tenantId", "automationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExtractedRecord_tenantId_schemaId_naturalKeyHash_key" ON "ExtractedRecord"("tenantId", "schemaId", "naturalKeyHash");

-- CreateIndex
CREATE INDEX "RecordSource_tenantId_messageId_idx" ON "RecordSource"("tenantId", "messageId");

-- CreateIndex
CREATE UNIQUE INDEX "RecordSource_recordId_messageId_key" ON "RecordSource"("recordId", "messageId");

-- CreateIndex
CREATE INDEX "RecordFieldEvent_tenantId_recordId_eventAt_idx" ON "RecordFieldEvent"("tenantId", "recordId", "eventAt");

-- CreateIndex
CREATE INDEX "RecordFieldEvent_recordId_fieldKey_eventAt_idx" ON "RecordFieldEvent"("recordId", "fieldKey", "eventAt");

-- CreateIndex
CREATE INDEX "Output_tenantId_status_idx" ON "Output"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Output_tenantId_type_idx" ON "Output"("tenantId", "type");

-- CreateIndex
CREATE INDEX "Output_status_nextSyncAt_idx" ON "Output"("status", "nextSyncAt");

-- CreateIndex
CREATE INDEX "OutputTarget_tenantId_outputId_idx" ON "OutputTarget"("tenantId", "outputId");

-- CreateIndex
CREATE UNIQUE INDEX "OutputTarget_automationId_outputId_key" ON "OutputTarget"("automationId", "outputId");

-- CreateIndex
CREATE INDEX "OutputMapping_tenantId_outputTargetId_idx" ON "OutputMapping"("tenantId", "outputTargetId");

-- CreateIndex
CREATE UNIQUE INDEX "OutputMapping_outputTargetId_targetField_key" ON "OutputMapping"("outputTargetId", "targetField");

-- CreateIndex
CREATE INDEX "OutputSyncRecord_tenantId_outputId_syncStatus_idx" ON "OutputSyncRecord"("tenantId", "outputId", "syncStatus");

-- CreateIndex
CREATE INDEX "OutputSyncRecord_tenantId_recordId_idx" ON "OutputSyncRecord"("tenantId", "recordId");

-- CreateIndex
CREATE UNIQUE INDEX "OutputSyncRecord_outputId_recordId_key" ON "OutputSyncRecord"("outputId", "recordId");

-- CreateIndex
CREATE INDEX "OutputVersion_tenantId_outputId_createdAt_idx" ON "OutputVersion"("tenantId", "outputId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutputVersion_outputId_version_key" ON "OutputVersion"("outputId", "version");

-- CreateIndex
CREATE INDEX "OutputConflict_tenantId_outputId_resolution_idx" ON "OutputConflict"("tenantId", "outputId", "resolution");

-- CreateIndex
CREATE INDEX "WorkflowRun_tenantId_queuedAt_idx" ON "WorkflowRun"("tenantId", "queuedAt");

-- CreateIndex
CREATE INDEX "WorkflowRun_tenantId_automationId_queuedAt_idx" ON "WorkflowRun"("tenantId", "automationId", "queuedAt");

-- CreateIndex
CREATE INDEX "WorkflowRun_tenantId_status_idx" ON "WorkflowRun"("tenantId", "status");

-- CreateIndex
CREATE INDEX "WorkflowRunStep_tenantId_runId_order_idx" ON "WorkflowRunStep"("tenantId", "runId", "order");

-- CreateIndex
CREATE INDEX "Integration_tenantId_type_idx" ON "Integration"("tenantId", "type");

-- CreateIndex
CREATE INDEX "IntegrationCredential_tenantId_integrationId_idx" ON "IntegrationCredential"("tenantId", "integrationId");

-- CreateIndex
CREATE INDEX "Export_tenantId_createdAt_idx" ON "Export"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_entityType_entityId_idx" ON "AuditLog"("tenantId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_userId_createdAt_idx" ON "AuditLog"("tenantId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "AIUsage_tenantId_createdAt_idx" ON "AIUsage"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AIUsage_tenantId_provider_createdAt_idx" ON "AIUsage"("tenantId", "provider", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Worker_name_key" ON "Worker"("name");

-- CreateIndex
CREATE INDEX "Worker_status_lastHeartbeatAt_idx" ON "Worker"("status", "lastHeartbeatAt");

-- CreateIndex
CREATE INDEX "WorkerHeartbeat_workerId_createdAt_idx" ON "WorkerHeartbeat"("workerId", "createdAt");

-- CreateIndex
CREATE INDEX "HealthCheck_tenantId_layer_checkedAt_idx" ON "HealthCheck"("tenantId", "layer", "checkedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_prefix_key" ON "ApiKey"("prefix");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_tenantId_revokedAt_idx" ON "ApiKey"("tenantId", "revokedAt");

-- CreateIndex
CREATE INDEX "Notification_tenantId_createdAt_idx" ON "Notification"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_tenantId_readAt_idx" ON "Notification"("tenantId", "readAt");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Usage" ADD CONSTRAINT "Usage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppConnection" ADD CONSTRAINT "WhatsAppConnection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppConnection" ADD CONSTRAINT "WhatsAppConnection_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectionEvent" ADD CONSTRAINT "ConnectionEvent_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "WhatsAppConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppGroup" ADD CONSTRAINT "WhatsAppGroup_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppGroup" ADD CONSTRAINT "WhatsAppGroup_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "WhatsAppConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "WhatsAppConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "WhatsAppGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageClassification" ADD CONSTRAINT "MessageClassification_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionSchema" ADD CONSTRAINT "ExtractionSchema_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionField" ADD CONSTRAINT "ExtractionField_schemaId_fkey" FOREIGN KEY ("schemaId") REFERENCES "ExtractionSchema"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Automation" ADD CONSTRAINT "Automation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Automation" ADD CONSTRAINT "Automation_schemaId_fkey" FOREIGN KEY ("schemaId") REFERENCES "ExtractionSchema"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationTrigger" ADD CONSTRAINT "AutomationTrigger_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationTrigger" ADD CONSTRAINT "AutomationTrigger_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "WhatsAppGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationAction" ADD CONSTRAINT "AutomationAction_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationAction" ADD CONSTRAINT "AutomationAction_outputTargetId_fkey" FOREIGN KEY ("outputTargetId") REFERENCES "OutputTarget"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedRecord" ADD CONSTRAINT "ExtractedRecord_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedRecord" ADD CONSTRAINT "ExtractedRecord_schemaId_fkey" FOREIGN KEY ("schemaId") REFERENCES "ExtractionSchema"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedRecord" ADD CONSTRAINT "ExtractedRecord_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedRecord" ADD CONSTRAINT "ExtractedRecord_originMessageId_fkey" FOREIGN KEY ("originMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordSource" ADD CONSTRAINT "RecordSource_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "ExtractedRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordSource" ADD CONSTRAINT "RecordSource_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordFieldEvent" ADD CONSTRAINT "RecordFieldEvent_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "ExtractedRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordFieldEvent" ADD CONSTRAINT "RecordFieldEvent_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Output" ADD CONSTRAINT "Output_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Output" ADD CONSTRAINT "Output_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutputTarget" ADD CONSTRAINT "OutputTarget_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutputTarget" ADD CONSTRAINT "OutputTarget_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutputTarget" ADD CONSTRAINT "OutputTarget_outputId_fkey" FOREIGN KEY ("outputId") REFERENCES "Output"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutputMapping" ADD CONSTRAINT "OutputMapping_outputTargetId_fkey" FOREIGN KEY ("outputTargetId") REFERENCES "OutputTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutputSyncRecord" ADD CONSTRAINT "OutputSyncRecord_outputId_fkey" FOREIGN KEY ("outputId") REFERENCES "Output"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutputSyncRecord" ADD CONSTRAINT "OutputSyncRecord_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "ExtractedRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutputVersion" ADD CONSTRAINT "OutputVersion_outputId_fkey" FOREIGN KEY ("outputId") REFERENCES "Output"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutputConflict" ADD CONSTRAINT "OutputConflict_outputId_fkey" FOREIGN KEY ("outputId") REFERENCES "Output"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_outputId_fkey" FOREIGN KEY ("outputId") REFERENCES "Output"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRunStep" ADD CONSTRAINT "WorkflowRunStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRunStep" ADD CONSTRAINT "WorkflowRunStep_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "AutomationAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationCredential" ADD CONSTRAINT "IntegrationCredential_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Export" ADD CONSTRAINT "Export_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIUsage" ADD CONSTRAINT "AIUsage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerHeartbeat" ADD CONSTRAINT "WorkerHeartbeat_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthCheck" ADD CONSTRAINT "HealthCheck_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
