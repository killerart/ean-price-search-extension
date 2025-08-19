// Content script for EAN Price Finder extension

// Function to extract EAN codes from the current page
function extractEANFromPage() {
    const eanPatterns = [
        /\b\d{13}\b/g,  // EAN-13
        /\b\d{12}\b/g,  // UPC-A
        /\b\d{8}\b/g    // EAN-8
    ];

    const pageText = document.body.innerText;
    const foundEANs = [];

    eanPatterns.forEach(pattern => {
        const matches = pageText.match(pattern);
        if (matches) {
            foundEANs.push(...matches);
        }
    });

    return [...new Set(foundEANs)]; // Remove duplicates
}

// Function to highlight EAN codes on the page
function highlightEANs() {
    // Check if EANs are already highlighted
    if (document.querySelectorAll('.ean-highlighted').length > 0) {
        return; // EANs already highlighted, don't highlight again
    }

    const eans = extractEANFromPage();

    if (eans.length === 0) return;

    // Create a style for highlighting
    if (!document.getElementById('ean-highlighter-style')) {
        const style = document.createElement('style');
        style.id = 'ean-highlighter-style';
        style.textContent = `
            .ean-highlighted {
                background-color: #8798e3ff;
                padding: 2px 4px;
                border-radius: 3px;
                cursor: pointer;
                position: relative;
            }
            .ean-tooltip {
                position: absolute;
                top: -30px;
                left: 0;
                background: #333;
                color: white;
                padding: 5px 8px;
                border-radius: 4px;
                font-size: 12px;
                white-space: nowrap;
                z-index: 10000;
                display: none;
            }
            .ean-highlighted:hover .ean-tooltip {
                display: block;
            }
        `;
        document.head.appendChild(style);
    }

    // Find and highlight EAN codes in text nodes
    const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: function(node) {
                // Skip nodes that are already inside highlighted elements
                let parent = node.parentNode;
                while (parent) {
                    if (parent.classList && parent.classList.contains('ean-highlighted')) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    parent = parent.parentNode;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        },
        false
    );

    const textNodes = [];
    let node;

    while (node = walker.nextNode()) {
        textNodes.push(node);
    }

    textNodes.forEach(textNode => {
        const text = textNode.textContent;
        let modifiedText = text;
        let hasEAN = false;

        eans.forEach(ean => {
            if (text.includes(ean)) {
                const regex = new RegExp(`\\b${ean}\\b`, 'g');
                modifiedText = modifiedText.replace(regex,
                    `<span class="ean-highlighted" data-ean="${ean}">
                        ${ean}
                        <div class="ean-tooltip">Click to search prices</div>
                    </span>`
                );
                hasEAN = true;
            }
        });

        if (hasEAN) {
            const wrapper = document.createElement('div');
            wrapper.innerHTML = modifiedText;
            textNode.parentNode.replaceChild(wrapper, textNode);
        }
    });

    // Add click handlers to highlighted EANs
    document.querySelectorAll('.ean-highlighted').forEach(element => {
        element.addEventListener('click', function(e) {
            e.preventDefault();
            const ean = this.getAttribute('data-ean');
            searchEANPrice(ean);
        });
    });

    // Scroll to the first highlighted EAN
    const firstHighlightedEAN = document.querySelector('.ean-highlighted');
    if (firstHighlightedEAN) {
        // Add pulse animation CSS first
        if (!document.getElementById('ean-pulse-style')) {
            const pulseStyle = document.createElement('style');
            pulseStyle.id = 'ean-pulse-style';
            pulseStyle.textContent = `
                @keyframes ean-pulse {
                    0%, 100% {
                        background-color: #8798e3ff;
                        transform: scale(1);
                    }
                    25%, 75% {
                        background-color: #6c44f1ff;
                        transform: scale(1.05);
                    }
                    50% {
                        background-color: #9971daff;
                        transform: scale(1.1);
                    }
                }
                .ean-pulsing {
                    animation: ean-pulse 2s linear;
                }
            `;
            document.head.appendChild(pulseStyle);
        }

        // Scroll to the element first
        firstHighlightedEAN.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'nearest'
        });

        // Add animation after a short delay to ensure visibility
        setTimeout(() => {
            firstHighlightedEAN.classList.add('ean-pulsing');

            // Remove animation class after it completes
            setTimeout(() => {
                firstHighlightedEAN.classList.remove('ean-pulsing');
            }, 2000);
        }, 500); // 500ms delay to ensure scroll completes
    }
}

// Function to clear existing EAN highlights
function clearEANHighlights() {
    const highlightedElements = document.querySelectorAll('.ean-highlighted');
    highlightedElements.forEach(element => {
        const parent = element.parentNode;
        // Use the data-ean attribute to get only the EAN code, not the tooltip text
        const eanText = element.getAttribute('data-ean');
        parent.replaceChild(document.createTextNode(eanText), element);
        parent.normalize(); // Merge adjacent text nodes
    });
}

// Function to search for EAN price (opens extension popup with pre-filled EAN)
function searchEANPrice(ean) {
    // Store the EAN for the popup to use
    chrome.storage.local.set({ lastEAN: ean }, function() {
        // Send message to background to open popup
        chrome.runtime.sendMessage({ action: 'openPopup', ean: ean });
    });
}

// Function to add floating EAN scanner button
function addEANScannerButton() {
    // Check if button already exists
    if (document.getElementById('ean-scanner-button')) return;

    const button = document.createElement('button');
    button.id = 'ean-scanner-button';
    button.innerHTML = '🔍 Find EANs';
    button.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 10000;
        background: #4CAF50;
        color: white;
        border: none;
        padding: 10px 15px;
        border-radius: 25px;
        cursor: pointer;
        font-size: 14px;
        font-weight: bold;
        box-shadow: 0 4px 8px rgba(0,0,0,0.2);
        transition: all 0.3s ease;
    `;

    button.addEventListener('mouseenter', function() {
        this.style.transform = 'scale(1.05)';
        this.style.boxShadow = '0 6px 12px rgba(0,0,0,0.3)';
    });

    button.addEventListener('mouseleave', function() {
        this.style.transform = 'scale(1)';
        this.style.boxShadow = '0 4px 8px rgba(0,0,0,0.2)';
    });

    button.addEventListener('click', function() {
        const existingHighlights = document.querySelectorAll('.ean-highlighted');

        if (existingHighlights.length > 0) {
            // Clear existing highlights
            clearEANHighlights();
            this.innerHTML = '🔍 Find EANs';
        } else {
            // Add highlights
            highlightEANs();
            const highlightCount = document.querySelectorAll('.ean-highlighted').length;
            if (highlightCount > 0) {
                this.innerHTML = `✅ ${highlightCount} EAN${highlightCount > 1 ? 's' : ''} Found`;
                setTimeout(() => {
                    this.innerHTML = '❌ Clear EANs';
                }, 2000);
            } else {
                this.innerHTML = '❌ No EANs Found';
                setTimeout(() => {
                    this.innerHTML = '🔍 Find EANs';
                }, 2000);
            }
        }
    });

    document.body.appendChild(button);
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractEANs') {
        const eans = extractEANFromPage();
        sendResponse({ eans: eans });
    } else if (request.action === 'highlightEANs') {
        highlightEANs();
        sendResponse({ success: true });
    }
});

// Initialize content script
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

function init() {
    // Add EAN scanner button after page loads
    setTimeout(addEANScannerButton, 1000);

    // Auto-extract EANs on e-commerce sites
    const ecommerceDomains = ['amazon', 'ebay', 'walmart', 'target', 'bestbuy', 'alibaba'];
    const currentDomain = window.location.hostname.toLowerCase();

    if (ecommerceDomains.some(domain => currentDomain.includes(domain))) {
        setTimeout(highlightEANs, 2000);
    }
}
