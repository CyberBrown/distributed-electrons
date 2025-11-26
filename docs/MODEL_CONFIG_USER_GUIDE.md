# Model Configuration - User Guide

This guide explains how to use different AI models in the Testing GUI.

## Overview

The Cloudflare Multi-Agent System supports multiple AI providers and models for image and video generation. You can select the model that best fits your needs directly from the Testing GUI.

## Accessing the Testing GUI

1. Open the Testing GUI: `https://testing.distributedelectrons.com`
2. Enter your API key
3. Enter your Instance ID
4. Select a model from the dropdown

## Model Selection

### Model Dropdown

The model dropdown is organized by provider:

```
Auto (Default)
──────────────
IDEOGRAM
  ├─ Ideogram V2
  └─ Ideogram V2 Turbo
OPENAI
  ├─ DALL-E 3
  └─ DALL-E 2
GEMINI
  ├─ Gemini Veo 3.1
  ├─ Gemini 2.5 Flash Image (Beta)
  └─ Gemini Imagen 3
ANTHROPIC
  └─ Claude 3.5 Sonnet
```

### Auto (Default)

When "Auto" is selected:
- System chooses the best model based on your prompt
- Usually selects the most cost-effective option
- Recommended for most users

### Selecting a Specific Model

Click the dropdown and choose a model:
1. Models are grouped by provider (IDEOGRAM, OPENAI, etc.)
2. Beta models are marked with "(Beta)"
3. Deprecated models are hidden from the list

## Understanding Model Capabilities

Different models support different features:

### Image Generation Models

**Best for:** Creating static images from text prompts

**Examples:**
- Ideogram V2 - Excellent text rendering in images
- DALL-E 3 - High-quality, detailed images
- Gemini 2.5 Flash Image - Fast, cost-effective

**Typical Options:**
- Aspect Ratio: 1:1, 16:9, 9:16, 4:3, 3:4
- Style: Realistic, Artistic, Anime, Photography
- Quality: Standard, HD

### Video Generation Models

**Best for:** Creating short videos from text prompts

**Examples:**
- Gemini Veo 3.1 - Advanced video generation with various aspect ratios

**Typical Options:**
- Aspect Ratio: 16:9, 9:16, 1:1
- Video Length: 4s, 8s, 16s
- Quality: Standard, HD

### Text Generation Models

**Best for:** Text-based tasks (not for image/video generation)

**Examples:**
- Claude 3.5 Sonnet - Complex text tasks

**Note:** These appear in the list but won't generate images/videos.

## Generating Images

### Basic Workflow

1. **Enter API Key** (saved in browser for convenience)
2. **Enter Instance ID** (saved in browser)
3. **Write your prompt**
   ```
   Example: "A serene mountain landscape at sunset with snow-capped peaks"
   ```
4. **Select model** (or leave as "Auto")
5. **Adjust options** (optional)
   - Aspect Ratio
   - Style
6. **Click "Generate Image"**

### Prompt Tips

**Good Prompts:**
```
✓ "A photorealistic portrait of a cat wearing a crown, studio lighting"
✓ "Minimalist logo design for a tech startup, clean lines, blue and white"
✓ "Anime-style illustration of a futuristic city at night"
```

**Less Effective:**
```
✗ "cat" (too vague)
✗ "make it good" (no visual description)
✗ "like that other image but different" (AI can't see previous images)
```

### Advanced Options

Click the **Advanced Options** arrow to expand:

**Aspect Ratio:**
- `1:1` - Square (default)
- `16:9` - Landscape (wide)
- `9:16` - Portrait (tall)
- `4:3` - Standard landscape
- `3:4` - Standard portrait

**Style:** (model-dependent)
- Realistic
- Artistic
- Anime
- Photography
- 3D Render

**Quality:** (if supported by model)
- Standard - Faster, cheaper
- HD - Higher resolution, better detail

## Understanding Results

### Image Display

After generation completes, you'll see:
1. **Generated Image** - Click to open full-size in new tab
2. **Image URL** - Public URL to share/embed
3. **R2 Path** - Storage location
4. **Metadata:**
   - Provider - Which API was used
   - Model - Specific model version
   - Dimensions - Image size (e.g., 1024x1024)
   - Generation Time - How long it took (milliseconds)
   - Request ID - For support/debugging

### Copying Image URL

Click the **Copy URL** button to copy the public image URL to clipboard.

Share this URL in:
- Websites/blogs
- Social media
- Documentation
- Email

**Note:** URLs are permanent and publicly accessible.

## Model Selection Guide

### When to Use Each Model

**Ideogram V2**
- ✓ Need text in images (logos, posters, signs)
- ✓ Realistic images with sharp details
- ✓ General-purpose image generation
- Cost: ~$0.08/image

**DALL-E 3**
- ✓ Complex, detailed scenes
- ✓ Artistic interpretations
- ✓ Precise prompt following
- Cost: ~$0.04/image

**Gemini 2.5 Flash Image**
- ✓ Fast turnaround needed
- ✓ High volume generation
- ✓ Cost-sensitive projects
- Cost: ~$0.02/image

**Gemini Veo 3.1**
- ✓ Video generation
- ✓ Motion and animation
- ✓ Video content for social media
- Cost: ~$0.50/video

## Troubleshooting

### "Invalid API key" Error

**Solution:**
1. Check API key in Admin Panel
2. Ensure key is for the correct provider
3. Verify key has necessary permissions
4. Check key hasn't expired

### "Instance not found" Error

**Solution:**
1. Verify Instance ID is correct
2. Check instance exists in Admin Panel > Instances
3. Ensure instance is active (not disabled)

### "Rate limit exceeded" Error

**Solution:**
1. Wait a few moments before retrying
2. Check rate limits in Admin Panel
3. Consider upgrading your provider plan
4. Use a different model with higher limits

### Generation Timeout

**Solution:**
1. Try again (provider may be busy)
2. Simplify your prompt
3. Use a faster model (e.g., Flash instead of standard)
4. Check provider status page

### Model Not Available

**Solution:**
1. Refresh the page
2. Try "Auto" mode
3. Check if model is deprecated
4. Contact admin to verify model configuration

## Mock API Mode

Toggle **Use Mock API** for testing without using real API credits:

**Mock Mode:**
- ✓ No API calls to providers
- ✓ No credits used
- ✓ Returns placeholder images from Lorem Picsum
- ✓ Simulates realistic delays
- ✓ Occasionally simulates errors for testing

**Use Mock Mode For:**
- Learning the interface
- Testing integrations
- Developing without API keys
- Demonstrating to stakeholders

**Note:** Mock mode doesn't reflect actual model behavior or quality.

## Cost Optimization Tips

### 1. Use Auto Mode

Let the system choose the most cost-effective model for your prompt.

### 2. Choose Standard Quality

Unless you need HD, standard quality is often sufficient and cheaper.

### 3. Batch Similar Requests

Generate multiple variations at once rather than one-by-one.

### 4. Use Appropriate Models

Don't use expensive models for simple tasks:
- Simple logo? Use Flash model
- Complex artwork? Use DALL-E 3 or Ideogram V2

### 5. Refine Prompts

Better prompts = fewer regenerations = lower costs

## Keyboard Shortcuts

- `Ctrl/Cmd + Enter` - Generate image (when focused in prompt field)
- `Esc` - Clear status messages
- Click image - Open full-size in new tab

## Privacy and Security

### API Keys
- Stored locally in browser (localStorage)
- Never sent to our servers except encrypted
- Clear browser data to remove

### Generated Images
- Stored in R2 (Cloudflare Object Storage)
- URLs are public and shareable
- Images are permanent (not automatically deleted)
- No built-in privacy controls

**For sensitive content:**
- Use a dedicated instance
- Don't share URLs publicly
- Contact admin for deletion

## Limits and Quotas

Limits vary by instance configuration:

**Free Tier (typical):**
- 100 requests per minute
- 50,000 tokens per minute
- 10 concurrent requests

**Pro Tier (typical):**
- 500 requests per minute
- 200,000 tokens per minute
- 50 concurrent requests

Check with your admin for your specific limits.

## Best Practices

### 1. Start with Auto Mode

Let the system choose the best model, then switch to specific models if needed.

### 2. Be Specific in Prompts

```
Good: "A red vintage car parked in front of a 1950s diner at sunset"
Better: "A cherry red 1957 Chevrolet Bel Air parked in front of a neon-lit chrome diner at golden hour, photorealistic style"
```

### 3. Experiment with Options

Try different aspect ratios and styles to find what works best.

### 4. Save Good Prompts

Keep a document of prompts that worked well for future reference.

### 5. Check Results Metadata

The metadata shows which model was actually used - helpful when using Auto mode.

## FAQ

**Q: Can I use multiple models in one request?**
A: No, select one model per generation. Use Auto mode for intelligent selection.

**Q: How long do generated images stay available?**
A: Images are stored permanently in R2 unless manually deleted by admin.

**Q: Can I edit generated images?**
A: Not directly. Some models support inpainting (editing specific regions) - check model capabilities.

**Q: What's the difference between providers?**
A: Different providers use different AI models with varying strengths:
- Ideogram: Best for text in images
- OpenAI: Best for complex scenes
- Gemini: Best for video and cost-effectiveness

**Q: Why does the same prompt produce different results?**
A: AI generation is non-deterministic. Each generation is unique.

**Q: Can I generate images in bulk?**
A: Not through Testing GUI. Use the API directly for bulk operations.

**Q: Are NSFW/adult prompts allowed?**
A: Depends on instance configuration and provider policies. Most providers block explicit content.

## Support

**For Issues:**
1. Check this guide
2. Review browser console for errors (F12)
3. Contact your instance administrator
4. Provide Request ID from failed generation

## See Also

- [Admin Guide](./MODEL_CONFIG_ADMIN_GUIDE.md) - For administrators
- [API Documentation](./API_DOCUMENTATION.md) - For developers
- [Payload Mapping Spec](./PAYLOAD_MAPPING_SPEC.md) - Technical details
