/**
 * SCORM Asset Handler
 * 
 * This module provides a client-side asset handler for serving files from SCORM packages.
 * It works with the existing SCORMPackageManager to serve assets without requiring a backend API.
 */

import { SCORMPackageManager } from './scorm-package-manager';

export interface AssetRequest {
  packageId: string;
  path: string;
}

export interface AssetResponse {
  success: boolean;
  blob?: Blob;
  error?: string;
  contentType?: string;
}

/**
 * Serves an asset from a SCORM package
 */
export async function serveSCORMAsset(request: AssetRequest): Promise<AssetResponse> {
  try {
    console.log(`Serving SCORM asset: ${request.path} from package: ${request.packageId}`);
    
    // Get debug info to see what files are available
    const debugInfo = await SCORMPackageManager.getPackageDebugInfo(request.packageId);
    console.log(`Asset handler: Available files in package:`, debugInfo.fileList);
    console.log(`Asset handler: Looking for file: ${request.path}`);
    
    // Get the file from the package
    let blob = await SCORMPackageManager.getPackageFile(request.packageId, request.path);
    
    // If not found, try case-insensitive search
    if (!blob) {
      console.log(`Asset not found with exact path: ${request.path}, trying case-insensitive search...`);
      
      // Get all files and find a case-insensitive match
      const debugInfo = await SCORMPackageManager.getPackageDebugInfo(request.packageId);
      const normalizedRequestPath = request.path.toLowerCase().replace(/^\/+/, '');
      
      for (const file of debugInfo.fileList) {
        const normalizedFile = file.toLowerCase().replace(/^\/+/, '');
        if (normalizedFile === normalizedRequestPath || 
            normalizedFile.endsWith('/' + normalizedRequestPath) ||
            file.toLowerCase().includes(normalizedRequestPath)) {
          console.log(`Found case-insensitive match: ${file} for ${request.path}`);
          blob = await SCORMPackageManager.getPackageFile(request.packageId, file);
          if (blob) {
            console.log(`✓ Successfully loaded file via case-insensitive match: ${file}`);
            break;
          }
        }
      }
    }
    
    if (!blob) {
      console.warn(`Asset not found: ${request.path} in package: ${request.packageId}`);
      return {
        success: false,
        error: `Asset not found: ${request.path}`
      };
    }
    
    // Determine content type based on file extension
    const contentType = getContentType(request.path);
    
    console.log(`✓ Asset served successfully: ${request.path} (${blob.size} bytes, ${contentType})`);
    
    return {
      success: true,
      blob,
      contentType
    };
    
  } catch (error) {
    console.error(`Failed to serve asset: ${request.path}`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Determines the MIME type based on file extension
 */
function getContentType(filePath: string): string {
  const extension = filePath.toLowerCase().split('.').pop();
  
  switch (extension) {
    // Images
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'svg':
      return 'image/svg+xml';
    case 'webp':
      return 'image/webp';
    case 'ico':
      return 'image/x-icon';
    
    // CSS
    case 'css':
      return 'text/css';
    
    // JavaScript
    case 'js':
      return 'application/javascript';
    case 'json':
      return 'application/json';
    
    // HTML
    case 'html':
    case 'htm':
      return 'text/html';
    
    // XML
    case 'xml':
      return 'application/xml';
    
    // Audio
    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/wav';
    case 'm4a':
      return 'audio/mp4';
    
    // Video
    case 'mp4':
      return 'video/mp4';
    case 'webm':
      return 'video/webm';
    case 'ogg':
      return 'video/ogg';
    case 'avi':
      return 'video/x-msvideo';
    
    // Fonts
    case 'woff':
      return 'font/woff';
    case 'woff2':
      return 'font/woff2';
    case 'ttf':
      return 'font/ttf';
    case 'otf':
      return 'font/otf';
    case 'eot':
      return 'application/vnd.ms-fontobject';
    
    // Documents
    case 'pdf':
      return 'application/pdf';
    case 'txt':
      return 'text/plain';
    
    // Archives
    case 'zip':
      return 'application/zip';
    case 'rar':
      return 'application/vnd.rar';
    
    // Default
    default:
      return 'application/octet-stream';
  }
}

/**
 * Creates a blob URL for an asset that can be used in HTML
 */
export async function createAssetBlobUrl(packageId: string, filePath: string): Promise<string | null> {
  try {
    const response = await serveSCORMAsset({ packageId, path: filePath });
    
    if (response.success && response.blob) {
      const blobUrl = URL.createObjectURL(response.blob);
      console.log(`Created blob URL for ${filePath}: ${blobUrl}`);
      return blobUrl;
    } else {
      console.warn(`Failed to create blob URL for ${filePath}: ${response.error}`);
      return null;
    }
  } catch (error) {
    console.error(`Error creating blob URL for ${filePath}:`, error);
    return null;
  }
}

/**
 * Handles asset requests by creating blob URLs
 * This is used as a fallback when the asset handler API is not available
 */
export async function handleAssetRequest(packageId: string, filePath: string): Promise<string> {
  console.log(`Handling asset request: ${filePath} from package: ${packageId}`);
  
  // Try to create a blob URL
  const blobUrl = await createAssetBlobUrl(packageId, filePath);
  
  if (blobUrl) {
    return blobUrl;
  }
  
  // Fallback: return the original path
  console.warn(`Asset not found, using fallback path: ${filePath}`);
  return filePath;
}

/**
 * Cleans up blob URLs to prevent memory leaks
 */
export function revokeAssetBlobUrl(blobUrl: string): void {
  try {
    URL.revokeObjectURL(blobUrl);
    console.log(`Revoked blob URL: ${blobUrl}`);
  } catch (error) {
    console.warn(`Failed to revoke blob URL: ${blobUrl}`, error);
  }
}

/**
 * Debug function to list all assets in a package
 */
export async function debugPackageAssets(packageId: string): Promise<{
  packageExists: boolean;
  fileCount: number;
  fileList: string[];
  assetTypes: Record<string, number>;
}> {
  try {
    const debugInfo = await SCORMPackageManager.getPackageDebugInfo(packageId);
    
    if (!debugInfo.packageExists) {
      return {
        packageExists: false,
        fileCount: 0,
        fileList: [],
        assetTypes: {}
      };
    }
    
    // Categorize files by type
    const assetTypes: Record<string, number> = {};
    debugInfo.fileList.forEach(file => {
      const extension = file.toLowerCase().split('.').pop() || 'unknown';
      assetTypes[extension] = (assetTypes[extension] || 0) + 1;
    });
    
    return {
      packageExists: true,
      fileCount: debugInfo.fileCount,
      fileList: debugInfo.fileList,
      assetTypes
    };
    
  } catch (error) {
    console.error('Failed to debug package assets:', error);
    return {
      packageExists: false,
      fileCount: 0,
      fileList: [],
      assetTypes: {}
    };
  }
} 