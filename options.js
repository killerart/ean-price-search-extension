document.addEventListener('DOMContentLoaded', function() {
    const apiKeyInput = document.getElementById('apiKey');
    const searchEngineIdInput = document.getElementById('searchEngineId');
    const saveBtn = document.getElementById('saveBtn');
    const testBtn = document.getElementById('testBtn');
    const statusMessage = document.getElementById('statusMessage');
    const statusIndicator = document.getElementById('statusIndicator');
    const statusText = document.getElementById('statusText');

    // Load saved settings
    loadSettings();

    // Event listeners
    saveBtn.addEventListener('click', saveSettings);
    testBtn.addEventListener('click', testConnection);

    // Auto-save on input change
    apiKeyInput.addEventListener('input', checkConfiguration);
    searchEngineIdInput.addEventListener('input', checkConfiguration);

    function loadSettings() {
        chrome.storage.sync.get(['googleApiKey', 'searchEngineId'], function(result) {
            if (result.googleApiKey) {
                apiKeyInput.value = result.googleApiKey;
            }
            if (result.searchEngineId) {
                searchEngineIdInput.value = result.searchEngineId;
            }
            checkConfiguration();
        });
    }

    function saveSettings() {
        const apiKey = apiKeyInput.value.trim();
        const searchEngineId = searchEngineIdInput.value.trim();

        if (!apiKey || !searchEngineId) {
            showMessage('Please fill in both API key and Search Engine ID', 'error');
            return;
        }

        chrome.storage.sync.set({
            googleApiKey: apiKey,
            searchEngineId: searchEngineId
        }, function() {
            if (chrome.runtime.lastError) {
                showMessage('Error saving settings: ' + chrome.runtime.lastError.message, 'error');
            } else {
                showMessage('Settings saved successfully!', 'success');
                checkConfiguration();
            }
        });
    }

    async function testConnection() {
        const apiKey = apiKeyInput.value.trim();
        const searchEngineId = searchEngineIdInput.value.trim();

        if (!apiKey || !searchEngineId) {
            showMessage('Please fill in both API key and Search Engine ID', 'error');
            return;
        }

        // Update status to testing
        updateStatus('testing', 'Testing connection...');
        testBtn.disabled = true;
        testBtn.textContent = 'Testing...';

        try {
            // Perform a simple test search
            const testQuery = 'test';
            const url = new URL('https://www.googleapis.com/customsearch/v1');
            url.searchParams.set('key', apiKey);
            url.searchParams.set('cx', searchEngineId);
            url.searchParams.set('q', testQuery);
            url.searchParams.set('num', '1');

            const response = await fetch(url.toString());

            if (response.ok) {
                const data = await response.json();
                if (data.searchInformation) {
                    updateStatus('connected', 'Connection successful!');
                    showMessage('API connection test successful!', 'success');
                } else {
                    throw new Error('Invalid response format');
                }
            } else {
                const errorData = await response.json().catch(() => ({}));
                const errorMessage = errorData.error?.message || `HTTP ${response.status}: ${response.statusText}`;
                throw new Error(errorMessage);
            }
        } catch (error) {
            updateStatus('disconnected', 'Connection failed');
            showMessage(`Connection test failed: ${error.message}`, 'error');
        } finally {
            testBtn.disabled = false;
            testBtn.textContent = 'Test Connection';
        }
    }

    function checkConfiguration() {
        const apiKey = apiKeyInput.value.trim();
        const searchEngineId = searchEngineIdInput.value.trim();

        if (apiKey && searchEngineId) {
            updateStatus('disconnected', 'Ready to test');
        } else {
            updateStatus('disconnected', 'Not configured');
        }
    }

    function updateStatus(status, text) {
        statusIndicator.className = `status-indicator ${status}`;
        statusText.textContent = text;
    }

    function showMessage(message, type) {
        statusMessage.textContent = message;
        statusMessage.className = `status-message ${type}`;
        statusMessage.style.display = 'block';

        // Hide message after 5 seconds
        setTimeout(() => {
            statusMessage.style.display = 'none';
        }, 5000);
    }

    // Validate API key format
    apiKeyInput.addEventListener('blur', function() {
        const apiKey = this.value.trim();
        if (apiKey && !/^[A-Za-z0-9_-]+$/.test(apiKey)) {
            showMessage('API key format appears invalid. Please check your key.', 'error');
        }
    });

    // Validate Search Engine ID format
    searchEngineIdInput.addEventListener('blur', function() {
        const searchEngineId = this.value.trim();
        if (searchEngineId && !/^[a-z0-9]+:[a-z0-9]+$/i.test(searchEngineId)) {
            showMessage('Search Engine ID should be in format: xxxxxxxxx:xxxxxxxx', 'error');
        }
    });
});
