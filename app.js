// DOM Elements
const settingsToggle = document.getElementById('settingsToggle');
const settingsContent = document.getElementById('settingsContent');
const apiKeyInput = document.getElementById('apiKey');
const modelSelect = document.getElementById('modelSelect');
const saveSettingsBtn = document.getElementById('saveSettings');
const startCameraBtn = document.getElementById('startCamera');
const captureBtn = document.getElementById('captureBtn');
const uploadBtn = document.getElementById('uploadBtn');
const fileInput = document.getElementById('fileInput');
const videoElement = document.getElementById('videoElement');
const captureCanvas = document.getElementById('captureCanvas');
const resultsSection = document.getElementById('resultsSection');
const resultCanvas = document.getElementById('resultCanvas');
const loadingOverlay = document.getElementById('loadingOverlay');
const resetBtn = document.getElementById('resetBtn');
const summaryContent = document.getElementById('summaryContent');

// State
let stream = null;
let settings = {
    apiKey: '',
    model: 'nvidia/llava-1.6-34b'
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    setupEventListeners();
});

// Load settings from localStorage
function loadSettings() {
    const saved = localStorage.getItem('wastewise-settings');
    if (saved) {
        settings = JSON.parse(saved);
        apiKeyInput.value = settings.apiKey;
        modelSelect.value = settings.model;
    }
}

// Save settings to localStorage
function saveSettings() {
    settings.apiKey = apiKeyInput.value;
    settings.model = modelSelect.value;
    localStorage.setItem('wastewise-settings', JSON.stringify(settings));
    
    // Show save confirmation
    const originalText = saveSettingsBtn.textContent;
    saveSettingsBtn.textContent = '✓ Saved!';
    saveSettingsBtn.style.background = '#27ae60';
    setTimeout(() => {
        saveSettingsBtn.textContent = originalText;
        saveSettingsBtn.style.background = '';
        settingsContent.classList.remove('active');
    }, 1000);
}

// Setup event listeners
function setupEventListeners() {
    settingsToggle.addEventListener('click', () => {
        settingsContent.classList.toggle('active');
    });

    saveSettingsBtn.addEventListener('click', saveSettings);
    
    const verifyApiBtn = document.getElementById('verifyApiBtn');
    if (verifyApiBtn) {
        verifyApiBtn.addEventListener('click', verifyApiKey);
    }

    startCameraBtn.addEventListener('click', startCamera);
    captureBtn.addEventListener('click', captureImage);
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileUpload);
    resetBtn.addEventListener('click', resetApp);
}

// Verify API Key via proxy
async function verifyApiKey() {
    const apiKey = apiKeyInput.value.trim();
    const model = modelSelect.value.trim();
    
    if (!apiKey) {
        showErrorMessage('Please enter an API key first.');
        return;
    }
    
    const verifyBtn = document.getElementById('verifyApiBtn');
    verifyBtn.textContent = 'Verifying...';
    verifyBtn.disabled = true;
    
    try {
        // Use proxy to verify API key and fetch models
        const modelsResponse = await fetch('/api/proxy/models', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ apiKey: apiKey })
        });
        
        if (!modelsResponse.ok) {
            const errorData = await modelsResponse.json().catch(() => ({}));
            if (modelsResponse.status === 401) {
                showErrorMessage('Invalid API key. Please check your key at build.nvidia.com/settings/api-keys');
            } else if (modelsResponse.status === 404) {
                showErrorMessage('Server not running. Please start the server with: npm start');
            } else {
                showErrorMessage(`Error: ${modelsResponse.status} - ${errorData.error || 'Unknown error'}`);
            }
            return;
        }
        
        const modelsData = await modelsResponse.json();
        const models = modelsData.data || [];
        
        // Find vision-capable models
        const visionModels = models.filter(m => 
            m.id.includes('llava') || 
            m.id.includes('neva') || 
            m.id.includes('vila') ||
            m.id.includes('vision') ||
            m.id.includes('owl')
        );
        
        if (visionModels.length > 0) {
            const modelList = visionModels.map(m => m.id).join('\n');
            showSuccessMessage(`API key is valid!\n\nAvailable vision models:\n${modelList}`);
            
            // Auto-select first vision model if current model is not in list
            const currentModelValid = visionModels.some(m => m.id === model);
            if (!currentModelValid && visionModels.length > 0) {
                modelSelect.value = visionModels[0].id;
            }
        } else {
            // Show all available models
            const allModels = models.map(m => m.id).join('\n');
            showSuccessMessage(`API key is valid!\n\nAvailable models:\n${allModels}\n\nNote: Some models may not support vision/image analysis.`);
        }
    } catch (error) {
        console.error('Verification error:', error);
        showErrorMessage(`Error verifying API key: ${error.message}\n\nMake sure the server is running (npm start).`);
    } finally {
        verifyBtn.textContent = 'Verify API Key';
        verifyBtn.disabled = false;
    }
}

// Start camera
async function startCamera() {
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' }
        });
        videoElement.srcObject = stream;
        startCameraBtn.textContent = 'Stop Camera';
        startCameraBtn.onclick = stopCamera;
        captureBtn.disabled = false;
    } catch (err) {
        showErrorMessage('Unable to access camera. Please ensure camera permissions are granted.');
        console.error('Camera error:', err);
    }
}

// Stop camera
function stopCamera() {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }
    videoElement.srcObject = null;
    startCameraBtn.textContent = 'Start Camera';
    startCameraBtn.onclick = startCamera;
    captureBtn.disabled = true;
}

// Capture image from camera
function captureImage() {
    captureCanvas.width = videoElement.videoWidth;
    captureCanvas.height = videoElement.videoHeight;
    const ctx = captureCanvas.getContext('2d');
    ctx.drawImage(videoElement, 0, 0);

    const imageData = captureCanvas.toDataURL('image/jpeg', 0.9);
    processImage(imageData);
}

// Handle file upload
function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        processImage(event.target.result);
    };
    reader.readAsDataURL(file);
    fileInput.value = '';
}

// Process image with NVIDIA NIM API
async function processImage(imageData) {
    if (!settings.apiKey) {
        showErrorMessage('Please set your NVIDIA NIM API key in settings.');
        return;
    }

    // Clear any previous error/success messages
    document.querySelectorAll('.error-message, .success-message').forEach(el => el.remove());
    
    // Show results section
    resultsSection.classList.add('active');
    loadingOverlay.classList.remove('hidden');

    // Draw original image on result canvas
    const img = new Image();
    img.onload = async () => {
        resultCanvas.width = img.width;
        resultCanvas.height = img.height;
        const ctx = resultCanvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        // Call NVIDIA NIM API for classification
        try {
            const classifications = await classifyWaste(imageData);
            highlightWaste(classifications, ctx, img.width, img.height);
            updateSummary(classifications);
        } catch (err) {
            console.error('Classification error:', err);
            // Show detailed error message in the UI instead of alert
            showErrorMessage(err.message);
            loadingOverlay.classList.add('hidden');
        }
    };
    img.src = imageData;
}

// Show error message in the UI
function showErrorMessage(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    const errorContent = document.createElement('div');
    errorContent.style.cssText = 'padding: 20px; border: 2px solid #e74c3c; background: #fff3f3; margin: 20px 0;';
    
    const title = document.createElement('h3');
    title.style.cssText = 'color: #c0392b; margin-bottom: 10px;';
    title.textContent = '⚠ Error';
    
    const msg = document.createElement('p');
    msg.style.color = '#333';
    msg.textContent = message;
    
    const hint = document.createElement('p');
    hint.style.cssText = 'color: #666; margin-top: 10px; font-size: 0.9em;';
    const hintStrong = document.createElement('strong');
    hintStrong.textContent = 'Common causes:';
    hint.appendChild(hintStrong);
    hint.style.whiteSpace = 'pre-line';
    hint.appendChild(document.createTextNode('\n• API key format: Should start with "nvapi-"\n• Server not running: Start with "npm start"\n• Invalid model name: Check available models at build.nvidia.com'));
    
    errorContent.appendChild(title);
    errorContent.appendChild(msg);
    errorContent.appendChild(hint);
    errorDiv.appendChild(errorContent);
    
    // Remove any existing messages
    document.querySelectorAll('.error-message, .success-message').forEach(el => el.remove());
    
    // Insert before results section
    resultsSection.parentNode.insertBefore(errorDiv, resultsSection);
}

// Show success message in the UI
function showSuccessMessage(message) {
    const successDiv = document.createElement('div');
    successDiv.className = 'success-message';
    const successContent = document.createElement('div');
    successContent.style.cssText = 'padding: 20px; border: 2px solid #27ae60; background: #f0fff4; margin: 20px 0;';
    
    const title = document.createElement('h3');
    title.style.cssText = 'color: #27ae60; margin-bottom: 10px;';
    title.textContent = '✓ Success';
    
    const msg = document.createElement('p');
    msg.style.cssText = 'color: #333; white-space: pre-line;';
    msg.textContent = message;
    
    successContent.appendChild(title);
    successContent.appendChild(msg);
    successDiv.appendChild(successContent);
    
    // Remove any existing messages
    document.querySelectorAll('.error-message, .success-message').forEach(el => el.remove());
    
    // Insert before results section
    resultsSection.parentNode.insertBefore(successDiv, resultsSection);
    
    // Auto-remove after 8 seconds
    setTimeout(() => successDiv.remove(), 8000);
}

// Call NVIDIA NIM API via proxy server
async function classifyWaste(imageData) {
    const base64Image = imageData.split(',')[1];

    // Always use proxy server to avoid CORS issues
    const response = await fetch('/api/proxy', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            apiKey: settings.apiKey,
            model: settings.model,
            imageData: base64Image
        })
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.error || 'Unknown error';
        
        // Provide more specific error messages
        if (response.status === 401) {
            throw new Error('Invalid API key. Please check your NVIDIA NIM API key in settings.');
        } else if (response.status === 404) {
            throw new Error('Server not running. Please start the server with: npm start');
        } else if (response.status === 400) {
            throw new Error(`Invalid request: ${errorMsg}`);
        } else {
            throw new Error(`API error (${response.status}): ${errorMsg}`);
        }
    }

    const data = await response.json();
    
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        throw new Error('Invalid response format from NVIDIA API');
    }
    
    const content = data.choices[0].message.content;
    console.log('Raw API response:', content);

    // Parse JSON from response with robust parsing
    try {
        // Step 1: Strip markdown code blocks if present
        let cleanContent = content;
        const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
        if (codeBlockMatch) {
            cleanContent = codeBlockMatch[1].trim();
            console.log('Extracted from code block:', cleanContent);
        }

        // Step 2: Find the outermost JSON object using bracket matching
        let jsonStr = null;
        const firstBrace = cleanContent.indexOf('{');
        if (firstBrace !== -1) {
            let depth = 0;
            let lastBrace = -1;
            for (let i = firstBrace; i < cleanContent.length; i++) {
                if (cleanContent[i] === '{') depth++;
                if (cleanContent[i] === '}') {
                    depth--;
                    if (depth === 0) {
                        lastBrace = i;
                        break;
                    }
                }
            }
            if (lastBrace !== -1) {
                jsonStr = cleanContent.substring(firstBrace, lastBrace + 1);
            }
        }

        if (!jsonStr) {
            console.error('No JSON found in response');
            return { items: [] };
        }

        console.log('Parsed JSON string:', jsonStr);
        const parsed = JSON.parse(jsonStr);
        console.log('Parsed object:', parsed);

        // Validate and sanitize the items
        if (parsed.items && Array.isArray(parsed.items)) {
            parsed.items = parsed.items.filter(item => {
                // Validate bbox format - be more lenient
                if (!item.bbox || !Array.isArray(item.bbox) || item.bbox.length !== 4) return false;
                // Clamp values to 0-100 range
                item.bbox = item.bbox.map(v => {
                    const num = Number(v);
                    if (isNaN(num)) return 0;
                    return Math.max(0, Math.min(100, num));
                });
                // Ensure minimum size
                if (item.bbox[2] < 1) item.bbox[2] = 1;
                if (item.bbox[3] < 1) item.bbox[3] = 1;
                // Ensure valid category
                if (!['recycling', 'general', 'organic'].includes(item.category)) {
                    item.category = 'general';
                }
                // Ensure name exists
                if (!item.name) item.name = 'Unknown item';
                return true;
            });
        }

        console.log('Validated items:', parsed.items);
        return parsed;
    } catch (parseError) {
        console.error('JSON parse error:', parseError);
        console.error('Content that failed to parse:', content);
    }

    return { items: [] };
}

// Highlight waste items on canvas
function highlightWaste(classifications, ctx, width, height) {
    const colors = {
        recycling: { fill: 'rgba(52, 152, 219, 0.3)', stroke: '#3498db' },
        general: { fill: 'rgba(44, 62, 80, 0.3)', stroke: '#2c3e50' },
        organic: { fill: 'rgba(39, 174, 96, 0.3)', stroke: '#27ae60' }
    };

    classifications.items.forEach(item => {
        const [x, y, w, h] = item.bbox;
        const xPx = (x / 100) * width;
        const yPx = (y / 100) * height;
        const wPx = (w / 100) * width;
        const hPx = (h / 100) * height;

        const color = colors[item.category] || colors.general;

        // Draw filled rectangle
        ctx.fillStyle = color.fill;
        ctx.fillRect(xPx, yPx, wPx, hPx);

        // Draw border
        ctx.strokeStyle = color.stroke;
        ctx.lineWidth = 3;
        ctx.strokeRect(xPx, yPx, wPx, hPx);

        // Draw label (position below if too close to top)
        ctx.fillStyle = color.stroke;
        ctx.font = 'bold 14px Arial';
        const labelY = yPx < 25 ? yPx + hPx + 18 : yPx - 5;
        ctx.fillText(item.name, xPx + 5, labelY);
    });

    loadingOverlay.classList.add('hidden');
}

// Update summary section
function updateSummary(classifications) {
    const counts = { recycling: 0, general: 0, organic: 0 };

    classifications.items.forEach(item => {
        if (counts[item.category] !== undefined) {
            counts[item.category]++;
        }
    });

    summaryContent.innerHTML = `
        <div class="summary-item" style="border-left: 4px solid #3498db;">
            <h4>Recycling</h4>
            <p>${counts.recycling} items</p>
        </div>
        <div class="summary-item" style="border-left: 4px solid #2c3e50;">
            <h4>General Waste</h4>
            <p>${counts.general} items</p>
        </div>
        <div class="summary-item" style="border-left: 4px solid #27ae60;">
            <h4>Organic</h4>
            <p>${counts.organic} items</p>
        </div>
    `;
}

// Reset application
function resetApp() {
    resultsSection.classList.remove('active');
    document.querySelectorAll('.error-message, .success-message').forEach(el => el.remove());
    stopCamera();
}
