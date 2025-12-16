-- Migration: Workflow Support
-- Version: 1.0
-- Created: 2025-12-15
-- Description: Add workflow tracking columns to requests table
-- Reference: workers/workflows/VideoRenderWorkflow.ts

-- ============================================================================
-- ALTER TABLE: requests
-- Description: Add columns to track Cloudflare Workflow execution
-- ============================================================================

-- Add workflow_instance_id to track the Cloudflare Workflow instance
ALTER TABLE requests ADD COLUMN workflow_instance_id TEXT;

-- Add workflow_name to identify which workflow is handling the request
ALTER TABLE requests ADD COLUMN workflow_name TEXT;

-- ============================================================================
-- INDEXES: Workflow tracking
-- ============================================================================

-- Index for looking up requests by workflow instance
CREATE INDEX idx_requests_workflow_instance ON requests(workflow_instance_id);

-- Index for finding all requests handled by a specific workflow type
CREATE INDEX idx_requests_workflow_name ON requests(workflow_name);

-- Compound index for monitoring workflow-processed requests
CREATE INDEX idx_requests_workflow_status ON requests(workflow_name, status);

-- ============================================================================
-- UPDATE: Status constraint
-- Note: SQLite doesn't support modifying CHECK constraints directly.
-- The existing status values work for workflows:
-- - 'pending' -> initial state
-- - 'queued' -> for DO-routed requests (not used by workflows)
-- - 'processing' -> workflow is running (set by intake as 'processing' or use existing)
-- - 'completed' -> workflow finished successfully
-- - 'failed' -> workflow failed
-- - 'cancelled' -> workflow/request cancelled
--
-- For workflows, we use 'processing' to indicate workflow is active.
-- No constraint change needed.
-- ============================================================================

-- ============================================================================
-- OPTIONAL: Workflow execution logs table
-- Uncomment if detailed step-by-step logging is needed
-- ============================================================================

-- CREATE TABLE workflow_logs (
--     id TEXT PRIMARY KEY,
--     request_id TEXT NOT NULL,
--     workflow_instance_id TEXT NOT NULL,
--     workflow_name TEXT NOT NULL,
--     step_name TEXT,
--     status TEXT NOT NULL CHECK(status IN ('started', 'completed', 'failed', 'retrying')),
--     message TEXT,
--     metadata JSON,
--     created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
--     FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE
-- );
--
-- CREATE INDEX idx_workflow_logs_request ON workflow_logs(request_id);
-- CREATE INDEX idx_workflow_logs_instance ON workflow_logs(workflow_instance_id);
-- CREATE INDEX idx_workflow_logs_created ON workflow_logs(created_at DESC);
