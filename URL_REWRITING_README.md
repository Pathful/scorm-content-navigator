# SCORM URL Rewriting Implementation

This document describes the URL rewriting functionality implemented to fix asset loading issues in SCORM content.

## Problem

SCORM packages contain HTML files with relative URLs for assets like:
- Images: `<img src="images/logo.png">`
- CSS: `<link href="styles.css">`
- JavaScript: `<script src="scripts/app.js">`
- Media: `<video src="media/video.mp4">`

When these HTML files are served in an iframe, the relative URLs don't work because the browser can't find the assets.

## Solution

The implementation includes:

### 1. URL Rewriting (`src/lib/scorm-url-rewriter.ts`)

Rewrites all relative URLs in HTML content to point to our asset handler:

```typescript
// Before
<img src="images/logo.png">

// After  
<img src="/api/scorm-asset?packageId=123&path=images/logo.png">
```

**Supported URL types:**
- `<img src="...">`
- `<link href="...">` (CSS files)
- `<script src="...">`
- `<video src="...">`, `<audio src="...">`
- `<source src="...">`
- CSS `url()` functions
- CSS `@import` statements
- `background-image` properties

### 2. Asset Handler (`src/lib/scorm-asset-handler.ts`)

Serves files from SCORM packages using the existing `SCORMPackageManager`:

```typescript
// Serves a file from a package
const response = await serveSCORMAsset({ 
  packageId: 'package-123', 
  path: 'images/logo.png' 
});
```

### 3. Mock API (`src/lib/mock-scorm-api.ts`)

Intercepts requests to `/api/scorm-asset` and serves files from packages:

```typescript
// Intercepts fetch requests
window.fetch = async (input, init) => {
  if (url.includes('/api/scorm-asset')) {
    return handleSCORMAssetRequest(url);
  }
  return originalFetch(input, init);
};
```

### 4. Integration in SCORMPlayer

The `loadSCO` function now:
1. Loads HTML content from the package
2. Extracts and logs asset URLs for debugging
3. Injects SCORM API scripts
4. **Rewrites all asset URLs** to point to our handler
5. Creates a blob URL for the modified HTML
6. Loads it in the iframe

## Usage

### Automatic URL Rewriting

URL rewriting happens automatically when loading SCORM content. No additional configuration needed.

### Debugging

Use the debug buttons in the SCORMPlayer:

- **"Test URL Rewriting"** - Tests with sample HTML
- **"Test URL Rewriting with Package"** - Tests with actual package files
- **"Debug Package Assets"** - Lists all files in a package
- **"Test Mock API"** - Tests the asset serving API

### Manual Testing

```typescript
import { testURLRewriting } from '@/lib/test-url-rewriting';

// Test with sample HTML
const results = testURLRewriting();
console.log('URL rewriting test:', results);

// Test with actual package
const packageResults = await testURLRewritingWithPackage('package-id', 'index.html');
console.log('Package test:', packageResults);
```

## Example

**Original HTML:**
```html
<!DOCTYPE html>
<html>
<head>
    <link rel="stylesheet" href="styles.css">
    <script src="scripts/app.js"></script>
</head>
<body>
    <img src="images/logo.png" alt="Logo">
    <video src="media/video.mp4" controls></video>
</body>
</html>
```

**After URL Rewriting:**
```html
<!DOCTYPE html>
<html>
<head>
    <link rel="stylesheet" href="/api/scorm-asset?packageId=123&path=styles.css">
    <script src="/api/scorm-asset?packageId=123&path=scripts/app.js"></script>
</head>
<body>
    <img src="/api/scorm-asset?packageId=123&path=images/logo.png" alt="Logo">
    <video src="/api/scorm-asset?packageId=123&path=media/video.mp4" controls></video>
</body>
</html>
```

## Benefits

1. **Fixes asset loading** - All relative URLs work correctly
2. **No backend required** - Works entirely client-side
3. **Comprehensive coverage** - Handles all common asset types
4. **Debugging tools** - Built-in testing and debugging features
5. **Memory efficient** - Uses blob URLs and proper cleanup

## Technical Details

### Path Resolution

The URL rewriter handles various path patterns:
- `images/logo.png` → `images/logo.png`
- `./assets/style.css` → `assets/style.css`  
- `../shared/global.css` → `shared/global.css`

### Content Type Detection

The asset handler automatically detects MIME types based on file extensions:
- `.png`, `.jpg`, `.gif` → `image/*`
- `.css` → `text/css`
- `.js` → `application/javascript`
- `.mp4`, `.webm` → `video/*`

### Error Handling

- Missing files return 404 responses
- Invalid requests return 400 responses
- Server errors return 500 responses
- All errors are logged for debugging

## Future Enhancements

1. **Caching** - Add browser caching for frequently accessed assets
2. **Compression** - Support gzip compression for text assets
3. **CDN Integration** - Support external CDN URLs
4. **Progressive Loading** - Load assets progressively for better performance
5. **Asset Optimization** - Minify CSS/JS and optimize images 