// Background script for EAN Price Finder extension

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'searchPrices') {
        handlePriceSearch(request, sendResponse);
        return true; // Will respond asynchronously
    }
});

async function handlePriceSearch(request, sendResponse) {
    try {
        const { ean, apiKey, searchEngineId } = request;

        // Construct search queries for better price finding
        const searchQueries = [
            `${ean} price`,
            `${ean} buy online`,
            `${ean} shop`,
            `"${ean}" price comparison`
        ];

        let allResults = [];

        // Search with multiple queries to get better results
        for (let i = 0; i < Math.min(2, searchQueries.length); i++) {
            try {
                const results = await performGoogleSearch(searchQueries[i], apiKey, searchEngineId);
                if (results && results.items) {
                    allResults = allResults.concat(results.items);
                }
            } catch (error) {
                console.error(`Search query ${i + 1} failed:`, error);
            }
        }

        // Filter and rank results
        const filteredResults = filterPriceResults(allResults, ean);

        // Enhance results with prices extracted from actual webpages
        const enhancedResults = await enhanceResultsWithWebpagePrices(filteredResults, ean);

        sendResponse({ results: enhancedResults });

    } catch (error) {
        console.error('Price search error:', error);
        sendResponse({ error: error.message });
    }
}

async function performGoogleSearch(query, apiKey, searchEngineId) {
    const url = new URL('https://www.googleapis.com/customsearch/v1');
    url.searchParams.set('key', apiKey);
    url.searchParams.set('cx', searchEngineId);
    url.searchParams.set('q', query);
    url.searchParams.set('num', '10'); // Get up to 10 results

    const response = await fetch(url.toString());

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error?.message || `Search API error: ${response.status}`);
    }

    return await response.json();
}

function filterPriceResults(results, ean) {
    if (!results || !Array.isArray(results)) return [];

    // Filter results that are likely to contain price information
    const priceKeywords = [
        'price', 'buy', 'shop', 'store', 'purchase', 'cost', 'sale',
        'amazon', 'ebay', 'walmart', 'target', 'bestbuy', 'shopping'
    ];

    const currencySymbols = [
        // Currency symbols
        '$', '€', '£', '¥', '₹', '₩', '₪', '₽', '₺', '₱', '₫', '฿', '₦', '₡', '₨', '₴', '₸', '₼',
        // Currency codes
        'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'INR', 'KRW', 'SGD', 'HKD', 'NZD',
        'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'MXN', 'BRL', 'RUB', 'TRY', 'ZAR', 'THB',
        'MYR', 'PHP', 'IDR', 'VND', 'AED', 'SAR', 'ILS', 'EGP', 'NGN', 'GHS', 'KES', 'UGX', 'TZS',
        // Local currency notations
        'RMB', 'Rs', 'kr', 'zł', 'Kč', 'Ft', 'lei', 'RM', 'Rp', 'C$', 'A$', 'S$', 'HK$', 'NZ$', 'R$'
    ];

    return results
        .filter(item => {
            // Check if the result likely contains price information
            const text = (item.title + ' ' + (item.snippet || '')).toLowerCase();

            const hasEAN = text.includes(ean);
            const hasPriceKeyword = priceKeywords.some(keyword => text.includes(keyword));
            const hasCurrency = currencySymbols.some(symbol => text.includes(symbol.toLowerCase()));

            return hasEAN || hasPriceKeyword || hasCurrency;
        })
        .map(item => ({
            title: item.title,
            snippet: item.snippet,
            link: item.link,
            displayLink: item.displayLink
        }))
        .slice(0, 10); // Limit to top 10 results
}

async function enhanceResultsWithWebpagePrices(results, ean) {
    const enhancedResults = [];

    // First, process all results to check for snippet prices
    const resultsWithSnippetPrices = results.map(result => {
        const snippetPrice = extractPriceFromText(result.snippet);
        return {
            ...result,
            extractedPrice: snippetPrice,
            priceSource: snippetPrice ? 'snippet' : 'none'
        };
    });

    // Separate results that need webpage parsing
    const resultsNeedingWebpageParsing = resultsWithSnippetPrices.filter(
        result => result.priceSource === 'none'
    );

    const resultsWithSnippetPrices_final = resultsWithSnippetPrices.filter(
        result => result.priceSource === 'snippet'
    );

    // Process webpage parsing in parallel but limit concurrent requests
    const concurrentLimit = 3;
    const webpageResults = [];

    for (let i = 0; i < resultsNeedingWebpageParsing.length; i += concurrentLimit) {
        const batch = resultsNeedingWebpageParsing.slice(i, i + concurrentLimit);
        const batchPromises = batch.map(async (result) => {
            try {
                const webpagePrice = await extractPriceFromWebpage(result.link, ean);
                return {
                    ...result,
                    extractedPrice: webpagePrice || 'Price not found',
                    priceSource: webpagePrice ? 'webpage' : 'none'
                };
            } catch (error) {
                console.error(`Error processing ${result.link}:`, error);
                return {
                    ...result,
                    extractedPrice: 'Price not found',
                    priceSource: 'none'
                };
            }
        });

        const batchResults = await Promise.all(batchPromises);
        webpageResults.push(...batchResults);
    }

    // Combine results: snippet prices first, then webpage results
    enhancedResults.push(...resultsWithSnippetPrices_final, ...webpageResults);

    // Sort results by price availability first, then by price value ascending
    return enhancedResults.sort((a, b) => {
        // First, prioritize results with prices over those without
        if (a.priceSource !== 'none' && b.priceSource === 'none') return -1;
        if (a.priceSource === 'none' && b.priceSource !== 'none') return 1;

        // If both have prices, sort by price value ascending
        if (a.priceSource !== 'none' && b.priceSource !== 'none') {
            const priceA = extractNumericPrice(a.extractedPrice);
            const priceB = extractNumericPrice(b.extractedPrice);

            if (priceA !== null && priceB !== null) {
                return priceA - priceB; // Ascending order
            }
            // If one price couldn't be parsed, put the parsed one first
            if (priceA !== null && priceB === null) return -1;
            if (priceA === null && priceB !== null) return 1;
        }

        return 0; // Keep original order if no price comparison possible
    });
}

async function extractPriceFromWebpage(url, ean) {
    try {
        // Skip non-HTTP URLs and potentially problematic domains
        if (!url || !url.startsWith('http')) return null;

        // Add timeout and basic headers
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

        const response = await fetch(url, {
            method: 'GET',
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; EAN-Price-Finder/1.0)',
                'Accept': 'text/html,application/xhtml+xml',
            }
        });

        clearTimeout(timeoutId);

        if (!response.ok) return null;

        // Check if content is HTML
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('text/html')) return null;

        const html = await response.text();

        // Extract price from HTML content
        return extractPriceFromHTML(html, ean);

    } catch (error) {
        console.error(`Failed to fetch webpage ${url}:`, error);
        return null;
    }
}

function extractPriceFromHTML(html, ean) {
    // Remove script and style tags to avoid parsing JavaScript/CSS
    const cleanHtml = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

    // Convert HTML to text (basic approach)
    const textContent = cleanHtml.replace(/<[^>]+>/g, ' ')
                                 .replace(/\s+/g, ' ')
                                 .trim();

    // Look for price patterns in the text content
    const price = extractPriceFromText(textContent);
    if (price) return price;

    // Also try common price-related HTML patterns
    const pricePatterns = [
        // Common price class/id patterns
        /class="[^"]*price[^"]*"[^>]*>([^<]*(?:\$|€|£|USD|EUR|GBP)[^<]*)</gi,
        /id="[^"]*price[^"]*"[^>]*>([^<]*(?:\$|€|£|USD|EUR|GBP)[^<]*)</gi,
        // Common e-commerce price patterns
        /class="[^"]*cost[^"]*"[^>]*>([^<]*(?:\$|€|£|USD|EUR|GBP)[^<]*)</gi,
        /class="[^"]*amount[^"]*"[^>]*>([^<]*(?:\$|€|£|USD|EUR|GBP)[^<]*)</gi,
        // Schema.org structured data
        /property="price"[^>]*content="([^"]*(?:\$|€|£|\d+[\.,]\d{2})[^"]*)"/gi,
        /itemprop="price"[^>]*content="([^"]*(?:\$|€|£|\d+[\.,]\d{2})[^"]*)"/gi
    ];

    for (const pattern of pricePatterns) {
        const matches = html.match(pattern);
        if (matches) {
            for (const match of matches) {
                const extractedPrice = extractPriceFromText(match);
                if (extractedPrice) return extractedPrice;
            }
        }
    }

    return null;
}

function extractPriceFromText(text) {
    if (!text) return null;

    // Common price patterns for various currencies (matching popup.js)
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
        /\d+[\.,]\d{2}\s*lei/gi,     // 10.99 lei

        // Additional patterns for whole numbers
        /\$\s*\d+\b/g,               // $10, $ 10
        /€\s*\d+\b/g,                // €10, € 10
        /£\s*\d+\b/g,                // £10, £ 10
        /\d+\s*USD\b/gi,             // 10 USD
        /\d+\s*EUR\b/gi,             // 10 EUR
        /\d+\s*GBP\b/gi              // 10 GBP
    ];

    for (const pattern of patterns) {
        const matches = text.match(pattern);
        if (matches) {
            // Return the first reasonable price found
            for (const match of matches) {
                const cleanMatch = match.trim();
                // Filter out obviously wrong prices (too high or too low)
                const numericValue = parseFloat(cleanMatch.replace(/[^\d.,]/g, '').replace(',', '.'));
                if (numericValue >= 0.01 && numericValue <= 999999) {
                    return cleanMatch;
                }
            }
        }
    }

    return null;
}

function extractNumericPrice(priceText) {
    if (!priceText || priceText === 'Price not found') return null;

    // Extract numeric value from price text
    const numericString = priceText.replace(/[^\d.,]/g, '').replace(',', '.');
    const numericValue = parseFloat(numericString);

    // Return null if not a valid number or outside reasonable range
    if (isNaN(numericValue) || numericValue < 0.01 || numericValue > 999999) {
        return null;
    }

    return numericValue;
}

// Handle extension installation
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        // Open options page on first install
        chrome.runtime.openOptionsPage();
    }
});
