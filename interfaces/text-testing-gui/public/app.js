// Text Testing GUI Application Logic

// API Configuration
const API_URL = 'https://text.distributedelectrons.com';
const CONFIG_SERVICE_URL = 'https://api.distributedelectrons.com';

// State
const state = {
    isGenerating: false,
    modelsLoaded: false
};

// DOM Elements
const elements = {
    form: document.getElementById('generateForm'),
    apiKey: document.getElementById('apiKey'),
    toggleApiKey: document.getElementById('toggleApiKey'),
    instanceId: document.getElementById('instanceId'),
    prompt: document.getElementById('prompt'),
    promptLength: document.getElementById('promptLength'),
    model: document.getElementById('model'),
    maxTokens: document.getElementById('maxTokens'),
    temperature: document.getElementById('temperature'),
    streamMode: document.getElementById('streamMode'),
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
    metaRequestId: document.getElementById('metaRequestId')
};

// Initialize
function init() {
    setupEventListeners();
    loadSavedSettings();
    loadModelsFromConfigService();
}

// Setup Event Listeners
function setupEventListeners() {
    // Form submission
    elements.form.addEventListener('submit', handleSubmit);

    // API Key toggle
    elements.toggleApiKey.addEventListener('click', toggleApiKeyVisibility);

    // Prompt character count
    elements.prompt.addEventListener('input', updatePromptLength);

    // Advanced options toggle
    elements.toggleAdvanced.addEventListener('click', toggleAdvancedOptions);

    // Copy text button
    elements.copyTextBtn.addEventListener('click', copyText);
}

// Load saved settings from localStorage
function loadSavedSettings() {
    const savedApiKey = localStorage.getItem('textGenApiKey');
    const savedInstanceId = localStorage.getItem('textGenInstanceId');
    const savedModel = localStorage.getItem('textGenModel');

    if (savedApiKey) {
        elements.apiKey.value = savedApiKey;
    }

    if (savedInstanceId) {
        elements.instanceId.value = savedInstanceId;
    }

    if (savedModel) {
        elements.model.value = savedModel;
    }
}

// Load models from Config Service
async function loadModelsFromConfigService() {
    try {
        const response = await fetch(`${CONFIG_SERVICE_URL}/model-config?type=text`);

        if (!response.ok) {
            throw new Error(`Failed to fetch models: ${response.status}`);
        }

        const data = await response.json();

        if (data.models && Array.isArray(data.models) && data.models.length > 0) {
            populateModelDropdown(data.models);
            state.modelsLoaded = true;
            console.log('Successfully loaded models from Config Service:', data.models.length);
        } else {
            throw new Error('No models returned from Config Service');
        }
    } catch (error) {
        console.warn('Failed to load models from Config Service, using hardcoded defaults:', error);
        populateDefaultModels();
    }
}

// Populate model dropdown with dynamic data
function populateModelDropdown(models) {
    // Clear existing options
    elements.model.innerHTML = '';

    // Add models from Config Service
    models.forEach(model => {
        const option = document.createElement('option');
        option.value = model.model_id;

        // Format display name with provider
        const displayName = model.display_name || model.model_id;
        const provider = model.provider ? ` (${model.provider})` : '';
        option.textContent = `${displayName}${provider}`;

        // Store metadata as data attributes
        if (model.provider) {
            option.dataset.provider = model.provider;
        }
        if (model.capabilities) {
            option.dataset.capabilities = JSON.stringify(model.capabilities);
        }
        if (model.max_tokens) {
            option.dataset.maxTokens = model.max_tokens;
        }

        elements.model.appendChild(option);
    });

    // Restore saved selection if it exists
    const savedModel = localStorage.getItem('textGenModel');
    if (savedModel) {
        elements.model.value = savedModel;
    }
}

// Populate with hardcoded default models (fallback)
function populateDefaultModels() {
    elements.model.innerHTML = `
        <option value="gpt-4o-mini">GPT-4o Mini (OpenAI)</option>
        <option value="gpt-4o">GPT-4o (OpenAI)</option>
        <option value="gpt-4-turbo">GPT-4 Turbo (OpenAI)</option>
        <option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet (Anthropic)</option>
        <option value="claude-3-5-haiku-20241022">Claude 3.5 Haiku (Anthropic)</option>
    `;

    // Restore saved selection if it exists
    const savedModel = localStorage.getItem('textGenModel');
    if (savedModel) {
        elements.model.value = savedModel;
    }
}

// Save settings to localStorage
function saveSettings() {
    localStorage.setItem('textGenApiKey', elements.apiKey.value);
    localStorage.setItem('textGenInstanceId', elements.instanceId.value);
    localStorage.setItem('textGenModel', elements.model.value);
}

// Toggle API Key Visibility
function toggleApiKeyVisibility() {
    const type = elements.apiKey.type;
    elements.apiKey.type = type === 'password' ? 'text' : 'password';
}

// Update Prompt Length Counter
function updatePromptLength() {
    const length = elements.prompt.value.length;
    elements.promptLength.textContent = `${length} characters`;
}

// Toggle Advanced Options
function toggleAdvancedOptions() {
    const isHidden = elements.advancedOptions.classList.contains('hidden');

    if (isHidden) {
        elements.advancedOptions.classList.remove('hidden');
        elements.advancedArrow.textContent = '▼';
    } else {
        elements.advancedOptions.classList.add('hidden');
        elements.advancedArrow.textContent = '▶';
    }
}

// Copy Text to Clipboard
function copyText() {
    const text = elements.generatedText.textContent;
    navigator.clipboard.writeText(text);
    elements.copyTextBtn.textContent = '✓ Copied!';
    setTimeout(() => {
        elements.copyTextBtn.textContent = 'Copy Text';
    }, 2000);
}

// Handle Form Submission
async function handleSubmit(e) {
    e.preventDefault();

    if (state.isGenerating) {
        return;
    }

    // Save settings
    saveSettings();

    // Get form data
    const apiKey = elements.apiKey.value.trim();
    const instanceId = elements.instanceId.value;
    const prompt = elements.prompt.value.trim();
    const model = elements.model.value;
    const maxTokens = parseInt(elements.maxTokens.value);
    const temperature = parseFloat(elements.temperature.value);
    const streamMode = elements.streamMode?.checked || false;

    // Validate
    if (!apiKey || !instanceId || !prompt || !model) {
        showError('Please fill in all required fields');
        return;
    }

    // Show loading state
    showLoadingState();

    const startTime = Date.now();

    try {
        if (streamMode) {
            // Streaming mode
            await handleStreamingGeneration(apiKey, instanceId, prompt, model, maxTokens, temperature, startTime);
        } else {
            // Regular mode
            await handleRegularGeneration(apiKey, instanceId, prompt, model, maxTokens, temperature, startTime);
        }
    } catch (error) {
        console.error('Generation error:', error);
        showError(error.message || 'Failed to generate text. Please check your API key and try again.');
        resetToNoResults();
    }
}

// Handle Regular (non-streaming) Generation
async function handleRegularGeneration(apiKey, instanceId, prompt, model, maxTokens, temperature, startTime) {
    const response = await fetch(`${API_URL}/generate`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-Key': apiKey
        },
        body: JSON.stringify({
            prompt,
            model,
            instance_id: instanceId,
            options: {
                max_tokens: maxTokens,
                temperature
            }
        })
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}: ${response.statusText}`);
    }

    // Show results
    displayResults(data);
    showSuccess('Text generated successfully!');
}

// Handle Streaming Generation
async function handleStreamingGeneration(apiKey, instanceId, prompt, model, maxTokens, temperature, startTime) {
    const response = await fetch(`${API_URL}/generate/stream`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-Key': apiKey
        },
        body: JSON.stringify({
            prompt,
            model,
            instance_id: instanceId,
            options: {
                max_tokens: maxTokens,
                temperature
            }
        })
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
    }

    // Prepare for streaming display
    showStreamingResults();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let requestId = '';
    let buffer = '';

    try {
        while (true) {
            const { done, value } = await reader.read();

            if (done) {
                break;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6).trim();

                    if (!data) continue;

                    try {
                        const parsed = JSON.parse(data);

                        if (parsed.error) {
                            throw new Error(parsed.error);
                        }

                        if (parsed.request_id) {
                            requestId = parsed.request_id;
                        }

                        if (parsed.text) {
                            fullText += parsed.text;
                            elements.generatedText.textContent = fullText;
                            // Auto-scroll to bottom
                            elements.generatedText.scrollTop = elements.generatedText.scrollHeight;
                        }

                        if (parsed.done) {
                            // Stream complete
                            const generationTime = Date.now() - startTime;
                            displayStreamingMetadata(model, generationTime, requestId);
                            showSuccess('Text generated successfully!');
                        }
                    } catch (parseError) {
                        // Skip malformed JSON
                        console.warn('Failed to parse SSE data:', data);
                    }
                }
            }
        }
    } finally {
        reader.releaseLock();
        state.isGenerating = false;
        elements.generateBtn.disabled = false;
        elements.generateBtn.textContent = 'Generate Text';
    }
}

// Show streaming results container
function showStreamingResults() {
    state.isGenerating = true;
    elements.loadingState.classList.add('hidden');
    elements.noResults.classList.add('hidden');
    elements.resultsDisplay.classList.remove('hidden');
    elements.generatedText.textContent = '';
    elements.generateBtn.textContent = 'Streaming...';

    // Set initial metadata values
    elements.metaProvider.textContent = 'Streaming...';
    elements.metaModel.textContent = '-';
    elements.metaTokens.textContent = '-';
    elements.metaTime.textContent = '-';
    elements.metaRequestId.textContent = '-';
}

// Display streaming metadata when complete
function displayStreamingMetadata(model, generationTime, requestId) {
    // Extract provider from model name
    const provider = model.includes('gpt') ? 'openai' : model.includes('claude') ? 'anthropic' : 'unknown';

    elements.metaProvider.textContent = provider;
    elements.metaModel.textContent = model;
    elements.metaTokens.textContent = 'N/A (streaming)';
    elements.metaTime.textContent = `${generationTime}ms`;
    elements.metaRequestId.textContent = requestId || '-';
}

// Show Loading State
function showLoadingState() {
    state.isGenerating = true;
    elements.generateBtn.disabled = true;
    elements.generateBtn.textContent = 'Generating...';
    elements.noResults.classList.add('hidden');
    elements.resultsDisplay.classList.add('hidden');
    elements.loadingState.classList.remove('hidden');
    elements.statusMessage.classList.add('hidden');
}

// Reset to No Results
function resetToNoResults() {
    state.isGenerating = false;
    elements.generateBtn.disabled = false;
    elements.generateBtn.textContent = 'Generate Text';
    elements.loadingState.classList.add('hidden');
    elements.resultsDisplay.classList.add('hidden');
    elements.noResults.classList.remove('hidden');
}

// Display Results
function displayResults(data) {
    state.isGenerating = false;
    elements.generateBtn.disabled = false;
    elements.generateBtn.textContent = 'Generate Text';

    // Hide loading, show results
    elements.loadingState.classList.add('hidden');
    elements.noResults.classList.add('hidden');
    elements.resultsDisplay.classList.remove('hidden');

    // Set text
    elements.generatedText.textContent = data.text;

    // Set metadata
    elements.metaProvider.textContent = data.metadata.provider;
    elements.metaModel.textContent = data.metadata.model;
    elements.metaTokens.textContent = data.metadata.tokens_used.toLocaleString();
    elements.metaTime.textContent = `${data.metadata.generation_time_ms}ms`;
    elements.metaRequestId.textContent = data.request_id;
}

// Show Error Message
function showError(message) {
    elements.statusMessage.className = 'mt-4 p-4 rounded-md bg-red-50 border border-red-200';
    elements.statusMessage.innerHTML = `
        <p class="text-sm font-medium text-red-800">${message}</p>
    `;
    elements.statusMessage.classList.remove('hidden');

    // Auto-hide after 5 seconds
    setTimeout(() => {
        elements.statusMessage.classList.add('hidden');
    }, 5000);
}

// Show Success Message
function showSuccess(message) {
    elements.statusMessage.className = 'mt-4 p-4 rounded-md bg-green-50 border border-green-200';
    elements.statusMessage.innerHTML = `
        <p class="text-sm font-medium text-green-800">${message}</p>
    `;
    elements.statusMessage.classList.remove('hidden');

    // Auto-hide after 3 seconds
    setTimeout(() => {
        elements.statusMessage.classList.add('hidden');
    }, 3000);
}

// Start the application
init();
