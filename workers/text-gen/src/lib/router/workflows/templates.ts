/**
 * Built-in Workflow Templates
 * Pre-defined workflows for common use cases
 */

import type { WorkflowDefinition } from '../types';

/**
 * Social Media Post Generator
 * Creates post copy and matching image
 */
export const SOCIAL_POST_WORKFLOW: WorkflowDefinition = {
  id: 'social-post',
  name: 'Social Media Post Generator',
  description: 'Generate engaging social media copy with a matching image',
  steps: [
    {
      id: 'generate-copy',
      worker: 'text-gen',
      prompt_template:
        'Write a {{platform}} post about {{topic}}. Keep it engaging, conversational, and appropriate for the platform. Include relevant hashtags if appropriate.',
      input_from: 'request',
      output_key: 'post_text',
      constraints: { min_quality: 'standard' },
      options: { max_tokens: 500, temperature: 0.8 },
    },
    {
      id: 'generate-image',
      worker: 'image-gen',
      prompt_template:
        'Create a social media image that complements this post: "{{post_text}}". Make it eye-catching and shareable.',
      input_from: 'step:generate-copy',
      output_key: 'post_image',
      constraints: { min_quality: 'standard' },
      options: { aspect_ratio: '1:1' },
    },
  ],
  parallel_groups: [['generate-copy'], ['generate-image']],
};

/**
 * Blog Post with Featured Image
 * Creates a full blog article with a custom featured image
 */
export const BLOG_POST_WORKFLOW: WorkflowDefinition = {
  id: 'blog-with-image',
  name: 'Blog Post with Featured Image',
  description: 'Generate a full blog article with an AI-generated featured image',
  steps: [
    {
      id: 'write-article',
      worker: 'text-gen',
      prompt_template:
        'Write a comprehensive blog post about {{topic}}. Include:\n- An engaging introduction\n- 3-4 main sections with clear headings\n- Practical examples or tips\n- A conclusion with key takeaways\n\nTarget audience: {{audience}}',
      input_from: 'request',
      output_key: 'article',
      constraints: {
        require_capabilities: ['reasoning'],
        min_quality: 'premium',
      },
      options: { max_tokens: 2000, temperature: 0.7 },
    },
    {
      id: 'create-image-prompt',
      worker: 'text-gen',
      prompt_template:
        'Based on this article, write a detailed image generation prompt for a featured blog image. The image should be professional, relevant to the topic, and work well as a header image.\n\nArticle:\n{{article}}\n\nCreate a prompt that would generate a visually striking, professional image.',
      input_from: 'step:write-article',
      output_key: 'image_prompt',
      constraints: { min_quality: 'draft' },
      options: { max_tokens: 200, temperature: 0.6 },
    },
    {
      id: 'generate-featured-image',
      worker: 'image-gen',
      prompt_template: '{{image_prompt}}',
      input_from: 'step:create-image-prompt',
      output_key: 'featured_image',
      options: { aspect_ratio: '16:9', style: 'photorealistic' },
    },
  ],
};

/**
 * Product Description Generator
 * Creates SEO-optimized product descriptions
 */
export const PRODUCT_DESCRIPTION_WORKFLOW: WorkflowDefinition = {
  id: 'product-description',
  name: 'Product Description Generator',
  description: 'Generate SEO-friendly product descriptions with key features',
  steps: [
    {
      id: 'analyze-product',
      worker: 'text-gen',
      prompt_template:
        'Analyze this product and identify its key features and benefits:\n\nProduct: {{product_name}}\nCategory: {{category}}\nDetails: {{product_details}}\n\nList the top 5 selling points.',
      input_from: 'request',
      output_key: 'analysis',
      constraints: { min_quality: 'standard' },
      options: { max_tokens: 500, temperature: 0.5 },
    },
    {
      id: 'write-description',
      worker: 'text-gen',
      prompt_template:
        'Write a compelling product description based on these selling points:\n\n{{analysis}}\n\nProduct: {{product_name}}\n\nMake it:\n- SEO-optimized\n- Benefit-focused\n- Easy to scan\n- 150-200 words',
      input_from: 'step:analyze-product',
      output_key: 'description',
      constraints: { min_quality: 'standard' },
      options: { max_tokens: 400, temperature: 0.7 },
    },
  ],
};

/**
 * Podcast Script Generator
 * Creates a podcast episode script with narration-ready text
 */
export const PODCAST_SCRIPT_WORKFLOW: WorkflowDefinition = {
  id: 'podcast-script',
  name: 'Podcast Script Generator',
  description: 'Generate a podcast episode script with intro, segments, and outro',
  steps: [
    {
      id: 'create-outline',
      worker: 'text-gen',
      prompt_template:
        'Create a podcast episode outline about {{topic}}.\n\nShow name: {{show_name}}\nHost: {{host_name}}\nTarget length: {{duration}} minutes\n\nInclude:\n- Hook/teaser\n- 3-4 main segments\n- Transitions\n- Call to action',
      input_from: 'request',
      output_key: 'outline',
      constraints: { min_quality: 'standard' },
      options: { max_tokens: 600, temperature: 0.7 },
    },
    {
      id: 'write-script',
      worker: 'text-gen',
      prompt_template:
        'Write a full podcast script based on this outline:\n\n{{outline}}\n\nMake it:\n- Conversational and natural for speaking\n- Include transition phrases\n- Add personality and warmth\n- Include [PAUSE] and [EMPHASIS] markers where appropriate',
      input_from: 'step:create-outline',
      output_key: 'script',
      constraints: {
        require_capabilities: ['reasoning'],
        min_quality: 'premium',
      },
      options: { max_tokens: 3000, temperature: 0.8 },
    },
  ],
};

/**
 * Video Storyboard Generator
 * Creates a storyboard with scene descriptions and key frames
 */
export const VIDEO_STORYBOARD_WORKFLOW: WorkflowDefinition = {
  id: 'video-storyboard',
  name: 'Video Storyboard Generator',
  description: 'Generate a video storyboard with scene descriptions and key frame images',
  steps: [
    {
      id: 'create-scenes',
      worker: 'text-gen',
      prompt_template:
        'Create a video storyboard for a {{duration}}-second video about {{topic}}.\n\nStyle: {{style}}\n\nFor each scene, provide:\n- Scene number and duration\n- Visual description\n- Camera movement\n- Text/narration overlay (if any)\n\nCreate 4-6 scenes.',
      input_from: 'request',
      output_key: 'scenes',
      constraints: { min_quality: 'standard' },
      options: { max_tokens: 1000, temperature: 0.7 },
    },
    {
      id: 'generate-thumbnail',
      worker: 'image-gen',
      prompt_template:
        'Create a video thumbnail for a video about {{topic}}. Style: {{style}}. Make it eye-catching and clickable.',
      input_from: 'request',
      output_key: 'thumbnail',
      options: { aspect_ratio: '16:9' },
    },
  ],
  parallel_groups: [['create-scenes', 'generate-thumbnail']],
};

/**
 * All built-in workflows
 */
export const BUILT_IN_WORKFLOWS: WorkflowDefinition[] = [
  SOCIAL_POST_WORKFLOW,
  BLOG_POST_WORKFLOW,
  PRODUCT_DESCRIPTION_WORKFLOW,
  PODCAST_SCRIPT_WORKFLOW,
  VIDEO_STORYBOARD_WORKFLOW,
];

/**
 * Get a built-in workflow by ID
 */
export function getBuiltInWorkflow(id: string): WorkflowDefinition | null {
  return BUILT_IN_WORKFLOWS.find((w) => w.id === id) || null;
}
