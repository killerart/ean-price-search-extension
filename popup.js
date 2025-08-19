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

        // Common price patterns for various currencies
        const patterns = [
            // USD - US Dollar
            /\$\s*\d+[\.,]\d{2}/g,        // $10.99, $10,99, $ 10.99, $ 10,99
            /\d+[\.,]\d{2}\s*\$/g,       // 10.99$, 10,99 $
            /\d+[\.,]\d{2}\s*USD/gi,     // 10.99 USD

            // EUR - Euro
            /€\s*\d+[\.,]\d{2}/g,        // €10.99, €10,99, € 10.99, € 10,99
            /\d+[\.,]\d{2}\s*€/g,        // 10.99€, 10,99 €
            /\d+[\.,]\d{2}\s*EUR/gi,     // 10.99 EUR

            // GBP - British Pound
            /£\s*\d+[\.,]\d{2}/g,        // £10.99, £10,99, £ 10.99, £ 10,99
            /\d+[\.,]\d{2}\s*£/g,        // 10.99£, 10,99 £
            /\d+[\.,]\d{2}\s*GBP/gi,     // 10.99 GBP

            // JPY - Japanese Yen
            /¥\s*\d+/g,                  // ¥1000, ¥ 1000
            /\d+\s*¥/g,                  // 1000¥, 1000 ¥
            /\d+\s*JPY/gi,               // 1000 JPY
            /\d+\s*YEN/gi,               // 1000 YEN

            // CAD - Canadian Dollar
            /C\$\s*\d+[\.,]\d{2}/g,      // C$10.99, C$ 10.99
            /\d+[\.,]\d{2}\s*CAD/gi,     // 10.99 CAD

            // AUD - Australian Dollar
            /A\$\s*\d+[\.,]\d{2}/g,      // A$10.99, A$ 10.99
            /\d+[\.,]\d{2}\s*AUD/gi,     // 10.99 AUD

            // CHF - Swiss Franc
            /CHF\s*\d+[\.,]\d{2}/g,      // CHF 10.99, CHF10.99
            /\d+[\.,]\d{2}\s*CHF/gi,     // 10.99 CHF

            // SEK - Swedish Krona
            /\d+[\.,]\d{2}\s*SEK/gi,     // 10.99 SEK
            /\d+[\.,]\d{2}\s*kr/gi,      // 10.99 kr (Swedish)

            // NOK - Norwegian Krone
            /\d+[\.,]\d{2}\s*NOK/gi,     // 10.99 NOK

            // DKK - Danish Krone
            /\d+[\.,]\d{2}\s*DKK/gi,     // 10.99 DKK

            // CNY - Chinese Yuan
            /¥\s*\d+[\.,]\d{2}/g,        // ¥10.99 (Chinese Yuan)
            /\d+[\.,]\d{2}\s*CNY/gi,     // 10.99 CNY
            /\d+[\.,]\d{2}\s*RMB/gi,     // 10.99 RMB

            // INR - Indian Rupee
            /₹\s*\d+[\.,]\d{2}/g,        // ₹10.99, ₹ 10.99
            /\d+[\.,]\d{2}\s*₹/g,        // 10.99₹, 10.99 ₹
            /\d+[\.,]\d{2}\s*INR/gi,     // 10.99 INR
            /Rs\.?\s*\d+[\.,]\d{2}/g,    // Rs.10.99, Rs 10.99

            // KRW - South Korean Won
            /₩\s*\d+/g,                  // ₩1000, ₩ 1000
            /\d+\s*₩/g,                  // 1000₩, 1000 ₩
            /\d+\s*KRW/gi,               // 1000 KRW

            // SGD - Singapore Dollar
            /S\$\s*\d+[\.,]\d{2}/g,      // S$10.99, S$ 10.99
            /\d+[\.,]\d{2}\s*SGD/gi,     // 10.99 SGD

            // HKD - Hong Kong Dollar
            /HK\$\s*\d+[\.,]\d{2}/g,     // HK$10.99, HK$ 10.99
            /\d+[\.,]\d{2}\s*HKD/gi,     // 10.99 HKD

            // NZD - New Zealand Dollar
            /NZ\$\s*\d+[\.,]\d{2}/g,     // NZ$10.99, NZ$ 10.99
            /\d+[\.,]\d{2}\s*NZD/gi,     // 10.99 NZD

            // MXN - Mexican Peso
            /\$\s*\d+[\.,]\d{2}\s*MXN/gi, // $10.99 MXN
            /\d+[\.,]\d{2}\s*MXN/gi,     // 10.99 MXN

            // BRL - Brazilian Real
            /R\$\s*\d+[\.,]\d{2}/g,      // R$10.99, R$ 10.99
            /\d+[\.,]\d{2}\s*BRL/gi,     // 10.99 BRL

            // RUB - Russian Ruble
            /₽\s*\d+[\.,]\d{2}/g,        // ₽10.99, ₽ 10.99
            /\d+[\.,]\d{2}\s*₽/g,        // 10.99₽, 10.99 ₽
            /\d+[\.,]\d{2}\s*RUB/gi,     // 10.99 RUB

            // PLN - Polish Zloty
            /\d+[\.,]\d{2}\s*PLN/gi,     // 10.99 PLN
            /\d+[\.,]\d{2}\s*zł/g,       // 10.99 zł

            // TRY - Turkish Lira
            /₺\s*\d+[\.,]\d{2}/g,        // ₺10.99, ₺ 10.99
            /\d+[\.,]\d{2}\s*₺/g,        // 10.99₺, 10.99 ₺
            /\d+[\.,]\d{2}\s*TRY/gi,     // 10.99 TRY

            // ZAR - South African Rand
            /R\s*\d+[\.,]\d{2}/g,        // R10.99, R 10.99
            /\d+[\.,]\d{2}\s*ZAR/gi,     // 10.99 ZAR

            // THB - Thai Baht
            /฿\s*\d+[\.,]\d{2}/g,        // ฿10.99, ฿ 10.99
            /\d+[\.,]\d{2}\s*฿/g,        // 10.99฿, 10.99 ฿
            /\d+[\.,]\d{2}\s*THB/gi,     // 10.99 THB

            // MYR - Malaysian Ringgit
            /RM\s*\d+[\.,]\d{2}/g,       // RM10.99, RM 10.99
            /\d+[\.,]\d{2}\s*MYR/gi,     // 10.99 MYR

            // PHP - Philippine Peso
            /₱\s*\d+[\.,]\d{2}/g,        // ₱10.99, ₱ 10.99
            /\d+[\.,]\d{2}\s*₱/g,        // 10.99₱, 10.99 ₱
            /\d+[\.,]\d{2}\s*PHP/gi,     // 10.99 PHP

            // IDR - Indonesian Rupiah
            /Rp\s*\d+[\.,]?\d*/g,        // Rp10000, Rp 10.000
            /\d+[\.,]?\d*\s*IDR/gi,      // 10000 IDR

            // VND - Vietnamese Dong
            /₫\s*\d+[\.,]?\d*/g,         // ₫10000, ₫ 10.000
            /\d+[\.,]?\d*\s*₫/g,         // 10000₫, 10.000 ₫
            /\d+[\.,]?\d*\s*VND/gi,      // 10000 VND

            // AED - UAE Dirham
            /AED\s*\d+[\.,]\d{2}/g,      // AED 10.99, AED10.99
            /\d+[\.,]\d{2}\s*AED/gi,     // 10.99 AED

            // SAR - Saudi Riyal
            /SAR\s*\d+[\.,]\d{2}/g,      // SAR 10.99, SAR10.99
            /\d+[\.,]\d{2}\s*SAR/gi,     // 10.99 SAR

            // ILS - Israeli Shekel
            /₪\s*\d+[\.,]\d{2}/g,        // ₪10.99, ₪ 10.99
            /\d+[\.,]\d{2}\s*₪/g,        // 10.99₪, 10.99 ₪
            /\d+[\.,]\d{2}\s*ILS/gi,     // 10.99 ILS

            // CZK - Czech Koruna
            /\d+[\.,]\d{2}\s*CZK/gi,     // 10.99 CZK
            /\d+[\.,]\d{2}\s*Kč/g,       // 10.99 Kč

            // HUF - Hungarian Forint
            /\d+\s*HUF/gi,               // 1000 HUF
            /\d+\s*Ft/g,                 // 1000 Ft

            // RON - Romanian Leu
            /\d+[\.,]\d{2}\s*RON/gi,     // 10.99 RON
            /\d+[\.,]\d{2}\s*lei/gi      // 10.99 lei
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
