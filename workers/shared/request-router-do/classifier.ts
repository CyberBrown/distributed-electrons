/**
 * Task Classifier
 * Determines task type and optimal provider/model based on query analysis
 */

import type { TaskType, ClassificationResult } from './types';

// Keyword patterns for task type detection
const TASK_PATTERNS: Record<TaskType, RegExp[]> = {
  image: [
    /\b(draw|paint|sketch|illustrate|picture|image|photo|photograph|generate.*image|create.*image|make.*image)\b/i,
    /\b(visual|illustration|artwork|graphic|render.*image)\b/i,
  ],
  text: [
    /\b(write|compose|draft|create.*text|explain|describe|summarize|generate.*text)\b/i,
    /\b(answer|respond|tell|help.*with|analyze|review)\b/i,
  ],
  audio: [
    /\b(speak|say|narrate|voice|read.*aloud|text.to.speech|tts|audio)\b/i,
    /\b(synthesize.*speech|convert.*to.*audio)\b/i,
  ],
  video: [
    /\b(render|video|animation|animate|movie|clip)\b/i,
    /\b(create.*video|make.*video|generate.*video)\b/i,
  ],
  context: [
    /\b(from.*context|in.*codebase|search.*docs|look.*up|find.*in)\b/i,
    /\b(query.*cache|context.*query|rag)\b/i,
  ],
  unknown: [],
};

// Subtask patterns for more specific routing
const SUBTASK_PATTERNS: Record<string, RegExp[]> = {
  // Image subtasks
  'image:illustration': [/\b(cartoon|illustration|sketch|drawing|anime|artistic)\b/i],
  'image:photo-realistic': [/\b(photo|realistic|photograph|real|life-like)\b/i],
  'image:logo': [/\b(logo|icon|brand|emblem)\b/i],
  // Text subtasks
  'text:fast': [/\b(quick|fast|brief|short|simple)\b/i],
  'text:detailed': [/\b(detailed|comprehensive|thorough|in-depth|long)\b/i],
  'text:creative': [/\b(creative|story|poem|fiction|imaginative)\b/i],
  'text:code': [/\b(code|program|function|script|developer)\b/i],
};

// Default provider/model mappings
// Simple text tasks use text-gen-workflow (waterfall: runners → Nemotron → APIs)
// Code tasks use sandbox-executor (Claude Code CLI for agentic code execution)
const DEFAULT_ROUTING: Record<TaskType, { provider: string; model: string }> = {
  text: { provider: 'text-gen-workflow', model: 'waterfall' },
  image: { provider: 'ideogram', model: 'ideogram-v2' },
  audio: { provider: 'elevenlabs', model: 'eleven_multilingual_v2' },
  video: { provider: 'shotstack', model: 'default' },
  context: { provider: 'gemini', model: 'gemini-context' },
  unknown: { provider: 'text-gen-workflow', model: 'waterfall' },
};

// Subtask-specific routing overrides
// Code tasks go to sandbox-executor, other text tasks go through text-gen-workflow
const SUBTASK_ROUTING: Record<string, { provider: string; model: string }> = {
  'image:illustration': { provider: 'gemini', model: 'gemini-nano-banana' },
  'image:photo-realistic': { provider: 'ideogram', model: 'ideogram-v2' },
  // Simple text tasks use text-gen-workflow (waterfall: runners → Nemotron → APIs)
  'text:fast': { provider: 'text-gen-workflow', model: 'waterfall' },
  'text:detailed': { provider: 'text-gen-workflow', model: 'waterfall' },
  'text:creative': { provider: 'text-gen-workflow', model: 'waterfall' },
  // Code tasks need Claude Code for agentic code execution
  'text:code': { provider: 'sandbox-executor', model: 'claude-code' },
};

/**
 * Classify a query to determine task type and routing
 */
export function classifyQuery(query: string): ClassificationResult {
  const normalizedQuery = query.toLowerCase().trim();

  // Score each task type
  const scores: Record<TaskType, number> = {
    text: 0,
    image: 0,
    audio: 0,
    video: 0,
    context: 0,
    unknown: 0,
  };

  // Check patterns for each task type
  for (const [taskType, patterns] of Object.entries(TASK_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(normalizedQuery)) {
        scores[taskType as TaskType] += 1;
      }
    }
  }

  // Find highest scoring task type
  let maxScore = 0;
  let detectedType: TaskType = 'unknown';

  for (const [taskType, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      detectedType = taskType as TaskType;
    }
  }

  // If no matches, default to text (most common)
  if (maxScore === 0) {
    detectedType = 'text';
    maxScore = 0.5; // Low confidence
  }

  // Detect subtask for more specific routing
  let detectedSubtask: string | undefined;
  for (const [subtask, patterns] of Object.entries(SUBTASK_PATTERNS)) {
    if (subtask.startsWith(`${detectedType}:`)) {
      for (const pattern of patterns) {
        if (pattern.test(normalizedQuery)) {
          detectedSubtask = subtask;
          break;
        }
      }
    }
    if (detectedSubtask) break;
  }

  // Get routing based on task type and subtask
  const routing = detectedSubtask && SUBTASK_ROUTING[detectedSubtask]
    ? SUBTASK_ROUTING[detectedSubtask]
    : DEFAULT_ROUTING[detectedType];

  // Calculate confidence (0-1)
  const confidence = Math.min(maxScore / 3, 1);

  return {
    task_type: detectedType,
    provider: routing.provider,
    model: routing.model,
    confidence,
    subtask: detectedSubtask?.split(':')[1],
  };
}

/**
 * Classify with explicit task type override
 * Used when client already knows the task type
 */
export function classifyWithType(
  query: string,
  taskType: TaskType
): ClassificationResult {
  const normalizedQuery = query.toLowerCase().trim();

  // Detect subtask within the given task type
  let detectedSubtask: string | undefined;
  for (const [subtask, patterns] of Object.entries(SUBTASK_PATTERNS)) {
    if (subtask.startsWith(`${taskType}:`)) {
      for (const pattern of patterns) {
        if (pattern.test(normalizedQuery)) {
          detectedSubtask = subtask;
          break;
        }
      }
    }
    if (detectedSubtask) break;
  }

  // Get routing
  const routing = detectedSubtask && SUBTASK_ROUTING[detectedSubtask]
    ? SUBTASK_ROUTING[detectedSubtask]
    : DEFAULT_ROUTING[taskType];

  return {
    task_type: taskType,
    provider: routing.provider,
    model: routing.model,
    confidence: 1, // High confidence when explicitly specified
    subtask: detectedSubtask?.split(':')[1],
  };
}

/**
 * Get estimated processing time for a task type (in ms)
 */
export function getEstimatedProcessingTime(
  taskType: TaskType,
  provider: string
): number {
  const estimates: Record<string, number> = {
    'text:anthropic': 2000,
    'text:openai': 1500,
    'text:sandbox-executor': 30000, // Container startup + Claude Code execution
    'text:text-gen-workflow': 5000, // Waterfall may use fast local providers
    'image:ideogram': 15000,
    'image:gemini': 10000,
    'audio:elevenlabs': 5000,
    'video:shotstack': 60000,
    'context:gemini': 20000,
  };

  return estimates[`${taskType}:${provider}`] || 5000;
}
