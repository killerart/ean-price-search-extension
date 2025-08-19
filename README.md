# EAN Price Finder Chrome Extension

A Chrome extension that finds item prices by EAN (European Article Number) code using Google Custom Search API.

## Features

- 🔍 Search for product prices by EAN code
- 🎯 Automatic EAN detection on web pages
- 💰 Price extraction from search results
- ⚙️ Easy API configuration
- 🌐 Works with 30+ currencies worldwide (USD, EUR, GBP, JPY, and many more)
- 📱 Clean, modern interface

## Installation

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the extension folder
5. The extension will appear in your Chrome toolbar

## Setup

### 1. Get Google Custom Search API Key

1. Go to [Google Cloud Console](https://console.developers.google.com/)
2. Create a new project or select an existing one
3. Enable the "Custom Search API"
4. Go to "Credentials" and create an API key
5. Copy the API key

### 2. Create Custom Search Engine

1. Go to [Google Custom Search Engine](https://cse.google.com/cse/)
2. Click "Add" to create a new search engine
3. In "Sites to search", enter `*` to search the entire web
4. Click "Create"
5. Copy the Search Engine ID (format: xxxxxxxxx:xxxxxxxx)

### 3. Configure the Extension

1. Click the extension icon in Chrome toolbar
2. Click "⚙️ API Settings" at the bottom
3. Enter your API key and Search Engine ID
4. Click "Save Settings"
5. Click "Test Connection" to verify setup

## Usage

### Manual Search
1. Click the extension icon
2. Enter an EAN code (8, 12, or 13 digits)
3. Click "Search Prices"
4. View results with prices and links to stores

### Automatic Detection
- The extension automatically highlights EAN codes on e-commerce websites
- Click the "🔍 Find EANs" button on any page to highlight EAN codes
- Click highlighted EAN codes to search for prices

## Supported EAN Formats

- EAN-13 (13 digits) - Most common format
- UPC-A (12 digits) - North American format
- EAN-8 (8 digits) - Short format

## API Limits

- Google Custom Search API provides 100 free searches per day
- Additional searches require payment
- See [Google Custom Search pricing](https://developers.google.com/custom-search/v1/overview) for details

## Currency Support

The extension can detect prices in multiple currencies from around the world:

### Major Currencies
- **USD** ($) - US Dollar
- **EUR** (€) - Euro
- **GBP** (£) - British Pound
- **JPY** (¥) - Japanese Yen
- **CAD** (C$) - Canadian Dollar
- **AUD** (A$) - Australian Dollar
- **CHF** - Swiss Franc

### European Currencies
- **SEK** (kr) - Swedish Krona
- **NOK** - Norwegian Krone
- **DKK** - Danish Krone
- **PLN** (zł) - Polish Zloty
- **CZK** (Kč) - Czech Koruna
- **HUF** (Ft) - Hungarian Forint
- **RON** (lei) - Romanian Leu

### Asian Currencies
- **CNY** (¥/RMB) - Chinese Yuan
- **INR** (₹/Rs) - Indian Rupee
- **KRW** (₩) - South Korean Won
- **SGD** (S$) - Singapore Dollar
- **HKD** (HK$) - Hong Kong Dollar
- **THB** (฿) - Thai Baht
- **MYR** (RM) - Malaysian Ringgit
- **PHP** (₱) - Philippine Peso
- **IDR** (Rp) - Indonesian Rupiah
- **VND** (₫) - Vietnamese Dong

### Other Currencies
- **NZD** (NZ$) - New Zealand Dollar
- **MXN** - Mexican Peso
- **BRL** (R$) - Brazilian Real
- **RUB** (₽) - Russian Ruble
- **TRY** (₺) - Turkish Lira
- **ZAR** (R) - South African Rand
- **AED** - UAE Dirham
- **SAR** - Saudi Riyal
- **ILS** (₪) - Israeli Shekel

The extension automatically detects prices using currency symbols, currency codes (like USD, EUR), and local currency notations.

## Files Structure

```
extension/
├── manifest.json          # Extension manifest
├── popup.html             # Main popup interface
├── popup.js               # Popup functionality
├── background.js          # Background service worker
├── content.js             # Content script for page interaction
├── options.html           # Settings page
├── options.js             # Settings functionality
├── icons/                 # Extension icons
└── README.md              # This file
```

## Privacy

This extension:
- Only sends EAN codes to Google Search API
- Does not collect or store personal data
- API keys are stored locally in Chrome sync storage
- No data is sent to third-party servers (except Google API)

## Troubleshooting

### "API key not configured" error
- Make sure you've entered both API key and Search Engine ID in settings
- Verify the API key is correct and Custom Search API is enabled

### "No results found" error
- Try a different EAN code
- Check if the product exists in online stores
- Verify your internet connection

### "Daily limit exceeded" error
- You've used your free 100 searches for the day
- Wait until tomorrow or upgrade to paid plan

## Development

To modify the extension:

1. Make changes to the source files
2. Go to `chrome://extensions/`
3. Click the refresh icon on the extension card
4. Test your changes

## License

This project is open source. Feel free to modify and distribute.

## Support

For issues or questions, please check the troubleshooting section above or create an issue in the repository.
