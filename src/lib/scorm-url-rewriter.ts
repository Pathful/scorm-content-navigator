/**
 * SCORM URL Rewriter
 * 
 * This utility rewrites relative URLs in SCORM content to point to our asset handler,
 * ensuring that images, CSS, JS, and other assets are properly served from the SCORM package.
 */

export interface URLRewriteOptions {
  packageId: string;
  baseUrl?: string;
  currentFilePath?: string;
}

/**
 * Rewrites all asset URLs in HTML content to point to our asset handler
 */
export function rewriteSCORMUrls(htmlContent: string, options: URLRewriteOptions): string {
  const { packageId, baseUrl = '', currentFilePath = '' } = options;
  
  console.log('Rewriting URLs for package:', packageId);
  console.log('Base URL:', baseUrl);
  console.log('Current file path:', currentFilePath);
  
  let modifiedContent = htmlContent;
  
  // Helper function to resolve relative paths
  const resolvePath = (url: string, basePath: string): string => {
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:') || url.startsWith('#')) {
      return url; // Don't rewrite absolute URLs or data URLs
    }
    
    // Remove leading slashes and normalize
    const cleanUrl = url.replace(/^\/+/, '');
    const cleanBasePath = basePath.replace(/^\/+/, '');
    
    console.log(`Resolving path: "${url}" from base "${basePath}"`);
    
    // Handle relative paths (../ and ./)
    if (cleanUrl.startsWith('../')) {
      // Go up one directory level - just use the relative path directly
      const relativePath = cleanUrl.replace(/^\.\.\//, '');
      console.log(`  ../ resolved: "${cleanUrl}" -> "${relativePath}"`);
      return relativePath;
    }
    
    if (cleanUrl.startsWith('./')) {
      // Same directory as current file
      const baseDir = cleanBasePath.split('/').slice(0, -1).join('/');
      const relativePath = cleanUrl.replace(/^\.\//, '');
      const resolvedPath = baseDir ? `${baseDir}/${relativePath}` : relativePath;
      console.log(`  ./ resolved: "${cleanUrl}" -> "${resolvedPath}"`);
      return resolvedPath;
    }
    
    // If the URL doesn't start with ./ or ../, it's relative to the current file's directory
    if (!cleanUrl.includes('/')) {
      // Same directory as current file
      const baseDir = cleanBasePath.split('/').slice(0, -1).join('/');
      const resolvedPath = baseDir ? `${baseDir}/${cleanUrl}` : cleanUrl;
      console.log(`  same dir resolved: "${cleanUrl}" -> "${resolvedPath}"`);
      return resolvedPath;
    }
    
    // If it contains / but doesn't start with ./ or ../, treat as absolute from package root
    console.log(`  absolute path: "${cleanUrl}" -> "${cleanUrl}"`);
    return cleanUrl;
  };
  
  // Helper function to create asset handler URL
  const createAssetUrl = (path: string): string => {
    const resolvedPath = resolvePath(path, currentFilePath);
    return `${baseUrl}/api/scorm-asset?packageId=${encodeURIComponent(packageId)}&path=${encodeURIComponent(resolvedPath)}`;
  };
  
  // Rewrite img src attributes
  modifiedContent = modifiedContent.replace(
    /<img([^>]*?)src\s*=\s*["']([^"']+)["']([^>]*?)>/gi,
    (match, before, src, after) => {
      const newSrc = createAssetUrl(src);
      console.log(`Rewriting img src: "${src}" -> "${newSrc}"`);
      return `<img${before}src="${newSrc}"${after}>`;
    }
  );
  
  // Rewrite link href attributes (CSS files)
  modifiedContent = modifiedContent.replace(
    /<link([^>]*?)href\s*=\s*["']([^"']+)["']([^>]*?)>/gi,
    (match, before, href, after) => {
      const newHref = createAssetUrl(href);
      console.log(`Rewriting link href: "${href}" -> "${newHref}"`);
      return `<link${before}href="${newHref}"${after}>`;
    }
  );
  
  // Rewrite script src attributes
  modifiedContent = modifiedContent.replace(
    /<script([^>]*?)src\s*=\s*["']([^"']+)["']([^>]*?)>/gi,
    (match, before, src, after) => {
      const newSrc = createAssetUrl(src);
      console.log(`Rewriting script src: "${src}" -> "${newSrc}"`);
      return `<script${before}src="${newSrc}"${after}>`;
    }
  );
  
  // Rewrite CSS @import statements
  modifiedContent = modifiedContent.replace(
    /@import\s+url\s*\(\s*["']([^"']+)["']\s*\)/gi,
    (match, url) => {
      const newUrl = createAssetUrl(url);
      console.log(`Rewriting CSS @import: "${url}" -> "${newUrl}"`);
      return `@import url("${newUrl}")`;
    }
  );
  
  // Rewrite CSS url() functions in style attributes and style tags
  modifiedContent = modifiedContent.replace(
    /url\s*\(\s*["']?([^"']+)["']?\s*\)/gi,
    (match, url) => {
      if (url.startsWith('data:') || url.startsWith('http://') || url.startsWith('https://')) {
        return match; // Don't rewrite data URLs or absolute URLs
      }
      const newUrl = createAssetUrl(url);
      console.log(`Rewriting CSS url(): "${url}" -> "${newUrl}"`);
      return `url("${newUrl}")`;
    }
  );
  
  // Rewrite background-image properties in style attributes
  modifiedContent = modifiedContent.replace(
    /background-image\s*:\s*url\s*\(\s*["']?([^"']+)["']?\s*\)/gi,
    (match, url) => {
      if (url.startsWith('data:') || url.startsWith('http://') || url.startsWith('https://')) {
        return match; // Don't rewrite data URLs or absolute URLs
      }
      const newUrl = createAssetUrl(url);
      console.log(`Rewriting background-image: "${url}" -> "${newUrl}"`);
      return `background-image: url("${newUrl}")`;
    }
  );
  
  // Rewrite source attributes in video/audio elements
  modifiedContent = modifiedContent.replace(
    /<(video|audio)([^>]*?)src\s*=\s*["']([^"']+)["']([^>]*?)>/gi,
    (match, tag, before, src, after) => {
      const newSrc = createAssetUrl(src);
      console.log(`Rewriting ${tag} src: "${src}" -> "${newSrc}"`);
      return `<${tag}${before}src="${newSrc}"${after}>`;
    }
  );
  
  // Rewrite source elements within video/audio
  modifiedContent = modifiedContent.replace(
    /<source([^>]*?)src\s*=\s*["']([^"']+)["']([^>]*?)>/gi,
    (match, before, src, after) => {
      const newSrc = createAssetUrl(src);
      console.log(`Rewriting source src: "${src}" -> "${newSrc}"`);
      return `<source${before}src="${newSrc}"${after}>`;
    }
  );
  
  // Rewrite object data attributes
  modifiedContent = modifiedContent.replace(
    /<object([^>]*?)data\s*=\s*["']([^"']+)["']([^>]*?)>/gi,
    (match, before, data, after) => {
      const newData = createAssetUrl(data);
      console.log(`Rewriting object data: "${data}" -> "${newData}"`);
      return `<object${before}data="${newData}"${after}>`;
    }
  );
  
  // Rewrite embed src attributes
  modifiedContent = modifiedContent.replace(
    /<embed([^>]*?)src\s*=\s*["']([^"']+)["']([^>]*?)>/gi,
    (match, before, src, after) => {
      const newSrc = createAssetUrl(src);
      console.log(`Rewriting embed src: "${src}" -> "${newSrc}"`);
      return `<embed${before}src="${newSrc}"${after}>`;
    }
  );
  
  console.log('URL rewriting completed');
  return modifiedContent;
}

/**
 * Creates a simple asset handler URL for development/testing
 * In a real application, this would point to your backend API
 */
export function createAssetHandlerUrl(packageId: string, filePath: string, baseUrl: string = ''): string {
  const encodedPackageId = encodeURIComponent(packageId);
  const encodedPath = encodeURIComponent(filePath);
  return `${baseUrl}/api/scorm-asset?packageId=${encodedPackageId}&path=${encodedPath}`;
}

/**
 * Extracts all asset URLs from HTML content for debugging
 */
export function extractAssetUrls(htmlContent: string): {
  images: string[];
  stylesheets: string[];
  scripts: string[];
  media: string[];
} {
  const images: string[] = [];
  const stylesheets: string[] = [];
  const scripts: string[] = [];
  const media: string[] = [];
  
  // Extract img src
  const imgMatches = htmlContent.match(/<img[^>]*?src\s*=\s*["']([^"']+)["'][^>]*?>/gi);
  if (imgMatches) {
    imgMatches.forEach(match => {
      const srcMatch = match.match(/src\s*=\s*["']([^"']+)["']/i);
      if (srcMatch && srcMatch[1]) {
        images.push(srcMatch[1]);
      }
    });
  }
  
  // Extract link href (CSS)
  const linkMatches = htmlContent.match(/<link[^>]*?href\s*=\s*["']([^"']+)["'][^>]*?>/gi);
  if (linkMatches) {
    linkMatches.forEach(match => {
      const hrefMatch = match.match(/href\s*=\s*["']([^"']+)["']/i);
      if (hrefMatch && hrefMatch[1]) {
        stylesheets.push(hrefMatch[1]);
      }
    });
  }
  
  // Extract script src
  const scriptMatches = htmlContent.match(/<script[^>]*?src\s*=\s*["']([^"']+)["'][^>]*?>/gi);
  if (scriptMatches) {
    scriptMatches.forEach(match => {
      const srcMatch = match.match(/src\s*=\s*["']([^"']+)["']/i);
      if (srcMatch && srcMatch[1]) {
        scripts.push(srcMatch[1]);
      }
    });
  }
  
  // Extract media elements (video, audio, source)
  const mediaMatches = htmlContent.match(/<(video|audio|source|embed|object)[^>]*?(src|data)\s*=\s*["']([^"']+)["'][^>]*?>/gi);
  if (mediaMatches) {
    mediaMatches.forEach(match => {
      const srcMatch = match.match(/(src|data)\s*=\s*["']([^"']+)["']/i);
      if (srcMatch && srcMatch[2]) {
        media.push(srcMatch[2]);
      }
    });
  }
  
  return {
    images: [...new Set(images)],
    stylesheets: [...new Set(stylesheets)],
    scripts: [...new Set(scripts)],
    media: [...new Set(media)]
  };
} 