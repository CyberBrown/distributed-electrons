# DE Queue Naming Discipline — Audit Results

## Principle
The word "task" in DE should ONLY refer to a Nexus task. Internal DE concepts should use "request" or "job".

## What Should Stay
- `task_id` in `PrimeWorkflowParams`, `CodeExecutionParams`, callback payloads — these reference Nexus task IDs
- `body.task` in sandbox-executor — this is the prompt/work content, not a type identifier
- All Nexus API integration code

## What Should Be Renamed (Incrementally)

### Priority 1: D1 Schema (Requires Migration)
- `requests.task_type` column -> `request_type`
- `prompts.task_type` column -> `service_type`
- `task_classifications.task_type` column -> `request_type`
- `provider_routing_rules.task_type` column -> `request_type`
- `intake_reroute_tracking.task_type` column -> `request_type`

### Priority 2: TypeScript Interfaces
- `IntakePayload.task_type` -> `request_type` (with backwards-compat alias)
- `StoredRequest.task_type` -> `request_type`
- `PrimeWorkflowResult.task_type` -> `service_type` or `workflow_type`

### Priority 3: Function Names
- `inferTaskType()` in intake-reroute.ts -> `inferRequestType()`
- `classifyRequestType()` in intake/index.ts — already uses "RequestType" but reads `body.task_type`

### Priority 4: Comments (No Functional Impact)
- ~50+ occurrences of "task" in comments across workflows, intake, sandbox-executor
- "task tracking" -> "request tracking"
- "complete the task" -> "complete the request"
- "validate task parameters" -> "validate request parameters"
- Workflow step names: "validate-task" -> "validate-request"

## Notes
- D1 migration needed before any column renames
- Public API field `task_type` in intake payload needs backwards-compat handling
- Estimated total scope: ~80-100 code references
- No urgent deadline — do incrementally during Phase 2
