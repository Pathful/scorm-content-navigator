import React, { useState, useRef, useEffect, useCallback } from 'react';
import DOMPurify from 'dompurify';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Play, 
  Pause, 
  SkipForward, 
  SkipBack, 
  BookOpen, 
  Clock, 
  CheckCircle2, 
  AlertCircle,
  Menu,
  X,
  FileText
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { SCORMAgainAdapter } from '@/lib/scorm-again-adapter';
import { SCORMManifestParser, type SCORMManifest, type SCORMItem } from '@/lib/scorm-manifest';
import { SCORMPackageManager } from '@/lib/scorm-package-manager';

interface SCORMPlayerProps {
  manifestUrl?: string;
  baseUrl?: string;
  userId?: string;
  courseId?: string;
  packageId?: string;
  className?: string;
}

interface PlayerState {
  isLoading: boolean;
  isPlaying: boolean;
  currentItemIndex: number;
  manifest: SCORMManifest | null;
  playableItems: SCORMItem[];
  showSidebar: boolean;
  sessionTime: number;
  lessonStatus: string;
  score: string;
  apiStatus: 'disconnected' | 'connected' | 'active';
  lastApiCall?: string;
}

export function SCORMPlayer({ 
  manifestUrl = '/demo/imsmanifest.xml',
  baseUrl = '/demo/',
  userId = 'demo_user',
  courseId = 'demo_course',
  packageId,
  className 
}: SCORMPlayerProps) {
  const { toast } = useToast();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const scormAdapterRef = useRef<SCORMAgainAdapter>();
  const sessionTimerRef = useRef<NodeJS.Timeout>();

  const [state, setState] = useState<PlayerState>({
    isLoading: true,
    isPlaying: false,
    currentItemIndex: 0,
    manifest: null,
    playableItems: [],
    showSidebar: true,
    sessionTime: 0,
    lessonStatus: 'not attempted',
    score: '',
    apiStatus: 'disconnected'
  });

  // Initialize SCORM-Again adapter
  useEffect(() => {
    scormAdapterRef.current = new SCORMAgainAdapter({
      userId,
      courseId,
      autocommit: true,
      autocommitSeconds: 10,
      logLevel: 4
    });
    
    // Make APIs globally available
    scormAdapterRef.current.makeAPIsGlobal();
    
    // Get the APIs for wrapping
    const API = scormAdapterRef.current.getSCORM12API();
    const API_1484_11 = scormAdapterRef.current.getSCORM2004API();
    
    // Wrap API methods to track activity
    const wrappedAPI = {
      LMSInitialize: (param: string) => {
        console.log('SCORM: LMSInitialize called');
        setState(prev => ({ ...prev, apiStatus: 'active', lastApiCall: 'LMSInitialize' }));
        return API.lmsInitialize(param);
      },
      LMSFinish: (param: string) => {
        console.log('SCORM: LMSFinish called');
        setState(prev => ({ ...prev, apiStatus: 'connected', lastApiCall: 'LMSFinish' }));
        return API.lmsFinish(param);
      },
      LMSGetValue: (element: string) => {
        console.log(`SCORM: LMSGetValue("${element}")`);
        setState(prev => ({ ...prev, apiStatus: 'active', lastApiCall: `LMSGetValue: ${element}` }));
        const value = API.lmsGetValue(element);
        
        // Update UI based on values
        if (element === 'cmi.core.lesson_status') {
          setState(prev => ({ ...prev, lessonStatus: value }));
        } else if (element === 'cmi.core.score.raw') {
          setState(prev => ({ ...prev, score: value }));
        }
        
        return value;
      },
      LMSSetValue: (element: string, value: string) => {
        console.log(`SCORM: LMSSetValue("${element}", "${value}")`);
        setState(prev => ({ ...prev, apiStatus: 'active', lastApiCall: `LMSSetValue: ${element}` }));
        
        // Update UI based on values
        if (element === 'cmi.core.lesson_status') {
          setState(prev => ({ ...prev, lessonStatus: value }));
        } else if (element === 'cmi.core.score.raw') {
          setState(prev => ({ ...prev, score: value }));
        }
        
        return API.lmsSetValue(element, value);
      },
      LMSCommit: (param: string) => {
        console.log('SCORM: LMSCommit called');
        setState(prev => ({ ...prev, lastApiCall: 'LMSCommit' }));
        return API.lmsCommit(param);
      },
      LMSGetLastError: () => API.lmsGetLastError(),
      LMSGetErrorString: (errorCode: string) => API.lmsGetErrorString(errorCode),
      LMSGetDiagnostic: (errorCode: string) => API.lmsGetDiagnostic(errorCode)
    };
    
    // Make APIs globally available immediately
    (window as any).API = wrappedAPI;
    (window as any).API_1484_11 = API_1484_11;
    
    // Also expose common SCORM API discovery functions
    (window as any).findAPI = (win: any) => {
      let findAttempts = 0;
      while ((win.API == null) && (win.parent != null) && (win.parent != win)) {
        findAttempts++;
        if (findAttempts > 7) {
          console.log("SCORM API not found after 7 attempts");
          return null;
        }
        win = win.parent;
      }
      return win.API;
    };
    
    (window as any).getAPI = () => {
      return (window as any).API || (window as any).findAPI(window);
    };

    console.log('SCORM APIs initialized and available globally');

    loadManifest();

    return () => {
      if (sessionTimerRef.current) {
        clearInterval(sessionTimerRef.current);
      }
    };
  }, [manifestUrl, userId, courseId]);

  // Session timer
  useEffect(() => {
    if (state.isPlaying) {
      sessionTimerRef.current = setInterval(() => {
        setState(prev => ({ ...prev, sessionTime: prev.sessionTime + 1 }));
      }, 1000);
    } else {
      if (sessionTimerRef.current) {
        clearInterval(sessionTimerRef.current);
        sessionTimerRef.current = undefined;
      }
    }

    return () => {
      if (sessionTimerRef.current) {
        clearInterval(sessionTimerRef.current);
      }
    };
  }, [state.isPlaying]);

  const loadManifest = async () => {
    try {
      setState(prev => ({ ...prev, isLoading: true }));
      
      let manifest: SCORMManifest;
      
      // If packageId is provided, load the actual uploaded package
      if (packageId) {
        const scormPackage = await SCORMPackageManager.getPackageById(packageId);
        if (!scormPackage) {
          throw new Error(`Package with ID ${packageId} not found`);
        }
        manifest = scormPackage.manifest;
      } else {
        // For demo purposes, create a sample manifest
        manifest = createDemoManifest();
      }
      
      const resolvedManifest = SCORMManifestParser.resolveItemResources(manifest);
      const playableItems = SCORMManifestParser.getPlayableItems(resolvedManifest);

      setState(prev => ({
        ...prev,
        manifest: resolvedManifest,
        playableItems,
        isLoading: false
      }));

      if (playableItems.length > 0) {
        loadSCO(0);
      }

    } catch (error) {
      console.error('Error loading manifest:', error);
      toast({
        title: "Error Loading Course",
        description: error instanceof Error ? error.message : "Failed to load the SCORM content.",
        variant: "destructive"
      });
      setState(prev => ({ ...prev, isLoading: false }));
    }
  };

  const createDemoManifest = (): SCORMManifest => {
    return {
      identifier: "demo_course",
      version: "1.0",
      title: "Demo SCORM Course",
      defaultOrganization: "demo_org",
      organizations: [{
        identifier: "demo_org",
        title: "Course Organization",
        items: [
          {
            identifier: "lesson1",
            title: "Introduction to SCORM",
            href: "lesson1.html",
            isVisible: true,
            children: []
          },
          {
            identifier: "lesson2", 
            title: "SCORM API Implementation",
            href: "lesson2.html",
            isVisible: true,
            children: []
          },
          {
            identifier: "quiz1",
            title: "Knowledge Check",
            href: "quiz.html",
            isVisible: true,
            children: []
          }
        ]
      }],
      resources: [
        {
          identifier: "lesson1",
          type: "webcontent",
          href: "lesson1.html",
          files: ["lesson1.html"]
        },
        {
          identifier: "lesson2",
          type: "webcontent", 
          href: "lesson2.html",
          files: ["lesson2.html"]
        },
        {
          identifier: "quiz1",
          type: "webcontent",
          href: "quiz.html", 
          files: ["quiz.html"]
        }
      ]
    };
  };

  const processHtmlAssets = async (html: string, packageId?: string): Promise<string> => {
    if (!packageId) {
      console.log('No package ID provided, skipping asset processing');
      return html;
    }

    console.log('Processing HTML assets for package:', packageId);
    
    // Create a map to store blob URLs for assets
    const assetBlobUrls = new Map<string, string>();
    
    // Function to resolve asset path and create blob URL
    const resolveAsset = async (assetPath: string): Promise<string> => {
      // Skip if already processed
      if (assetBlobUrls.has(assetPath)) {
        return assetBlobUrls.get(assetPath)!;
      }
      
      // Skip external URLs
      if (assetPath.startsWith('http://') || assetPath.startsWith('https://') || assetPath.startsWith('//')) {
        console.log('Skipping external asset:', assetPath);
        return assetPath;
      }
      
      // Clean up the path - handle various path formats
      let cleanPath = assetPath;
      
      // Remove leading slashes and normalize
      cleanPath = cleanPath.replace(/^\/+/, '');
      
      // Handle relative paths that might be relative to the current HTML file
      if (cleanPath.startsWith('./')) {
        cleanPath = cleanPath.substring(2);
      }
      
      console.log('Resolving asset:', assetPath, '->', cleanPath);
      
      try {
        const assetBlob = await SCORMPackageManager.getPackageFile(packageId, cleanPath);
        if (assetBlob) {
          // Create blob URL with proper MIME type
          let mimeType = 'application/octet-stream';
          
          // Set appropriate MIME types based on file extension
          if (cleanPath.toLowerCase().endsWith('.css')) {
            mimeType = 'text/css';
          } else if (cleanPath.toLowerCase().endsWith('.js')) {
            mimeType = 'application/javascript';
          } else if (cleanPath.toLowerCase().endsWith('.html') || cleanPath.toLowerCase().endsWith('.htm')) {
            mimeType = 'text/html';
          } else if (cleanPath.toLowerCase().endsWith('.png')) {
            mimeType = 'image/png';
          } else if (cleanPath.toLowerCase().endsWith('.jpg') || cleanPath.toLowerCase().endsWith('.jpeg')) {
            mimeType = 'image/jpeg';
          } else if (cleanPath.toLowerCase().endsWith('.gif')) {
            mimeType = 'image/gif';
          } else if (cleanPath.toLowerCase().endsWith('.svg')) {
            mimeType = 'image/svg+xml';
          }
          
          // Create a new blob with the correct MIME type
          const typedBlob = new Blob([assetBlob], { type: mimeType });
          const blobUrl = URL.createObjectURL(typedBlob);
          
          assetBlobUrls.set(assetPath, blobUrl);
          console.log('✓ Created blob URL for asset:', assetPath, '->', blobUrl, `(${mimeType})`);
          return blobUrl;
        } else {
          console.warn('⚠️ Asset not found in package:', cleanPath);
          
          // Try alternative paths
          const alternativePaths = [
            cleanPath.replace(/^\.\//, ''), // Remove ./ prefix
            `./${cleanPath}`, // Add ./ prefix
            `/${cleanPath}`, // Add / prefix
            cleanPath.toLowerCase(), // Try lowercase
            cleanPath.replace(/\\/g, '/'), // Convert backslashes
            decodeURIComponent(cleanPath) // Handle URL encoding
          ];
          
          for (const altPath of alternativePaths) {
            if (altPath !== cleanPath) {
              console.log('Trying alternative path:', altPath);
              const altBlob = await SCORMPackageManager.getPackageFile(packageId, altPath);
              if (altBlob) {
                let mimeType = 'application/octet-stream';
                if (altPath.toLowerCase().endsWith('.css')) {
                  mimeType = 'text/css';
                } else if (altPath.toLowerCase().endsWith('.js')) {
                  mimeType = 'application/javascript';
                }
                
                const typedBlob = new Blob([altBlob], { type: mimeType });
                const blobUrl = URL.createObjectURL(typedBlob);
                assetBlobUrls.set(assetPath, blobUrl);
                console.log('✓ Found asset via alternative path:', altPath, '->', blobUrl);
                return blobUrl;
              }
            }
          }
          
          return assetPath; // Return original path as fallback
        }
      } catch (error) {
        console.error('❌ Error resolving asset:', assetPath, error);
        return assetPath; // Return original path as fallback
      }
    };
    
    // Process CSS links - find all matches first, then process them
    const cssLinkRegex = /<link[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi;
    const cssMatches = Array.from(html.matchAll(cssLinkRegex));
    let processedHtml = html;
    
    for (const match of cssMatches) {
      const originalMatch = match[0];
      const href = match[1];
      const resolvedHref = await resolveAsset(href);
      processedHtml = processedHtml.replace(originalMatch, originalMatch.replace(href, resolvedHref));
    }
    
    // Process script src attributes
    const scriptSrcRegex = /<script[^>]*src\s*=\s*["']([^"']+)["'][^>]*>/gi;
    const scriptMatches = Array.from(processedHtml.matchAll(scriptSrcRegex));
    
    for (const match of scriptMatches) {
      const originalMatch = match[0];
      const src = match[1];
      const resolvedSrc = await resolveAsset(src);
      processedHtml = processedHtml.replace(originalMatch, originalMatch.replace(src, resolvedSrc));
    }
    
    // Process img src attributes
    const imgSrcRegex = /<img[^>]*src\s*=\s*["']([^"']+)["'][^>]*>/gi;
    const imgMatches = Array.from(processedHtml.matchAll(imgSrcRegex));
    
    for (const match of imgMatches) {
      const originalMatch = match[0];
      const src = match[1];
      const resolvedSrc = await resolveAsset(src);
      processedHtml = processedHtml.replace(originalMatch, originalMatch.replace(src, resolvedSrc));
    }
    
    // Process background images in style attributes
    const styleBgRegex = /background\s*:\s*url\s*\(\s*["']?([^"']+)["']?\s*\)/gi;
    const bgMatches = Array.from(processedHtml.matchAll(styleBgRegex));
    
    for (const match of bgMatches) {
      const originalMatch = match[0];
      const url = match[1];
      const resolvedUrl = await resolveAsset(url);
      processedHtml = processedHtml.replace(originalMatch, originalMatch.replace(url, resolvedUrl));
    }
    
    // Process any other url() references in CSS
    const cssUrlRegex = /url\s*\(\s*["']?([^"']+)["']?\s*\)/gi;
    const urlMatches = Array.from(processedHtml.matchAll(cssUrlRegex));
    
    for (const match of urlMatches) {
      const originalMatch = match[0];
      const url = match[1];
      const resolvedUrl = await resolveAsset(url);
      processedHtml = processedHtml.replace(originalMatch, originalMatch.replace(url, resolvedUrl));
    }
    
    console.log(`Processed ${assetBlobUrls.size} assets for HTML content`);
    return processedHtml;
  };

  const loadSCO = useCallback(async (itemIndex: number) => {
    if (!state.playableItems[itemIndex] || !iframeRef.current) return;

    const item = state.playableItems[itemIndex];
    
    try {
      let contentUrl: string;
      
      // If packageId is provided, load actual content from uploaded package
      if (packageId) {
        console.log('Loading SCO for item:', item);
        console.log('Looking for file:', item.href);
        
        // Try multiple possible file paths
        const possiblePaths = [
          item.href,
          item.href.replace(/^\/+/, ''), // Remove leading slashes
          `/${item.href}`, // Add leading slash
          item.href.toLowerCase(), // Try lowercase
          item.href.replace('.html', '.htm'), // Try .htm extension
          item.href.replace('.htm', '.html'), // Try .html extension
          // Handle common SCORM path patterns
          `scormcontent/${item.href}`, // Common subfolder
          `content/${item.href}`, // Another common subfolder
          `shared/${item.href}`, // Shared assets folder
          item.href.replace(/\\/g, '/'), // Convert backslashes to forward slashes
          decodeURIComponent(item.href) // Handle URL-encoded paths
        ];
        
        let contentBlob: Blob | null = null;
        let foundPath = '';
        
        for (const path of possiblePaths) {
          console.log('Trying path:', path);
          contentBlob = await SCORMPackageManager.getPackageFile(packageId, path);
          if (contentBlob) {
            foundPath = path;
            console.log('Found content at path:', path);
            break;
          }
        }
        
        if (contentBlob) {
          // Check the blob content type and size
          console.log('Content blob type:', contentBlob.type);
          console.log('Content blob size:', contentBlob.size);
          
          // For HTML files, let's read the content first to ensure it's valid
          if (item.href.toLowerCase().includes('.html') || item.href.toLowerCase().includes('.htm')) {
            const text = await contentBlob.text();
            console.log('HTML content preview:', text.substring(0, 500));
            
            // Create a new blob with proper content type
            const htmlBlob = new Blob([text], { type: 'text/html; charset=utf-8' });
            contentUrl = URL.createObjectURL(htmlBlob);
          } else {
            contentUrl = URL.createObjectURL(contentBlob);
          }
        } else {
          console.error('Content file not found. Tried paths:', possiblePaths);
          
          // Special check for index_lms.html
          if (possiblePaths.some(p => p.includes('index_lms.html'))) {
            console.error('Note: The package is looking for "index_lms.html" but it was not found.');
            console.log('This might be a path issue in your SCORM package.');
          }
          
          // Let's debug what files are actually in the package
          const debugInfo = await SCORMPackageManager.getPackageDebugInfo(packageId);
          console.log('Available files in package:', debugInfo.fileList);
          
          // Check if there's any file with index_lms in the name
          const indexLmsFiles = debugInfo.fileList.filter(f => 
            f.toLowerCase().includes('index_lms')
          );
          if (indexLmsFiles.length > 0) {
            console.log('Found files with "index_lms" in name:', indexLmsFiles);
            console.log('The manifest is pointing to:', item.href);
            console.log('You may need to update your manifest to point to:', indexLmsFiles[0]);
          }
          
          // Also show potential HTML entry files
          const htmlFiles = debugInfo.fileList.filter(f => 
            f.toLowerCase().endsWith('.html') || f.toLowerCase().endsWith('.htm')
          );
          if (htmlFiles.length > 0) {
            console.log('Available HTML files in package:', htmlFiles);
          }
          
          // SCORM package structure tip
          console.log('\n📦 SCORM Package Structure Tip:');
          console.log('Your imsmanifest.xml should reference the exact path of your launch file.');
          console.log('Common entry point names include: index.html, start.html, launch.html, index_lms.html');
          console.log('Make sure the <resource> element in your manifest has the correct href attribute.');
          
          throw new Error(`Content file "${item.href}" not found in package. The manifest may be pointing to the wrong file. Check the browser console for available files.`);
        }
      } else {
        // Create demo content for demo mode
        const demoContent = createDemoContent(item);
        
        // Validate content before creating blob URL
        if (!validateContentSecurity(demoContent)) {
          console.error('Security validation failed for content');
          return;
        }
        
        const blob = new Blob([demoContent], { type: 'text/html' });
        contentUrl = URL.createObjectURL(blob);
      }

      // Initialize SCORM session
      if (scormAdapterRef.current) {
        scormAdapterRef.current.getSCORM12API().lmsInitialize('');
        scormAdapterRef.current.updateStudentData({
          lessonLocation: item.identifier,
          lessonStatus: 'incomplete'
        });
      }

      setState(prev => ({
        ...prev,
        currentItemIndex: itemIndex,
        isPlaying: true,
        lessonStatus: 'incomplete'
      }));

      // Enhanced SCORM API injection script for standards test files
      const scormApiFinderScript = `
        <script>
          console.log("SCORM API Finder starting...");
          
          // Immediately try to get APIs from parent
          if (window.parent && window.parent.API) {
            window.API = window.parent.API;
            console.log("✓ SCORM 1.2 API found in parent window");
          }
          if (window.parent && window.parent.API_1484_11) {
            window.API_1484_11 = window.parent.API_1484_11;
            console.log("✓ SCORM 2004 API found in parent window");
          }
          
          // Standard SCORM API discovery function
          function findAPI(win) {
            var findAttempts = 0;
            while ((win.API == null) && (win.parent != null) && (win.parent != win)) {
              findAttempts++;
              if (findAttempts > 7) {
                console.log("❌ SCORM API not found after 7 attempts");
                return null;
              }
              win = win.parent;
            }
            return win.API;
          }
          
          // Enhanced API discovery for standards test files
          function discoverAPI() {
            // Method 1: Direct parent access
            if (window.parent && window.parent.API) {
              window.API = window.parent.API;
              console.log("✓ API found via direct parent access");
              return true;
            }
            
            // Method 2: Standard findAPI
            const foundAPI = findAPI(window);
            if (foundAPI) {
              window.API = foundAPI;
              console.log("✓ API found via findAPI");
              return true;
            }
            
            // Method 3: Check for getAPI function
            if (window.parent && window.parent.getAPI) {
              window.API = window.parent.getAPI();
              console.log("✓ API found via getAPI");
              return true;
            }
            
            console.log("❌ No SCORM API found");
            return false;
          }
          
          // Expose getAPI function that some content uses
          window.getAPI = function() {
            return window.API || findAPI(window);
          };
          
          // Try to discover API immediately
          if (discoverAPI()) {
            console.log("✓ SCORM API successfully discovered");
            
            // Test API functionality
            if (window.API && window.API.LMSInitialize) {
              try {
                const initResult = window.API.LMSInitialize('');
                console.log("✓ API.LMSInitialize test result:", initResult);
              } catch (e) {
                console.error("❌ API.LMSInitialize test failed:", e);
              }
            }
          } else {
            console.log("⚠️ SCORM API not found - content may not function properly");
          }
          
          console.log("SCORM API Finder initialization complete");
        </script>
      `;
      
      // Enhanced content injection for SCORM standards test files
      if (contentUrl.startsWith('blob:')) {
        // Read the original content
        fetch(contentUrl)
          .then(response => response.text())
          .then(async html => {
            console.log('Processing SCORM content for API injection and asset resolution...');
            
            // Check if content already has SCORM API references
            const hasScormAPI = html.includes('API') || html.includes('LMS') || html.includes('SCORM');
            console.log('Content has SCORM API references:', hasScormAPI);
            
            // Process HTML to resolve asset paths
            let processedHtml = await processHtmlAssets(html, packageId);
            
            // Debug: Log the processed HTML to see what's happening
            console.log('Processed HTML preview (first 1000 chars):', processedHtml.substring(0, 1000));
            
            // Check for any remaining blob URL issues
            const blobUrlMatches = processedHtml.match(/blob:\/\/[^"'\s]+/g);
            if (blobUrlMatches) {
              console.log('Found blob URLs in processed HTML:', blobUrlMatches);
            }
            
            // Pre-injection script that runs before anything else
            const preInjectionScript = `
              <script>
                // Pre-injection: Set up API immediately when script loads
                console.log("🚀 Pre-injecting SCORM API...");
                
                // Make API available immediately
                if (window.parent && window.parent.API) {
                  window.API = window.parent.API;
                  window.API_1484_11 = window.parent.API_1484_11;
                  console.log("✓ Pre-injection: API available immediately");
                }
                
                // Also set up standard SCORM functions
                window.findAPI = function(win) {
                  var findAttempts = 0;
                  while ((win.API == null) && (win.parent != null) && (win.parent != win)) {
                    findAttempts++;
                    if (findAttempts > 7) {
                      console.log("❌ SCORM API not found after 7 attempts");
                      return null;
                    }
                    win = win.parent;
                  }
                  return win.API;
                };
                
                window.getAPI = function() {
                  return window.API || window.findAPI(window);
                };
                
                // Create stub functions for common missing functions in SCORM content
                // These need to be defined BEFORE any content scripts run
                window.AddLicenseInfo = function() {
                  console.log("📄 AddLicenseInfo called (stub function)");
                  return true;
                };
                
                window.ShowLicenseInfo = function() {
                  console.log("📄 ShowLicenseInfo called (stub function)");
                  return true;
                };
                
                window.HideLicenseInfo = function() {
                  console.log("📄 HideLicenseInfo called (stub function)");
                  return true;
                };
                
                window.ShowHelp = function() {
                  console.log("❓ ShowHelp called (stub function)");
                  return true;
                };
                
                window.HideHelp = function() {
                  console.log("❓ HideHelp called (stub function)");
                  return true;
                };
                
                window.ShowGlossary = function() {
                  console.log("📚 ShowGlossary called (stub function)");
                  return true;
                };
                
                window.HideGlossary = function() {
                  console.log("📚 HideGlossary called (stub function)");
                  return true;
                };
                
                window.ShowNotes = function() {
                  console.log("📝 ShowNotes called (stub function)");
                  return true;
                };
                
                window.HideNotes = function() {
                  console.log("📝 HideNotes called (stub function)");
                  return true;
                };
                
                window.PrintPage = function() {
                  console.log("🖨️ PrintPage called (stub function)");
                  window.print();
                  return true;
                };
                
                window.ExitCourse = function() {
                  console.log("🚪 ExitCourse called (stub function)");
                  if (window.API && window.API.LMSFinish) {
                    window.API.LMSFinish('');
                  }
                  return true;
                };
                
                window.NextPage = function() {
                  console.log("➡️ NextPage called (stub function)");
                  return true;
                };
                
                window.PreviousPage = function() {
                  console.log("⬅️ PreviousPage called (stub function)");
                  return true;
                };
                
                window.GoToPage = function(pageNumber) {
                  console.log("📍 GoToPage called with page:", pageNumber, "(stub function)");
                  return true;
                };
                
                window.SubmitQuiz = function() {
                  console.log("📝 SubmitQuiz called (stub function)");
                  return true;
                };
                
                window.ResetQuiz = function() {
                  console.log("🔄 ResetQuiz called (stub function)");
                  return true;
                };
                
                window.ShowFeedback = function() {
                  console.log("💬 ShowFeedback called (stub function)");
                  return true;
                };
                
                window.HideFeedback = function() {
                  console.log("💬 HideFeedback called (stub function)");
                  return true;
                };
                
                // Additional common SCORM content functions
                window.StartCourse = function() {
                  console.log("🚀 StartCourse called (stub function)");
                  return true;
                };
                
                window.EndCourse = function() {
                  console.log("🏁 EndCourse called (stub function)");
                  if (window.API && window.API.LMSFinish) {
                    window.API.LMSFinish('');
                  }
                  return true;
                };
                
                window.PauseCourse = function() {
                  console.log("⏸️ PauseCourse called (stub function)");
                  return true;
                };
                
                window.ResumeCourse = function() {
                  console.log("▶️ ResumeCourse called (stub function)");
                  return true;
                };
                
                window.ShowMenu = function() {
                  console.log("📋 ShowMenu called (stub function)");
                  return true;
                };
                
                window.HideMenu = function() {
                  console.log("📋 HideMenu called (stub function)");
                  return true;
                };
                
                window.ShowObjectives = function() {
                  console.log("🎯 ShowObjectives called (stub function)");
                  return true;
                };
                
                window.HideObjectives = function() {
                  console.log("🎯 HideObjectives called (stub function)");
                  return true;
                };
                
                window.ShowBookmarks = function() {
                  console.log("🔖 ShowBookmarks called (stub function)");
                  return true;
                };
                
                window.HideBookmarks = function() {
                  console.log("🔖 HideBookmarks called (stub function)");
                  return true;
                };
                
                window.ShowSearch = function() {
                  console.log("🔍 ShowSearch called (stub function)");
                  return true;
                };
                
                window.HideSearch = function() {
                  console.log("🔍 HideSearch called (stub function)");
                  return true;
                };
                
                // Handle any other undefined functions with a global error handler
                window.addEventListener('error', function(e) {
                  if (e.error && e.error.message && e.error.message.includes('is not defined')) {
                    const functionName = e.error.message.match(/([A-Za-z_][A-Za-z0-9_]*) is not defined/);
                    if (functionName && functionName[1] && !window[functionName[1]]) {
                      console.log('Creating stub function for: ' + functionName[1]);
                      window[functionName[1]] = function() {
                        console.log(functionName[1] + ' called (auto-generated stub function)');
                        return true;
                      };
                    }
                  }
                });
                
                console.log("✓ Pre-injection complete with all stub functions");
              </script>
            `;
            
            // Inject the SCORM API finder script at the beginning of the body
            let modifiedHtml = processedHtml;
            
            // Try multiple injection points for better compatibility
            if (processedHtml.includes('<body')) {
              modifiedHtml = processedHtml.replace(
                /<body([^>]*)>/i,
                `<body$1>${preInjectionScript}${scormApiFinderScript}`
              );
            } else if (processedHtml.includes('<head')) {
              modifiedHtml = processedHtml.replace(
                /<head([^>]*)>/i,
                `<head$1>${preInjectionScript}${scormApiFinderScript}`
              );
            } else {
              // If no body or head tag, inject at the beginning
              modifiedHtml = preInjectionScript + scormApiFinderScript + processedHtml;
            }
            
            // Enhanced API discovery for standards test files
            const aggressiveApiScript = `
              <script>
                // Enhanced API discovery for standards test files
                (function() {
                  console.log("🔍 Starting enhanced SCORM API discovery...");
                  
                  function enhancedFindAPI() {
                    // Method 1: Direct parent access
                    if (window.parent && window.parent.API) {
                      window.API = window.parent.API;
                      window.API_1484_11 = window.parent.API_1484_11;
                      console.log("✓ Enhanced: API found in parent");
                      return true;
                    }
                    
                    // Method 2: Parent's parent
                    if (window.parent && window.parent.parent && window.parent.parent.API) {
                      window.API = window.parent.parent.API;
                      window.API_1484_11 = window.parent.parent.API_1484_11;
                      console.log("✓ Enhanced: API found in parent's parent");
                      return true;
                    }
                    
                    // Method 3: Top window
                    if (window.top && window.top.API) {
                      window.API = window.top.API;
                      window.API_1484_11 = window.top.API_1484_11;
                      console.log("✓ Enhanced: API found in top window");
                      return true;
                    }
                    
                    // Method 4: Check for getAPI function
                    if (window.parent && window.parent.getAPI) {
                      window.API = window.parent.getAPI();
                      console.log("✓ Enhanced: API found via getAPI");
                      return true;
                    }
                    
                    return false;
                  }
                  
                  // Try immediately
                  if (enhancedFindAPI()) {
                    console.log("✓ Enhanced API discovery successful");
                    
                    // Test the API
                    if (window.API && window.API.LMSInitialize) {
                      try {
                        const result = window.API.LMSInitialize('');
                        console.log("✓ API test successful:", result);
                      } catch (e) {
                        console.error("❌ API test failed:", e);
                      }
                    }
                  } else {
                    console.log("⚠️ Enhanced API discovery failed, retrying...");
                    // Retry with multiple delays
                    setTimeout(enhancedFindAPI, 50);
                    setTimeout(enhancedFindAPI, 200);
                    setTimeout(enhancedFindAPI, 500);
                    setTimeout(enhancedFindAPI, 1000);
                  }
                  
                  // Also expose standard SCORM functions
                  window.findAPI = function(win) {
                    var findAttempts = 0;
                    while ((win.API == null) && (win.parent != null) && (win.parent != win)) {
                      findAttempts++;
                      if (findAttempts > 7) {
                        console.log("❌ SCORM API not found after 7 attempts");
                        return null;
                      }
                      win = win.parent;
                    }
                    return win.API;
                  };
                  
                  window.getAPI = function() {
                    return window.API || window.findAPI(window);
                  };
                  
                })();
              </script>
            `;
            
            // Add the aggressive script
            modifiedHtml = modifiedHtml.replace(
              /<\/body>/i,
              `${aggressiveApiScript}</body>`
            );
            
            // Create a new blob with the modified content
            const modifiedBlob = new Blob([modifiedHtml], { type: 'text/html; charset=utf-8' });
            const modifiedUrl = URL.createObjectURL(modifiedBlob);
            
            console.log('Modified content created, loading into iframe...');
            console.log('Modified URL:', modifiedUrl);
            
            // Add a small delay to ensure blob URLs are properly established
            setTimeout(() => {
              // Load the modified content
              if (iframeRef.current) {
                iframeRef.current.src = modifiedUrl;
                console.log('✓ Iframe src set to:', modifiedUrl);
              }
            }, 100);
            
            // Clean up the original blob URL
            URL.revokeObjectURL(contentUrl);
          })
          .catch(error => {
            console.error('Failed to inject SCORM API finder:', error);
            // Fallback to original URL
            if (iframeRef.current) {
              iframeRef.current.src = contentUrl;
            }
          });
      } else {
        // For non-blob URLs, load directly
        iframeRef.current.src = contentUrl;
      }
      
      // Immediate API injection for standards test files
      iframeRef.current.onload = () => {
        console.log('Iframe loaded successfully');
        console.log('Iframe content window:', iframeRef.current?.contentWindow);
        console.log('Iframe src:', iframeRef.current?.src);
        
        // Check for any console errors in the iframe
        try {
          if (iframeRef.current?.contentWindow) {
            const originalConsoleError = (iframeRef.current.contentWindow as any).console?.error;
            if (originalConsoleError) {
              (iframeRef.current.contentWindow as any).console.error = (...args: any[]) => {
                console.log('Iframe console error:', ...args);
                originalConsoleError.apply((iframeRef.current?.contentWindow as any).console, args);
              };
            }
          }
        } catch (e) {
          console.log('Could not override iframe console.error:', e);
        }
        
        // Immediate injection attempt
        const injectAPI = () => {
          if (iframeRef.current?.contentWindow) {
            console.log('Injecting SCORM API immediately...');
            
            try {
              // Immediate API injection
              (iframeRef.current.contentWindow as any).API = (window as any).API;
              (iframeRef.current.contentWindow as any).API_1484_11 = (window as any).API_1484_11;
              (iframeRef.current.contentWindow as any).findAPI = (window as any).findAPI;
              (iframeRef.current.contentWindow as any).getAPI = (window as any).getAPI;
              
              console.log('✓ SCORM APIs injected immediately');
              console.log('API available:', !!(iframeRef.current.contentWindow as any).API);
              console.log('API_1484_11 available:', !!(iframeRef.current.contentWindow as any).API_1484_11);
              
              // Test API immediately
              const testApi = (iframeRef.current.contentWindow as any).API;
              if (testApi && testApi.LMSInitialize) {
                console.log('✓ API test successful');
                setState(prev => ({ ...prev, apiStatus: 'connected' }));
              } else {
                console.warn('⚠️ API injection may have failed');
                setState(prev => ({ ...prev, apiStatus: 'disconnected' }));
              }
              
            } catch (e) {
              console.error('❌ Failed to inject SCORM API:', e);
              setState(prev => ({ ...prev, apiStatus: 'disconnected' }));
            }
          }
        };
        
        // Try immediate injection
        injectAPI();
        
        // Also try with a small delay as backup
        setTimeout(injectAPI, 100);
        setTimeout(injectAPI, 500);
        setTimeout(injectAPI, 1000);
      };
      
      // Add error handling for iframe
      iframeRef.current.onerror = (error) => {
        console.error('Iframe error:', error);
      };

      toast({
        title: "Loading Content",
        description: `Now playing: ${item.title}`,
        action: (
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => {
              testSCORMConnection();
              toast({
                title: "SCORM Test Complete",
                description: "Check the browser console for detailed results"
              });
            }}
          >
            Test SCORM
          </Button>
        )
      });
      
    } catch (error) {
      console.error('Error loading SCO:', error);
      toast({
        title: "Error Loading Content",
        description: error instanceof Error ? error.message : "Failed to load content",
        variant: "destructive"
      });
    }
  }, [state.playableItems, packageId, toast]);

  const validateContentSecurity = (content: string): boolean => {
    // Basic security checks
    const suspiciousPatterns = [
      /<script[^>]*src\s*=\s*["'][^"']*["']/gi,
      /javascript\s*:/gi,
      /data\s*:\s*text\/html/gi,
      /vbscript\s*:/gi
    ];
    
    return !suspiciousPatterns.some(pattern => pattern.test(content));
  };

  const createDemoContent = (item: SCORMItem): string => {
    // Sanitize the title to prevent XSS
    const sanitizedTitle = DOMPurify.sanitize(item.title, { 
      ALLOWED_TAGS: [], 
      ALLOWED_ATTR: [] 
    });
    
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <title>${sanitizedTitle}</title>
        <style>
            body { 
                font-family: system-ui, -apple-system, sans-serif; 
                padding: 40px; 
                line-height: 1.6;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                min-height: 100vh;
                margin: 0;
            }
            .content {
                background: rgba(255,255,255,0.1);
                padding: 30px;
                border-radius: 15px;
                backdrop-filter: blur(10px);
                max-width: 800px;
                margin: 0 auto;
            }
            .complete-btn {
                background: #4CAF50;
                color: white;
                border: none;
                padding: 12px 24px;
                border-radius: 8px;
                cursor: pointer;
                font-size: 16px;
                margin-top: 20px;
            }
            .complete-btn:hover {
                background: #45a049;
            }
            .progress-indicator {
                background: rgba(255,255,255,0.2);
                height: 6px;
                border-radius: 3px;
                margin: 20px 0;
            }
            .progress-bar {
                background: #4CAF50;
                height: 100%;
                border-radius: 3px;
                width: 0%;
                transition: width 0.3s;
            }
        </style>
    </head>
    <body>
        <div class="content">
            <h1>${sanitizedTitle}</h1>
            <div class="progress-indicator">
                <div id="progressBar" class="progress-bar"></div>
            </div>
            <p>Welcome to this SCORM demonstration. This content is communicating with the SCORM API.</p>
            <p><strong>Current Status:</strong> <span id="status">Incomplete</span></p>
            <p><strong>Session Time:</strong> <span id="sessionTime">00:00:00</span></p>
            
            <h2>Learning Content</h2>
            <p>This is a sample SCORM content object that demonstrates:</p>
            <ul>
                <li>SCORM API communication</li>
                <li>Progress tracking</li>
                <li>Score reporting</li>
                <li>Session management</li>
            </ul>
            
            <button class="complete-btn" onclick="completeLesson()">Mark as Complete</button>
        </div>

        <script>
            let startTime = new Date();
            let progress = 0;
            
            function updateProgress() {
                progress += 10;
                document.getElementById('progressBar').style.width = progress + '%';
                
                if (window.API) {
                    window.API.LMSSetValue('cmi.core.score.raw', progress.toString());
                    window.API.LMSCommit('');
                }
            }
            
            function updateSessionTime() {
                const elapsed = Math.floor((new Date() - startTime) / 1000);
                const hours = Math.floor(elapsed / 3600).toString().padStart(2, '0');
                const minutes = Math.floor((elapsed % 3600) / 60).toString().padStart(2, '0');
                const seconds = (elapsed % 60).toString().padStart(2, '0');
                
                document.getElementById('sessionTime').textContent = hours + ':' + minutes + ':' + seconds;
                
                if (window.API) {
                    window.API.LMSSetValue('cmi.core.session_time', hours + ':' + minutes + ':' + seconds);
                }
            }
            
            function completeLesson() {
                if (window.API) {
                    window.API.LMSSetValue('cmi.core.lesson_status', 'completed');
                    window.API.LMSSetValue('cmi.core.score.raw', '100');
                    window.API.LMSCommit('');
                    window.API.LMSFinish('');
                }
                
                document.getElementById('status').textContent = 'Completed';
                document.getElementById('progressBar').style.width = '100%';
                alert('Lesson completed successfully!');
            }
            
            // Initialize SCORM
            if (window.API) {
                window.API.LMSInitialize('');
                window.API.LMSSetValue('cmi.core.lesson_status', 'incomplete');
            }
            
            // Update progress and time periodically
            setInterval(updateProgress, 2000);
            setInterval(updateSessionTime, 1000);
        </script>
    </body>
    </html>
    `;
  };

  const navigateToItem = (index: number) => {
    if (index >= 0 && index < state.playableItems.length) {
      loadSCO(index);
    }
  };

  const formatTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const testSCORMConnection = () => {
    console.log('=== Testing SCORM Connection ===');
    
    // Test window API
    if ((window as any).API) {
      console.log('✓ Window API available');
      try {
        const initResult = (window as any).API.LMSInitialize('');
        console.log('✓ LMSInitialize result:', initResult);
        
        const studentName = (window as any).API.LMSGetValue('cmi.core.student_name');
        console.log('✓ Student name:', studentName);
        
        const setResult = (window as any).API.LMSSetValue('cmi.core.lesson_status', 'incomplete');
        console.log('✓ LMSSetValue result:', setResult);
        
        (window as any).API.LMSFinish('');
        console.log('✓ LMSFinish completed');
      } catch (e) {
        console.error('❌ Window API test failed:', e);
      }
    } else {
      console.log('❌ Window API not available');
    }
    
    // Test iframe API
    if (iframeRef.current?.contentWindow) {
      console.log('✓ Iframe content window available');
      try {
        const iframeAPI = (iframeRef.current.contentWindow as any).API;
        if (iframeAPI) {
          console.log('✓ Iframe API available');
          const initResult = iframeAPI.LMSInitialize('');
          console.log('✓ Iframe LMSInitialize result:', initResult);
        } else {
          console.log('❌ Iframe API not available');
        }
      } catch (e) {
        console.error('❌ Iframe API test failed:', e);
      }
    } else {
      console.log('❌ Iframe content window not available');
    }
    
    // Test SCORM adapter
    if (scormAdapterRef.current) {
      console.log('✓ SCORM adapter available');
      console.log('SCORM adapter state:', scormAdapterRef.current.getStudentData());
      scormAdapterRef.current.debug();
    } else {
      console.log('❌ SCORM adapter not available');
    }
  };

  const currentItem = state.playableItems[state.currentItemIndex];
  const progress = state.playableItems.length > 0 ? 
    ((state.currentItemIndex + 1) / state.playableItems.length) * 100 : 0;

  if (state.isLoading) {
    return (
      <div className={cn("flex items-center justify-center min-h-[600px]", className)}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading SCORM content...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("h-screen flex flex-col bg-background", className)}>
      {/* Header */}
      <Card className="rounded-none border-x-0 border-t-0 shadow-sm">
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setState(prev => ({ ...prev, showSidebar: !prev.showSidebar }))}
            >
              {state.showSidebar ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </Button>
            
            <div className="flex items-center gap-2">
              <img 
                src="/lovable-uploads/2d90e592-5f80-484d-b3c7-2baacd1b6118.png" 
                alt="Pathful" 
                className="h-5 w-auto"
              />
              <h1 className="font-semibold">{state.manifest?.title}</h1>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              {formatTime(state.sessionTime)}
            </div>
            
            <Badge variant={state.lessonStatus === 'completed' ? 'default' : 'secondary'}>
              {state.lessonStatus === 'completed' ? 
                <CheckCircle2 className="h-3 w-3 mr-1" /> : 
                <AlertCircle className="h-3 w-3 mr-1" />
              }
              {state.lessonStatus}
            </Badge>
            
            <Badge 
              variant={state.apiStatus === 'active' ? 'default' : state.apiStatus === 'connected' ? 'secondary' : 'destructive'}
              className="text-xs"
            >
              {state.apiStatus === 'active' ? (
                <>
                  <div className="h-2 w-2 bg-green-500 rounded-full animate-pulse mr-1" />
                  SCORM Active
                </>
              ) : state.apiStatus === 'connected' ? (
                <>
                  <div className="h-2 w-2 bg-yellow-500 rounded-full mr-1" />
                  SCORM Ready
                </>
              ) : (
                <>
                  <div className="h-2 w-2 bg-red-500 rounded-full mr-1" />
                  SCORM Disconnected
                </>
              )}
            </Badge>
          </div>
        </div>

        <div className="px-4 pb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Course Progress</span>
            <span className="text-sm text-muted-foreground">
              {state.currentItemIndex + 1} of {state.playableItems.length}
            </span>
          </div>
          <Progress value={progress} className="w-full" />
        </div>
      </Card>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        {state.showSidebar && (
          <Card className="w-80 rounded-none border-y-0 border-l-0 flex flex-col">
            <div className="p-4 border-b">
              <h2 className="font-semibold mb-2">Course Content</h2>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigateToItem(state.currentItemIndex - 1)}
                  disabled={state.currentItemIndex === 0}
                >
                  <SkipBack className="h-4 w-4" />
                </Button>
                
                <Button
                  variant={state.isPlaying ? "secondary" : "default"}
                  size="sm"
                  onClick={() => setState(prev => ({ ...prev, isPlaying: !prev.isPlaying }))}
                >
                  {state.isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </Button>
                
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigateToItem(state.currentItemIndex + 1)}
                  disabled={state.currentItemIndex === state.playableItems.length - 1}
                >
                  <SkipForward className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <ScrollArea className="flex-1 p-2">
              <div className="space-y-1">
                {state.playableItems.map((item, index) => (
                  <Button
                    key={item.identifier}
                    variant={index === state.currentItemIndex ? "secondary" : "ghost"}
                    className="w-full justify-start text-left h-auto p-3"
                    onClick={() => navigateToItem(index)}
                  >
                    <div className="flex items-start gap-3">
                      <FileText className="h-4 w-4 mt-0.5 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{item.title}</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {index === state.currentItemIndex ? 'Current' : 
                           index < state.currentItemIndex ? 'Completed' : 'Upcoming'}
                        </div>
                      </div>
                      {index < state.currentItemIndex && (
                        <CheckCircle2 className="h-4 w-4 text-learning-complete" />
                      )}
                    </div>
                  </Button>
                ))}
              </div>
            </ScrollArea>
          </Card>
        )}

        {/* Content Area */}
        <div className="flex-1 flex flex-col relative">
          {currentItem ? (
            <div className="flex-1 bg-white relative">
              {/* Enhanced Debug overlay */}
              <div className="absolute top-0 left-0 bg-black text-white p-2 text-xs z-10 opacity-90 max-w-md">
                <div className="font-bold mb-1">SCORM Debug Info</div>
                <div>Playing: {currentItem.title}</div>
                <div>File: {currentItem.href}</div>
                <div className="mt-1">
                  Status: <span className={state.apiStatus === 'active' ? 'text-green-400' : state.apiStatus === 'connected' ? 'text-yellow-400' : 'text-red-400'}>
                    {state.apiStatus.toUpperCase()}
                  </span>
                </div>
                {state.lastApiCall && (
                  <div className="mt-1 text-green-400">Last API: {state.lastApiCall}</div>
                )}
                <div className="mt-1 text-blue-400">
                  Session: {formatTime(state.sessionTime)}
                </div>
                <div className="mt-1 text-yellow-400">
                  Score: {state.score || 'N/A'}
                </div>
                <div className="mt-2 space-y-1">
                  <button 
                    className="w-full px-2 py-1 bg-blue-600 text-white text-xs rounded"
                    onClick={testSCORMConnection}
                  >
                    Test SCORM API
                  </button>
                  <button 
                    className="w-full px-2 py-1 bg-green-600 text-white text-xs rounded"
                    onClick={() => {
                      if (iframeRef.current?.contentWindow) {
                        (iframeRef.current.contentWindow as any).API = (window as any).API;
                        (iframeRef.current.contentWindow as any).API_1484_11 = (window as any).API_1484_11;
                        console.log('✓ Manual API injection completed');
                        setState(prev => ({ ...prev, apiStatus: 'connected' }));
                        toast({
                          title: "API Injected",
                          description: "SCORM API manually injected into iframe"
                        });
                      }
                    }}
                  >
                    Inject API Manually
                  </button>
                </div>
              </div>
              
              <iframe
                ref={iframeRef}
                title={DOMPurify.sanitize(currentItem.title, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] })}
                className="w-full h-full border-0 bg-white"
                sandbox="allow-scripts allow-forms allow-modals allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation allow-downloads"
                style={{ 
                  minHeight: '600px',
                  width: '100%',
                  height: '100%',
                  border: '1px solid #ccc',
                  overflow: 'auto',
                  display: 'block'
                }}
                allowFullScreen
                allow="fullscreen"
              />
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center bg-slate-50">
              <div className="text-center text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <h3 className="font-medium mb-2">No Content Selected</h3>
                <p className="text-sm">Select a lesson from the sidebar to start learning</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}