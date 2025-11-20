// Testing GUI Application Logic

// State
const state = {
    useMockApi: true,
    isGenerating: false
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
    aspectRatio: document.getElementById('aspectRatio'),
    style: document.getElementById('style'),
    generateBtn: document.getElementById('generateBtn'),
    statusMessage: document.getElementById('statusMessage'),
    toggleAdvanced: document.getElementById('toggleAdvanced'),
    advancedArrow: document.getElementById('advancedArrow'),
    advancedOptions: document.getElementById('advancedOptions'),
    noResults: document.getElementById('noResults'),
    loadingState: document.getElementById('loadingState'),
    loadingMessage: document.getElementById('loadingMessage'),
    resultsDisplay: document.getElementById('resultsDisplay'),
    generatedImage: document.getElementById('generatedImage'),
    imageUrl: document.getElementById('imageUrl'),
    copyUrlBtn: document.getElementById('copyUrlBtn'),
    r2Path: document.getElementById('r2Path'),
    metaProvider: document.getElementById('metaProvider'),
    metaModel: document.getElementById('metaModel'),
    metaDimensions: document.getElementById('metaDimensions'),
    metaTime: document.getElementById('metaTime'),
    metaRequestId: document.getElementById('metaRequestId'),
    useMockApi: document.getElementById('useMockApi')
};

// Initialize
function init() {
    setupEventListeners();
    loadSavedSettings();
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

    // Copy URL button
    elements.copyUrlBtn.addEventListener('click', copyUrl);

    // Mock API toggle
    elements.useMockApi.addEventListener('change', handleMockApiToggle);

    // Image click to open in new tab
    elements.generatedImage.addEventListener('click', () => {
        if (elements.generatedImage.src) {
            window.open(elements.generatedImage.src, '_blank');
        }
    });
}

// Load saved settings from localStorage
function loadSavedSettings() {
    const savedApiKey = localStorage.getItem('apiKey');
    const savedInstanceId = localStorage.getItem('instanceId');

    if (savedApiKey) {
        elements.apiKey.value = savedApiKey;
    }

    if (savedInstanceId) {
        elements.instanceId.value = savedInstanceId;
    }
}

// Save settings to localStorage
function saveSettings() {
    localStorage.setItem('apiKey', elements.apiKey.value);
    localStorage.setItem('instanceId', elements.instanceId.value);
}

// Toggle API Key Visibility
function toggleApiKeyVisibility() {
    const type = elements.apiKey.type;
    elements.apiKey.type = type === 'password' ? 'text' : 'password';
}

// Update Prompt Length
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

// Handle Mock API Toggle
function handleMockApiToggle() {
    state.useMockApi = elements.useMockApi.checked;

    if (state.useMockApi) {
        showStatus('Using mock API for testing', 'info');
    } else {
        showStatus('Using production API', 'info');
    }
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
    const formData = {
        apiKey: elements.apiKey.value,
        instanceId: elements.instanceId.value,
        prompt: elements.prompt.value,
        model: elements.model.value || undefined,
        options: {}
    };

    // Add advanced options if set
    if (elements.aspectRatio.value) {
        formData.options.aspect_ratio = elements.aspectRatio.value;
    }

    if (elements.style.value) {
        formData.options.style = elements.style.value;
    }

    // Generate image
    await generateImage(formData);
}

// Generate Image
async function generateImage(formData) {
    state.isGenerating = true;

    // Update UI to loading state
    showLoadingState();

    try {
        const result = state.useMockApi
            ? await generateImageMock(formData)
            : await generateImageReal(formData);

        // Display results
        displayResults(result);
        showStatus('Image generated successfully!', 'success');

    } catch (error) {
        showError(error);
    } finally {
        state.isGenerating = false;
        elements.generateBtn.disabled = false;
        elements.generateBtn.classList.remove('btn-loading');
    }
}

// Generate Image - Real API
async function generateImageReal(formData) {
    const baseUrl = `https://image-gen-${formData.instanceId}.workers.dev`;

    const response = await fetch(`${baseUrl}/generate`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${formData.apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            prompt: formData.prompt,
            instance_id: formData.instanceId,
            model: formData.model,
            options: formData.options
        })
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }

    return await response.json();
}

// Generate Image - Mock API
async function generateImageMock(formData) {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 2000));

    // Simulate occasional errors for testing
    if (Math.random() < 0.1) {
        throw new Error('Mock error: Rate limit exceeded');
    }

    // Return mock data
    const requestId = 'req_' + Math.random().toString(36).substring(2, 15);
    const imageId = Math.random().toString(36).substring(2, 15);

    return {
        success: true,
        image_url: `https://picsum.photos/seed/${imageId}/1920/1080`,
        r2_path: `${formData.instanceId}/images/2025/11/20/${imageId}.png`,
        metadata: {
            provider: 'ideogram',
            model: formData.model || 'ideogram-v2',
            dimensions: formData.options.aspect_ratio === '16:9' ? '1920x1080' : '1024x1024',
            format: 'png',
            generation_time_ms: Math.floor(2000 + Math.random() * 3000)
        },
        request_id: requestId,
        timestamp: new Date().toISOString()
    };
}

// Show Loading State
function showLoadingState() {
    elements.noResults.classList.add('hidden');
    elements.resultsDisplay.classList.add('hidden');
    elements.loadingState.classList.remove('hidden');

    elements.generateBtn.disabled = true;
    elements.generateBtn.classList.add('btn-loading');
    elements.generateBtn.textContent = 'Generating...';

    // Random loading messages
    const messages = [
        'Contacting AI provider...',
        'Processing your prompt...',
        'Generating image...',
        'Almost there...'
    ];

    let messageIndex = 0;
    const messageInterval = setInterval(() => {
        if (!state.isGenerating) {
            clearInterval(messageInterval);
            elements.generateBtn.textContent = 'Generate Image';
            return;
        }

        elements.loadingMessage.textContent = messages[messageIndex];
        messageIndex = (messageIndex + 1) % messages.length;
    }, 1500);
}

// Display Results
function displayResults(result) {
    // Hide other states
    elements.noResults.classList.add('hidden');
    elements.loadingState.classList.add('hidden');

    // Show results
    elements.resultsDisplay.classList.remove('hidden');
    elements.resultsDisplay.classList.add('fade-in');

    // Set image
    elements.generatedImage.src = result.image_url;
    elements.generatedImage.alt = 'Generated image';

    // Set URLs
    elements.imageUrl.value = result.image_url;
    elements.r2Path.value = result.r2_path;

    // Set metadata
    elements.metaProvider.textContent = result.metadata.provider;
    elements.metaModel.textContent = result.metadata.model;
    elements.metaDimensions.textContent = result.metadata.dimensions;
    elements.metaTime.textContent = `${result.metadata.generation_time_ms}ms`;
    elements.metaRequestId.textContent = result.request_id;
}

// Show Error
function showError(error) {
    elements.loadingState.classList.add('hidden');

    let errorMessage = 'An error occurred';
    let errorCode = null;

    if (typeof error === 'string') {
        errorMessage = error;
    } else if (error.message) {
        errorMessage = error.message;
    }

    // Parse common errors
    if (errorMessage.includes('rate limit')) {
        errorCode = 'RATE_LIMIT_EXCEEDED';
        errorMessage = 'Rate limit exceeded. Please try again in a few moments.';
    } else if (errorMessage.includes('401') || errorMessage.includes('Unauthorized')) {
        errorCode = 'UNAUTHORIZED';
        errorMessage = 'Invalid API key. Please check your credentials.';
    } else if (errorMessage.includes('404') || errorMessage.includes('not found')) {
        errorCode = 'NOT_FOUND';
        errorMessage = 'Instance not found. Please check your instance ID.';
    }

    showStatus(errorMessage, 'error');

    console.error('Generation error:', error);
}

// Show Status Message
function showStatus(message, type = 'info') {
    elements.statusMessage.textContent = message;
    elements.statusMessage.className = 'p-4 rounded-md fade-in';

    if (type === 'success') {
        elements.statusMessage.classList.add('status-success');
    } else if (type === 'error') {
        elements.statusMessage.classList.add('status-error');
    } else {
        elements.statusMessage.classList.add('status-info');
    }

    elements.statusMessage.classList.remove('hidden');

    // Auto-hide after 5 seconds
    setTimeout(() => {
        elements.statusMessage.classList.add('hidden');
    }, 5000);
}

// Copy URL to Clipboard
async function copyUrl() {
    try {
        await navigator.clipboard.writeText(elements.imageUrl.value);

        // Visual feedback
        const originalText = elements.copyUrlBtn.textContent;
        elements.copyUrlBtn.textContent = 'Copied!';
        elements.copyUrlBtn.classList.add('copied');

        setTimeout(() => {
            elements.copyUrlBtn.textContent = originalText;
            elements.copyUrlBtn.classList.remove('copied');
        }, 2000);

    } catch (err) {
        console.error('Failed to copy:', err);
        showStatus('Failed to copy URL', 'error');
    }
}

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
