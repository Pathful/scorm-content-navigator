/**
 * Mock SCORM API Handler
 * 
 * This module provides a mock API endpoint for serving SCORM assets.
 * It intercepts requests to /api/scorm-asset and serves files from the package.
 */

import { serveSCORMAsset } from './scorm-asset-handler';

// Store for tracking blob URLs to prevent memory leaks
const blobUrlStore = new Map<string, string>();

/**
 * Mock API handler for SCORM assets
 * This simulates a backend API endpoint
 */
export async function handleSCORMAssetRequest(url: string): Promise<Response | null> {
  try {
    // Parse the URL to extract packageId and path
    const urlObj = new URL(url, window.location.origin);
    
    if (urlObj.pathname !== '/api/scorm-asset') {
      return null; // Not our endpoint
    }
    
    const packageId = urlObj.searchParams.get('packageId');
    const path = urlObj.searchParams.get('path');
    
    if (!packageId || !path) {
      console.error('Missing packageId or path in SCORM asset request');
      return new Response('Missing packageId or path', { status: 400 });
    }
    
    console.log(`Mock API: Serving asset ${path} from package ${packageId}`);
    
    // Get debug info to see what files are available
    const { SCORMPackageManager } = await import('./scorm-package-manager');
    const debugInfo = await SCORMPackageManager.getPackageDebugInfo(packageId);
    console.log(`Mock API: Available files in package:`, debugInfo.fileList);
    console.log(`Mock API: Looking for file: ${path}`);
    
    // Check if the file exists in the package (case-insensitive)
    const normalizedPath = path.toLowerCase().replace(/^\/+/, '');
    const fileExists = debugInfo.fileList.some(file => {
      const normalizedFile = file.toLowerCase();
      return normalizedFile === normalizedPath || 
             normalizedFile.endsWith('/' + normalizedPath) ||
             normalizedFile === normalizedPath.replace(/^\/+/, '');
    });
    
    console.log(`Mock API: Looking for file: "${path}" (normalized: "${normalizedPath}")`);
    console.log(`Mock API: File exists in list: ${fileExists}`);
    
    // For now, let's try to serve the file even if it's not in the list
    // The asset handler might be able to find it
    if (!fileExists) {
      console.warn(`Mock API: File not found in package list: ${path}`);
      console.warn(`Mock API: Available files:`, debugInfo.fileList);
      // Don't return 404 yet - let the asset handler try
    }
    
    // Serve the asset using our asset handler
    const response = await serveSCORMAsset({ packageId, path });
    
    if (!response.success) {
      console.error(`Mock API: Asset not found - ${response.error}`);
      return new Response(response.error || 'Asset not found', { status: 404 });
    }
    
    if (!response.blob) {
      console.error('Mock API: No blob returned from asset handler');
      return new Response('No asset data', { status: 500 });
    }
    
    // Create response with proper headers
    const headers = new Headers();
    headers.set('Content-Type', response.contentType || 'application/octet-stream');
    headers.set('Content-Length', response.blob.size.toString());
    headers.set('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type');
    
    console.log(`Mock API: Successfully served ${path} (${response.blob.size} bytes, ${response.contentType})`);
    
    return new Response(response.blob, {
      status: 200,
      headers
    });
    
  } catch (error) {
    console.error('Mock API: Error handling SCORM asset request:', error);
    return new Response('Internal server error', { status: 500 });
  }
}

/**
 * Initialize the mock API handler
 * This should be called early in the application lifecycle
 */
export function initializeMockSCORMAPI(): void {
  console.log('Initializing mock SCORM API handler...');
  
  // Override fetch to intercept our API calls
  const originalFetch = window.fetch;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    
    // Check if this is a request to our mock API
    if (url.includes('/api/scorm-asset')) {
      console.log('Mock API: Intercepting request to:', url);
      
      try {
        const response = await handleSCORMAssetRequest(url);
        if (response) {
          console.log('Mock API: Returning intercepted response');
          return response;
        }
      } catch (error) {
        console.error('Mock API: Error handling request:', error);
        return new Response('Internal server error', { status: 500 });
      }
    }
    
    // For all other requests, use the original fetch
    return originalFetch(input, init);
  };
  
  // Also override XMLHttpRequest for compatibility
  const originalXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method: string, url: string | URL, ...args: any[]) {
    const urlString = url.toString();
    if (urlString.includes('/api/scorm-asset')) {
      console.log('Mock API: Intercepting XMLHttpRequest to:', urlString);
      // For now, let it go through but log it
    }
    return originalXHROpen.call(this, method, url, ...args);
  };
  
  console.log('✓ Mock SCORM API handler initialized');
  
  // Also make the handler available globally for testing
  (window as any).testMockSCORMAPI = async (packageId: string, path: string) => {
    console.log('Global test function called with:', { packageId, path });
    const testUrl = `/api/scorm-asset?packageId=${encodeURIComponent(packageId)}&path=${encodeURIComponent(path)}`;
    const response = await fetch(testUrl);
    console.log('Global test result:', response.status, response.ok);
    return response.ok;
  };
}

/**
 * Clean up blob URLs to prevent memory leaks
 */
export function cleanupBlobUrls(): void {
  console.log('Cleaning up blob URLs...');
  
  for (const [key, blobUrl] of blobUrlStore.entries()) {
    try {
      URL.revokeObjectURL(blobUrl);
      console.log(`Revoked blob URL: ${key}`);
    } catch (error) {
      console.warn(`Failed to revoke blob URL: ${key}`, error);
    }
  }
  
  blobUrlStore.clear();
  console.log('✓ Blob URL cleanup completed');
}

/**
 * Test the mock API with a sample request
 */
export async function testMockSCORMAPI(packageId: string, filePath: string): Promise<boolean> {
  try {
    const testUrl = `/api/scorm-asset?packageId=${encodeURIComponent(packageId)}&path=${encodeURIComponent(filePath)}`;
    console.log('Testing mock API with URL:', testUrl);
    
    const response = await fetch(testUrl);
    
    if (response.ok) {
      const blob = await response.blob();
      console.log(`✓ Mock API test successful: ${filePath} (${blob.size} bytes)`);
      return true;
    } else {
      console.error(`✗ Mock API test failed: ${filePath} (${response.status} ${response.statusText})`);
      return false;
    }
  } catch (error) {
    console.error('Mock API test error:', error);
    return false;
  }
} 