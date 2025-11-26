/**
 * Text Generation Testing GUI
 * Connects to the text-gen worker with proper authentication
 */

// Configuration
const CONFIG = {
  textGenUrl: 'https://text-testing.your-domain.com',
  configServiceUrl: 'https://config-service.your-subdomain.workers.dev',
};

// State
const state = {
  isGenerating: false,
  instances: [],
  models: [],
  currentApiKey: null,
};

// DOM Elements
const elements = {
  form: document.getElementById('generateForm'),
  instanceId: document.getElementById('instanceId'),
  model: document.getElementById('model'),
  prompt: document.getElementById('prompt'),
  promptLength: document.getElementById('promptLength'),
  systemPrompt: document.getElementById('systemPrompt'),
  temperature: document.getElementById('temperature'),
  tempValue: document.getElementById('tempValue'),
  maxTokens: document.getElementById('maxTokens'),
  generateBtn: document.getElementById('generateBtn'),
  statusMessage: document.getElementById('statusMessage'),
  toggleAdvanced: document.getElementById('toggleAdvanced'),
  advancedArrow: document.getElementById('advancedArrow'),
  advancedOptions: document.getElementById('advancedOptions'),
  noResults: document.getElementById('noResults'),
  loadingState: document.getElementById('loadingState'),
  loadingMessage: document.getElementById('loadingMessage'),
  resultsDisplay: document.getElementById('resultsDisplay'),
  generatedText: document.getElementById('generatedText'),
  copyTextBtn: document.getElementById('copyTextBtn'),
  metaProvider: document.getElementById('metaProvider'),
  metaModel: document.getElementById('metaModel'),
  metaTokens: document.getElementById('metaTokens'),
  metaTime: document.getElementById('metaTime'),
  metaRequestId: document.getElementById('metaRequestId'),
  authStatus: document.getElementById('authStatus'),
  loginBtn: document.getElementById('loginBtn'),
  authInfo: document.getElementById('authInfo'),
};

// Initialize
async function init() {
  setupEventListeners();
  await loadModels();
  await checkAuth();
}

// Setup Event Listeners
function setupEventListeners() {
  elements.form.addEventListener('submit', handleSubmit);
  elements.prompt.addEventListener('input', updatePromptLength);
  elements.temperature.addEventListener('input', updateTempDisplay);
  elements.toggleAdvanced.addEventListener('click', toggleAdvancedOptions);
  elements.copyTextBtn.addEventListener('click', copyText);
  elements.loginBtn.addEventListener('click', showLoginPrompt);
}

// Check authentication
async function checkAuth() {
  // Get API key from localStorage or prompt
  const apiKey = localStorage.getItem('apiKey');

  if (!apiKey) {
    elements.authStatus.textContent = 'Not authenticated. Please login.';
    elements.loginBtn.classList.remove('hidden');
    elements.authInfo.classList.remove('bg-blue-50', 'border-blue-200');
    elements.authInfo.classList.add('bg-yellow-50', 'border-yellow-200');
    elements.authStatus.classList.remove('text-blue-700');
    elements.authStatus.classList.add('text-yellow-700');
    return;
  }

  state.currentApiKey = apiKey;

  // Test authentication
  try {
    const response = await fetch(`${CONFIG.textGenUrl}/health`);
    if (response.ok) {
      elements.authStatus.textContent = `Authenticated with key: ${sanitizeKey(apiKey)}`;
      elements.loginBtn.classList.add('hidden');
      elements.authInfo.classList.remove('bg-yellow-50', 'border-yellow-200');
      elements.authInfo.classList.add('bg-green-50', 'border-green-200');
      elements.authStatus.classList.remove('text-yellow-700');
      elements.authStatus.classList.add('text-green-700');

      // Load instances for this key
      await loadInstances();
    }
  } catch (error) {
    console.error('Auth check failed:', error);
    elements.authStatus.textContent = 'Authentication check failed';
  }
}

// Show login prompt
function showLoginPrompt() {
  const apiKey = prompt('Enter your API key (sk_live_... or sk_test_...):');

  if (apiKey && (apiKey.startsWith('sk_live_') || apiKey.startsWith('sk_test_'))) {
    localStorage.setItem('apiKey', apiKey);
    checkAuth();
  } else if (apiKey) {
    showStatus('Invalid API key format. Must start with sk_live_ or sk_test_', 'error');
  }
}

// Sanitize API key for display
function sanitizeKey(key) {
  if (!key || key.length < 20) return '***';
  return `${key.substring(0, 12)}...${key.substring(key.length - 4)}`;
}

// Load available instances
async function loadInstances() {
  try {
    // For now, use mock instances since we need the auth flow working first
    // In production, this would call the config service with auth
    state.instances = [
      { instance_id: 'production', name: 'Production' },
      { instance_id: 'development', name: 'Development' },
      { instance_id: 'staging', name: 'Staging' },
    ];

    populateInstanceDropdown();
  } catch (error) {
    console.error('Error loading instances:', error);
  }
}

// Populate instance dropdown
function populateInstanceDropdown() {
  elements.instanceId.innerHTML = '<option value="">Select instance...</option>';

  state.instances.forEach(instance => {
    const option = document.createElement('option');
    option.value = instance.instance_id;
    option.textContent = instance.name;
    elements.instanceId.appendChild(option);
  });
}

// Load available models
async function loadModels() {
  try {
    const response = await fetch(`${CONFIG.configServiceUrl}/model-config?status=active`);

    if (!response.ok) {
      console.error('Failed to fetch models');
      useFallbackModels();
      return;
    }

    const result = await response.json();
    const allModels = result.data?.configs || result.configs || [];

    // Filter to text-capable models
    state.models = allModels.filter(m =>
      m.capabilities?.text === true
    );

    if (state.models.length === 0) {
      useFallbackModels();
    } else {
      populateModelDropdown();
    }
  } catch (error) {
    console.error('Error loading models:', error);
    useFallbackModels();
  }
}

// Fallback models
function useFallbackModels() {
  state.models = [
    { model_id: 'gpt-4o-mini', provider_id: 'openai', display_name: 'GPT-4o Mini' },
    { model_id: 'gpt-4o', provider_id: 'openai', display_name: 'GPT-4o' },
    { model_id: 'claude-3-5-sonnet-20241022', provider_id: 'anthropic', display_name: 'Claude 3.5 Sonnet' },
    { model_id: 'claude-3-5-haiku-20241022', provider_id: 'anthropic', display_name: 'Claude 3.5 Haiku' },
  ];
  populateModelDropdown();
}

// Populate model dropdown
function populateModelDropdown() {
  elements.model.innerHTML = '';

  // Group by provider
  const byProvider = state.models.reduce((acc, model) => {
    const provider = model.provider_id || 'other';
    if (!acc[provider]) acc[provider] = [];
    acc[provider].push(model);
    return acc;
  }, {});

  for (const [provider, models] of Object.entries(byProvider)) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = provider.toUpperCase();

    models.forEach(model => {
      const option = document.createElement('option');
      option.value = model.model_id;
      option.textContent = model.display_name || model.model_id;
      optgroup.appendChild(option);
    });

    elements.model.appendChild(optgroup);
  }
}

// Update prompt length display
function updatePromptLength() {
  elements.promptLength.textContent = `${elements.prompt.value.length} characters`;
}

// Update temperature display
function updateTempDisplay() {
  elements.tempValue.textContent = elements.temperature.value;
}

// Toggle advanced options
function toggleAdvancedOptions() {
  const isHidden = elements.advancedOptions.classList.contains('hidden');

  if (isHidden) {
    elements.advancedOptions.classList.remove('hidden');
    elements.advancedArrow.innerHTML = '&#9660;';
  } else {
    elements.advancedOptions.classList.add('hidden');
    elements.advancedArrow.innerHTML = '&#9654;';
  }
}

// Handle form submission
async function handleSubmit(e) {
  e.preventDefault();

  if (state.isGenerating) return;

  if (!state.currentApiKey) {
    showStatus('Please login first', 'error');
    return;
  }

  const formData = {
    prompt: elements.prompt.value,
    model: elements.model.value,
    instance_id: elements.instanceId.value,
    options: {},
  };

  // Add optional parameters
  if (elements.systemPrompt.value) {
    formData.options.system_prompt = elements.systemPrompt.value;
  }

  const temp = parseFloat(elements.temperature.value);
  if (!isNaN(temp)) {
    formData.options.temperature = temp;
  }

  const maxTokens = parseInt(elements.maxTokens.value);
  if (!isNaN(maxTokens)) {
    formData.options.max_tokens = maxTokens;
  }

  await generateText(formData);
}

// Generate text
async function generateText(formData) {
  state.isGenerating = true;
  showLoadingState();

  try {
    const response = await fetch(`${CONFIG.textGenUrl}/generate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${state.currentApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(formData),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || `HTTP error ${response.status}`);
    }

    displayResults(result);
    showStatus('Text generated successfully!', 'success');
  } catch (error) {
    showError(error);
  } finally {
    state.isGenerating = false;
    elements.generateBtn.disabled = false;
    elements.generateBtn.textContent = 'Generate Text';
  }
}

// Show loading state
function showLoadingState() {
  elements.noResults.classList.add('hidden');
  elements.resultsDisplay.classList.add('hidden');
  elements.loadingState.classList.remove('hidden');

  elements.generateBtn.disabled = true;
  elements.generateBtn.textContent = 'Generating...';

  const messages = [
    'Contacting AI provider...',
    'Processing your prompt...',
    'Generating response...',
    'Almost there...',
  ];

  let messageIndex = 0;
  const messageInterval = setInterval(() => {
    if (!state.isGenerating) {
      clearInterval(messageInterval);
      return;
    }
    elements.loadingMessage.textContent = messages[messageIndex];
    messageIndex = (messageIndex + 1) % messages.length;
  }, 1500);
}

// Display results
function displayResults(result) {
  elements.noResults.classList.add('hidden');
  elements.loadingState.classList.add('hidden');
  elements.resultsDisplay.classList.remove('hidden');
  elements.resultsDisplay.classList.add('fade-in');

  elements.generatedText.textContent = result.text;
  elements.metaProvider.textContent = result.metadata?.provider || '-';
  elements.metaModel.textContent = result.metadata?.model || '-';
  elements.metaTokens.textContent = result.metadata?.tokens_used || '-';
  elements.metaTime.textContent = result.metadata?.generation_time_ms
    ? `${result.metadata.generation_time_ms}ms`
    : '-';
  elements.metaRequestId.textContent = result.request_id || '-';
}

// Show error
function showError(error) {
  elements.loadingState.classList.add('hidden');

  let errorMessage = 'An error occurred';

  if (typeof error === 'string') {
    errorMessage = error;
  } else if (error.message) {
    errorMessage = error.message;
  }

  // Parse common errors
  if (errorMessage.includes('UNAUTHORIZED') || errorMessage.includes('401')) {
    errorMessage = 'Invalid API key. Please login again.';
    localStorage.removeItem('apiKey');
    checkAuth();
  } else if (errorMessage.includes('MISSING_API_KEY')) {
    errorMessage = 'Provider API key not configured. Please add it in the admin panel.';
  } else if (errorMessage.includes('rate limit') || errorMessage.includes('429')) {
    errorMessage = 'Rate limit exceeded. Please try again later.';
  }

  showStatus(errorMessage, 'error');
  console.error('Generation error:', error);
}

// Show status message
function showStatus(message, type = 'info') {
  elements.statusMessage.textContent = message;
  elements.statusMessage.className = 'mt-4 p-4 rounded-md fade-in';

  if (type === 'success') {
    elements.statusMessage.classList.add('status-success');
  } else if (type === 'error') {
    elements.statusMessage.classList.add('status-error');
  } else {
    elements.statusMessage.classList.add('status-info');
  }

  elements.statusMessage.classList.remove('hidden');

  setTimeout(() => {
    elements.statusMessage.classList.add('hidden');
  }, 5000);
}

// Copy text to clipboard
async function copyText() {
  try {
    await navigator.clipboard.writeText(elements.generatedText.textContent);

    const originalText = elements.copyTextBtn.textContent;
    elements.copyTextBtn.textContent = 'Copied!';

    setTimeout(() => {
      elements.copyTextBtn.textContent = originalText;
    }, 2000);
  } catch (err) {
    console.error('Failed to copy:', err);
    showStatus('Failed to copy text', 'error');
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
