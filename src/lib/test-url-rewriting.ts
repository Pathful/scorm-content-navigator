/**
 * Test URL Rewriting
 * 
 * This module provides test functions to verify that URL rewriting is working correctly.
 */

import { rewriteSCORMUrls, extractAssetUrls } from './scorm-url-rewriter';

/**
 * Test HTML content with various asset references
 */
const testHTML = `
<!DOCTYPE html>
<html>
<head>
    <title>Test SCORM Content</title>
    <link rel="stylesheet" href="styles.css">
    <link rel="stylesheet" href="./assets/main.css">
    <link rel="stylesheet" href="../shared/global.css">
    <script src="scripts/app.js"></script>
    <script src="./js/main.js"></script>
</head>
<body>
    <h1>Test Content</h1>
    <img src="images/logo.png" alt="Logo">
    <img src="./assets/banner.jpg" alt="Banner">
    <img src="../shared/icon.svg" alt="Icon">
    
    <video src="media/video.mp4" controls></video>
    <audio src="audio/sound.mp3"></audio>
    
    <div style="background-image: url('images/bg.jpg')">
        Background image test
    </div>
    
    <style>
        @import url('fonts/custom.css');
        .test { background: url('images/pattern.png'); }
    </style>
</body>
</html>
`;

/**
 * Test URL rewriting functionality
 */
export function testURLRewriting(): {
  success: boolean;
  originalAssets: { images: string[]; stylesheets: string[]; scripts: string[]; media: string[]; };
  rewrittenAssets: { images: string[]; stylesheets: string[]; scripts: string[]; media: string[]; };
  originalLength: number;
  rewrittenLength: number;
} {
  console.log('=== Testing URL Rewriting ===');
  
  // Extract original assets
  const originalAssets = extractAssetUrls(testHTML);
  console.log('Original assets found:', originalAssets);
  
  // Rewrite URLs
  const rewrittenHTML = rewriteSCORMUrls(testHTML, {
    packageId: 'test-package-123',
    baseUrl: 'http://localhost:3000',
    currentFilePath: 'index.html'
  });
  
  // Extract rewritten assets
  const rewrittenAssets = extractAssetUrls(rewrittenHTML);
  console.log('Rewritten assets found:', rewrittenAssets);
  
  // Check if URLs were rewritten
  const hasRewrittenUrls = rewrittenHTML.includes('/api/scorm-asset?packageId=');
  
  console.log('URL rewriting test results:');
  console.log('- Original HTML length:', testHTML.length);
  console.log('- Rewritten HTML length:', rewrittenHTML.length);
  console.log('- Contains rewritten URLs:', hasRewrittenUrls);
  console.log('- Original assets count:', Object.values(originalAssets).flat().length);
  console.log('- Rewritten assets count:', Object.values(rewrittenAssets).flat().length);
  
  // Show some examples of rewritten URLs
  const rewrittenUrlMatches = rewrittenHTML.match(/\/api\/scorm-asset\?packageId=[^"'\s]+/g);
  if (rewrittenUrlMatches) {
    console.log('Examples of rewritten URLs:');
    rewrittenUrlMatches.slice(0, 5).forEach(url => {
      console.log(`  ${url}`);
    });
  }
  
  return {
    success: hasRewrittenUrls,
    originalAssets,
    rewrittenAssets,
    originalLength: testHTML.length,
    rewrittenLength: rewrittenHTML.length
  };
}

/**
 * Test with a specific package and file
 */
export async function testURLRewritingWithPackage(packageId: string, filePath: string): Promise<{
  success: boolean;
  filePath: string;
  originalAssets: { images: string[]; stylesheets: string[]; scripts: string[]; media: string[]; };
  rewrittenAssets: { images: string[]; stylesheets: string[]; scripts: string[]; media: string[]; };
  originalLength: number;
  rewrittenLength: number;
} | undefined> {
  console.log(`=== Testing URL Rewriting with Package ${packageId} ===`);
  
  try {
    // Import SCORMPackageManager dynamically to avoid circular dependencies
    const { SCORMPackageManager } = await import('./scorm-package-manager');
    
    // Get the file content
    const blob = await SCORMPackageManager.getPackageFile(packageId, filePath);
    if (!blob) {
      console.error(`File not found: ${filePath}`);
      return;
    }
    
    const htmlContent = await blob.text();
    console.log(`Original HTML content length: ${htmlContent.length}`);
    
    // Extract original assets
    const originalAssets = extractAssetUrls(htmlContent);
    console.log('Original assets in file:', originalAssets);
    
    // Rewrite URLs
    const rewrittenHTML = rewriteSCORMUrls(htmlContent, {
      packageId,
      baseUrl: window.location.origin,
      currentFilePath: filePath
    });
    
    // Extract rewritten assets
    const rewrittenAssets = extractAssetUrls(rewrittenHTML);
    console.log('Rewritten assets in file:', rewrittenAssets);
    
    // Check results
    const hasRewrittenUrls = rewrittenHTML.includes('/api/scorm-asset?packageId=');
    const assetCount = Object.values(originalAssets).flat().length;
    const rewrittenCount = Object.values(rewrittenAssets).flat().length;
    
    console.log('URL rewriting results:');
    console.log(`- File: ${filePath}`);
    console.log(`- Original assets: ${assetCount}`);
    console.log(`- Rewritten assets: ${rewrittenCount}`);
    console.log(`- URLs rewritten: ${hasRewrittenUrls}`);
    console.log(`- Content length change: ${htmlContent.length} -> ${rewrittenHTML.length}`);
    
    return {
      success: hasRewrittenUrls,
      filePath,
      originalAssets,
      rewrittenAssets,
      originalLength: htmlContent.length,
      rewrittenLength: rewrittenHTML.length
    };
    
  } catch (error) {
    console.error('Error testing URL rewriting with package:', error);
    throw error;
  }
}

/**
 * Generate a test report
 */
export function generateURLRewritingReport(): void {
  console.log('=== URL Rewriting Test Report ===');
  
  const results = testURLRewriting();
  
  console.log('\n📊 Test Results:');
  console.log(`✅ Success: ${results.success}`);
  console.log(`📄 Original HTML: ${results.originalLength} characters`);
  console.log(`📄 Rewritten HTML: ${results.rewrittenLength} characters`);
  console.log(`📈 Size change: ${((results.rewrittenLength - results.originalLength) / results.originalLength * 100).toFixed(1)}%`);
  
  console.log('\n📁 Asset Breakdown:');
  Object.entries(results.originalAssets).forEach(([type, assets]) => {
    console.log(`  ${type}: ${assets.length} assets`);
  });
  
  console.log('\n🔗 URL Rewriting Examples:');
  const testResult = testURLRewriting();
  if (testResult.success) {
    console.log('  ✅ URLs are being rewritten correctly');
  } else {
    console.log('  ❌ URL rewriting may not be working');
  }
}

/**
 * Test path resolution specifically
 */
export async function testPathResolution(): Promise<void> {
  console.log('=== Testing Path Resolution ===');
  
  // Test the specific case from the logs
  console.log('Testing specific case from logs:');
  const { rewriteSCORMUrls } = await import('./scorm-url-rewriter');
  
  const testHtml = `
    <script src="../shared/scormfunctions.js"></script>
    <script src="../shared/contentfunctions.js"></script>
    <img src="par.jpg">
  `;
  
  const rewrittenHtml = rewriteSCORMUrls(testHtml, {
    packageId: 'test-package',
    baseUrl: 'http://localhost:8080',
    currentFilePath: 'Playing/Par.html'
  });
  
  console.log('Original HTML:', testHtml);
  console.log('Rewritten HTML:', rewrittenHtml);
  
  // Check if the paths are correct
  const scriptMatches = rewrittenHtml.match(/src="([^"]+)"/g);
  if (scriptMatches) {
    scriptMatches.forEach((match, index) => {
      const pathMatch = match.match(/path=([^&]+)/);
      const path = pathMatch ? decodeURIComponent(pathMatch[1]) : 'NOT_FOUND';
      console.log(`Script ${index + 1} path: ${path}`);
    });
  }
  
  console.log('');
  
  const testCases = [
    { url: '../shared/scormfunctions.js', basePath: 'Playing/Par.html', expected: 'shared/scormfunctions.js' },
    { url: '../shared/contentfunctions.js', basePath: 'Playing/Par.html', expected: 'shared/contentfunctions.js' },
    { url: 'par.jpg', basePath: 'Playing/Par.html', expected: 'Playing/par.jpg' },
    { url: './local.css', basePath: 'Playing/Par.html', expected: 'Playing/local.css' },
    { url: 'images/logo.png', basePath: 'index.html', expected: 'images/logo.png' },
    { url: '../images/logo.png', basePath: 'subfolder/page.html', expected: 'images/logo.png' }
  ];
  
  testCases.forEach(({ url, basePath, expected }) => {
    // Create a simple HTML with the URL
    const testHtml = `<img src="${url}">`;
    const rewrittenHtml = rewriteSCORMUrls(testHtml, {
      packageId: 'test',
      baseUrl: 'http://localhost:8080',
      currentFilePath: basePath
    });
    
    // Extract the rewritten URL
    const match = rewrittenHtml.match(/src="([^"]+)"/);
    const actualUrl = match ? match[1] : 'NOT_FOUND';
    
    // Extract the path parameter from the URL
    const pathMatch = actualUrl.match(/path=([^&]+)/);
    const actualPath = pathMatch ? decodeURIComponent(pathMatch[1]) : 'NOT_FOUND';
    
    // Check if it contains the expected path
    const containsExpected = actualPath.includes(expected);
    
    console.log(`Test: "${url}" from "${basePath}"`);
    console.log(`  Expected: ${expected}`);
    console.log(`  Actual URL: ${actualUrl}`);
    console.log(`  Actual Path: ${actualPath}`);
    console.log(`  ✅ Success: ${containsExpected}`);
    console.log('');
  });
} 