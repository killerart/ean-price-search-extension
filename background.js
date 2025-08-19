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

    const currencySymbols = ['$', '€', '£', '¥', 'USD', 'EUR', 'GBP', 'JPY'];

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

    // Common price patterns (same as in popup.js but consolidated here)
    const patterns = [
        /\$\s*\d+[\.,]\d{2}/g,        // $10.99, $10,99, $ 10.99, $ 10,99
        /\d+[\.,]\d{2}\s*\$/g,       // 10.99$, 10,99 $
        /€\s*\d+[\.,]\d{2}/g,        // €10.99, €10,99, € 10.99, € 10,99
        /\d+[\.,]\d{2}\s*€/g,        // 10.99€, 10,99 €
        /£\s*\d+[\.,]\d{2}/g,        // £10.99, £10,99, £ 10.99, £ 10,99
        /\d+[\.,]\d{2}\s*£/g,        // 10.99£, 10,99 £
        /\d+[\.,]\d{2}\s*USD/gi,     // 10.99 USD
        /\d+[\.,]\d{2}\s*EUR/gi,     // 10.99 EUR
        /\d+[\.,]\d{2}\s*GBP/gi,     // 10.99 GBP
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
