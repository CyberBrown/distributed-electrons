You are Agent 4.1 working for Team Leader 4 on Testing GUI.

YOUR TASK:
Build a simple web interface to test the image generation worker.

BRANCH: agent-4-1-testing-gui (create from team-4-interfaces)

CREATE:
1. /interfaces/testing-gui/
   - Cloudflare Pages app (React or vanilla JS)
   - Single page with form
   - Displays results

2. Form fields:
   - API Key (input)
   - Instance ID (dropdown)
   - Prompt (textarea)
   - Model (dropdown, optional)
   - Generate button

3. Results display:
   - Generated image
   - CDN URL (copyable)
   - R2 path
   - Metadata (provider, time, etc.)
   - Request ID

4. Error display:
   - Error messages
   - Status codes

TECH STACK:
Simple HTML + JavaScript (no complex framework needed for MVP)

FUNCTIONALITY:
```javascript
async function generateImage() {
  const response = await fetch('https://image-gen-production.workers.dev/generate', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      prompt,
      instance_id: instanceId
    })
  });

  const result = await response.json();
  displayImage(result.image_url);
  displayMetadata(result);
}
```

STYLING:
Simple, clean. Use Tailwind CSS or basic CSS.

DEPLOYMENT:
Cloudflare Pages, auto-deploy from git.

COMPLETION:
Deploy to Pages, test, commit, push, notify: "[AGENT-4-1] Testing GUI deployed"

BEGIN.
