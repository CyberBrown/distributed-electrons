You are Agent 2.3 working for Team Leader 2 on R2 Storage Manager.

YOUR TASK:
Build the R2 storage manager that saves generated images and returns CDN URLs.

BRANCH: agent-2-3-r2-manager (create from team-2-workers)

CREATE:
1. /workers/shared/r2-manager/storage.ts
   - Upload image to R2
   - Generate CDN URL
   - Handle bucket selection (instance-specific or default)

2. /workers/shared/r2-manager/metadata.ts
   - Attach metadata to R2 objects
   - Retrieve metadata

3. /workers/shared/r2-manager/types.ts
   - UploadResult interface
   - StorageOptions interface

4. /tests/r2-manager/
   - Mock R2 binding
   - Test upload flow
   - Test URL generation

INTERFACE:
```typescript
async function uploadImage(
  imageData: ArrayBuffer | ReadableStream,
  options: {
    instanceId: string,
    projectId?: string,
    filename: string,
    metadata: Record<string, string>
  },
  env: Env
): Promise<UploadResult>

interface UploadResult {
  r2_path: string;
  cdn_url: string;
  bucket: string;
  size_bytes: number;
}
```

FLOW:
1. Determine bucket from instance config (or use default)
2. Generate unique filename: `{instance_id}/{project_id}/{timestamp}_{filename}`
3. Upload to R2 with metadata
4. Generate public CDN URL
5. Return URL + path

CDN URL FORMAT:
https://cdn.yourdomain.com/{bucket}/{path}
OR
https://pub-{random}.r2.dev/{path}

METADATA:
Store as R2 custom metadata:
- instance_id
- project_id
- provider
- model
- prompt (truncated)
- generation_timestamp

COMPLETION:
Commit, push, notify: "[AGENT-2-3] R2 manager complete"

BEGIN.
