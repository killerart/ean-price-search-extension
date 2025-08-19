document.addEventListener('DOMContentLoaded', function() {
    const eanInput = document.getElementById('eanInput');
    const searchBtn = document.getElementById('searchBtn');
    const loading = document.getElementById('loading');
    const results = document.getElementById('results');
    const settingsLink = document.getElementById('settingsLink');
    const clearResultsBtn = document.getElementById('clearResultsBtn');
    const clearResultsContainer = document.getElementById('clearResultsContainer');

    // Load saved EAN code and search results
    chrome.storage.local.get(['lastEAN', 'lastSearchResults'], function(result) {
        if (result.lastEAN) {
            eanInput.value = result.lastEAN;
        }
        if (result.lastSearchResults) {
            displayResults(result.lastSearchResults);
        }
    });

    // Focus on input when popup opens
    eanInput.focus();

    // Handle Enter key press
    eanInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            searchPrices();
        }
    });

    // Handle search button click
    searchBtn.addEventListener('click', searchPrices);

    // Handle settings link click
    settingsLink.addEventListener('click', function(e) {
        e.preventDefault();
        chrome.runtime.openOptionsPage();
    });

    // Handle clear results button click
    clearResultsBtn.addEventListener('click', function() {
        clearResults();
    });

    // Validate EAN input
    eanInput.addEventListener('input', function() {
        const ean = this.value.trim();
        const isValid = validateEAN(ean);

        if (ean.length > 0 && !isValid) {
            this.style.borderColor = '#ff6b6b';
        } else {
            this.style.borderColor = '';
        }

        searchBtn.disabled = !isValid || ean.length === 0;
    });

    function validateEAN(ean) {
        // Remove any non-digit characters
        ean = ean.replace(/\D/g, '');

        // Check if it's 8, 12, or 13 digits
        if (![8, 12, 13].includes(ean.length)) {
            return false;
        }

        // Validate checksum for EAN-13
        if (ean.length === 13) {
            let sum = 0;
            for (let i = 0; i < 12; i++) {
                sum += parseInt(ean[i]) * (i % 2 === 0 ? 1 : 3);
            }
            const checkDigit = (10 - (sum % 10)) % 10;
            return checkDigit === parseInt(ean[12]);
        }

        return true; // For EAN-8 and UPC-A, accept without detailed validation
    }

    async function searchPrices() {
        const ean = eanInput.value.trim();

        if (!validateEAN(ean)) {
            showError('Please enter a valid EAN code');
            return;
        }

        // Save the EAN code
        chrome.storage.local.set({ lastEAN: ean });

        // Show loading state
        loading.style.display = 'block';
        // Don't clear results immediately - only clear them when we have new results
        searchBtn.disabled = true;

        try {
            // Check if API key is configured
            const apiSettings = await chrome.storage.sync.get(['googleApiKey', 'searchEngineId']);

            if (!apiSettings.googleApiKey || !apiSettings.searchEngineId) {
                throw new Error('Google API key and Search Engine ID must be configured in settings');
            }

            // Update loading message
            loading.querySelector('p').textContent = 'Searching and analyzing prices...';

            // Send message to background script to perform search
            const response = await chrome.runtime.sendMessage({
                action: 'searchPrices',
                ean: ean,
                apiKey: apiSettings.googleApiKey,
                searchEngineId: apiSettings.searchEngineId
            });

            if (response.error) {
                throw new Error(response.error);
            }

            displayResults(response.results);

        } catch (error) {
            showError(error.message);
            // Clear saved results on error
            chrome.storage.local.remove('lastSearchResults');
        } finally {
            loading.style.display = 'none';
            loading.querySelector('p').textContent = 'Searching for prices...';
            searchBtn.disabled = false;
        }
    }

    function displayResults(searchResults) {
        results.innerHTML = '';

        if (!searchResults || searchResults.length === 0) {
            results.innerHTML = '<div class="error">No price information found for this EAN code.</div>';
            chrome.storage.local.remove('lastSearchResults');
            clearResultsContainer.style.display = 'none';
            return;
        }

        // Save search results for persistence
        chrome.storage.local.set({ lastSearchResults: searchResults });

        // Show clear results button
        clearResultsContainer.style.display = 'block';

        searchResults.forEach(item => {
            const resultDiv = document.createElement('div');
            resultDiv.className = 'result-item';

            const title = item.title || 'Unknown Product';
            // Use the enhanced price if available, otherwise fall back to snippet extraction
            const price = item.extractedPrice || extractPrice(item.snippet) || 'Price not found';
            const link = item.link || '#';

            // Add a tooltip for price source
            let sourceInfo = '';
            let sourceTitle = '';
            if (item.priceSource === 'webpage') {
                sourceInfo = ' 🌐';
                sourceTitle = 'Price extracted from website';
            } else if (item.priceSource === 'snippet') {
                sourceInfo = ' 📄';
                sourceTitle = 'Price found in search snippet';
            }

            resultDiv.innerHTML = `
                <div class="result-title">${escapeHtml(title)}</div>
                <div class="result-price">
                    <span>${escapeHtml(price)}</span>
                    ${sourceInfo ? `<span class="price-source-indicator" title="${sourceTitle}">${sourceInfo}</span>` : ''}
                </div>
                <a href="${escapeHtml(link)}" target="_blank" class="result-link">View on ${getDomain(link)}</a>
            `;

            results.appendChild(resultDiv);
        });
    }

    function extractPrice(text) {
        if (!text) return null;

        // Common price patterns
        const patterns = [
            /\$\s*\d+[\.,]\d{2}/g,        // $10.99, $10,99, $ 10.99, $ 10,99
            /\d+[\.,]\d{2}\s*\$/g,       // 10.99$, 10,99 $
            /€\s*\d+[\.,]\d{2}/g,        // €10.99, €10,99, € 10.99, € 10,99
            /\d+[\.,]\d{2}\s*€/g,        // 10.99€, 10,99 €
            /£\s*\d+[\.,]\d{2}/g,        // £10.99, £10,99, £ 10.99, £ 10,99
            /\d+[\.,]\d{2}\s*£/g,        // 10.99£, 10,99 £
            /\d+[\.,]\d{2}\s*USD/gi,     // 10.99 USD
            /\d+[\.,]\d{2}\s*EUR/gi,     // 10.99 EUR
            /\d+[\.,]\d{2}\s*GBP/gi      // 10.99 GBP
        ];

        for (const pattern of patterns) {
            const matches = text.match(pattern);
            if (matches) {
                return matches[0];
            }
        }

        return null;
    }

    function getDomain(url) {
        try {
            const domain = new URL(url).hostname;
            return domain.replace('www.', '');
        } catch {
            return 'External Site';
        }
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function showError(message) {
        results.innerHTML = `<div class="error">${escapeHtml(message)}</div>`;
        // Clear saved results when showing error
        chrome.storage.local.remove('lastSearchResults');
        clearResultsContainer.style.display = 'none';
    }

    function clearResults() {
        results.innerHTML = '';
        chrome.storage.local.remove('lastSearchResults');
        clearResultsContainer.style.display = 'none';
    }
});
