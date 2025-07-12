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
  FileText,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { SCORMAgainAdapter } from '@/lib/scorm-again-adapter';
import { SCORMManifestParser, type SCORMManifest, type SCORMItem } from '@/lib/scorm-manifest';
import { SCORMPackageManager } from '@/lib/scorm-package-manager';
import { rewriteSCORMUrls, extractAssetUrls } from '@/lib/scorm-url-rewriter';
import { handleAssetRequest, debugPackageAssets } from '@/lib/scorm-asset-handler';
import { testMockSCORMAPI } from '@/lib/mock-scorm-api';
import { testURLRewriting, testURLRewritingWithPackage, testPathResolution } from '@/lib/test-url-rewriting';

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
  showDebugInfo: boolean;
  sessionTime: number;
  lessonStatus: string;
  score: string;
  apiStatus: 'disconnected' | 'connected' | 'active';
  lastApiCall?: string;
}

export function SCORMPlayer({ 
  manifestUrl,
  baseUrl,
  userId = 'user',
  courseId = 'course',
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
    showDebugInfo: false,
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
    
    // Track initialization state to prevent double initialization
    let isInitialized = false;
    let sessionActive = false;
    
    // Enhanced SCORM 1.2 API implementation with full compliance
    const wrappedAPI = {
      LMSInitialize: (param: string) => {
        console.log('SCORM: LMSInitialize called with param:', param);
        if (isInitialized && sessionActive) {
          console.log('SCORM: Already initialized and session active, returning false per SCORM 1.2 spec');
          setState(prev => ({ ...prev, lastApiCall: 'LMSInitialize (already initialized)' }));
          return 'false'; // ✅ Return 'false' per SCORM 1.2 spec
        }
        setState(prev => ({ ...prev, apiStatus: 'active', lastApiCall: 'LMSInitialize' }));
        const result = API.lmsInitialize();
        if (result === 'true') {
          isInitialized = true;
          sessionActive = true;
          console.log('✓ SCORM 1.2 session initialized successfully');
        }
        return result;
      },
      LMSFinish: (param: string) => {
        console.log('SCORM: LMSFinish called with param:', param);
        setState(prev => ({ ...prev, apiStatus: 'connected', lastApiCall: 'LMSFinish' }));
        const result = API.lmsFinish();
        if (result === 'true') {
          isInitialized = false; // Reset initialization state
          sessionActive = false; // Reset session state
          console.log('✓ SCORM 1.2 session terminated successfully');
        }
        return result;
      },
      LMSGetValue: (element: string) => {
        console.log(`SCORM: LMSGetValue("${element}")`);
        setState(prev => ({ ...prev, apiStatus: 'active', lastApiCall: `LMSGetValue: ${element}` }));
        
        // SCORM 1.2 validation for required elements
        if (!element || typeof element !== 'string') {
          console.warn('⚠ LMSGetValue: Invalid element parameter');
          return '';
        }
        
        // Handle special SCORM 1.2 elements
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
        
        // SCORM 1.2 validation
        if (!element || typeof element !== 'string') {
          console.warn('⚠ LMSSetValue: Invalid element parameter');
          return 'false';
        }
        
        if (value === undefined || value === null) {
          console.warn('⚠ LMSSetValue: Invalid value parameter');
          return 'false';
        }
        
        // Update UI based on values
        if (element === 'cmi.core.lesson_status') {
          setState(prev => ({ ...prev, lessonStatus: value }));
        } else if (element === 'cmi.core.score.raw') {
          setState(prev => ({ ...prev, score: value }));
        }
        
        const result = API.lmsSetValue(element, value);
        return result;
      },
      LMSCommit: (param: string) => {
        console.log('SCORM: LMSCommit called with param:', param);
        setState(prev => ({ ...prev, lastApiCall: 'LMSCommit' }));
        const result = API.lmsCommit();
        return result;
      },
      LMSGetLastError: () => {
        const error = API.lmsGetLastError();
        console.log('SCORM: LMSGetLastError returned:', error);
        return error;
      },
      LMSGetErrorString: (errorCode: string) => {
        const errorString = API.lmsGetErrorString(errorCode);
        console.log(`SCORM: LMSGetErrorString("${errorCode}") returned:`, errorString);
        return errorString;
      },
      LMSGetDiagnostic: (errorCode: string) => {
        const diagnostic = API.lmsGetDiagnostic(errorCode);
        console.log(`SCORM: LMSGetDiagnostic("${errorCode}") returned:`, diagnostic);
        return diagnostic;
      }
    };
    
    // Enhanced SCORM 2004 API for compatibility
    const wrappedAPI_1484_11 = {
      Initialize: (param: string) => {
        console.log('SCORM 2004: Initialize called with param:', param);
        return wrappedAPI.LMSInitialize(param);
      },
      Terminate: (param: string) => {
        console.log('SCORM 2004: Terminate called with param:', param);
        return wrappedAPI.LMSFinish(param);
      },
      GetValue: (element: string) => {
        console.log(`SCORM 2004: GetValue("${element}")`);
        return wrappedAPI.LMSGetValue(element);
      },
      SetValue: (element: string, value: string) => {
        console.log(`SCORM 2004: SetValue("${element}", "${value}")`);
        return wrappedAPI.LMSSetValue(element, value);
      },
      Commit: (param: string) => {
        console.log('SCORM 2004: Commit called with param:', param);
        return wrappedAPI.LMSCommit(param);
      },
      GetLastError: () => wrappedAPI.LMSGetLastError(),
      GetErrorString: (errorCode: string) => wrappedAPI.LMSGetErrorString(errorCode),
      GetDiagnostic: (errorCode: string) => wrappedAPI.LMSGetDiagnostic(errorCode)
    };
    
    // Make APIs globally available immediately
    (window as any).API = wrappedAPI;
    (window as any).API_1484_11 = wrappedAPI_1484_11;
    
    // Enhanced SCORM API discovery functions per ADL specification
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

    console.log('✓ SCORM 1.2 APIs initialized and available globally');

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
      
      if (!packageId) {
        throw new Error('No package ID provided. Please provide a valid SCORM package ID.');
      }
      
      const scormPackage = await SCORMPackageManager.getPackageById(packageId);
      if (!scormPackage) {
        throw new Error(`Package with ID ${packageId} not found`);
      }
      
      const manifest = scormPackage.manifest;
      const resolvedManifest = SCORMManifestParser.resolveItemResources(manifest);
      const playableItems = SCORMManifestParser.getPlayableItems(resolvedManifest);
      
      console.log('✓ Manifest processing complete');
      console.log('Resolved manifest:', resolvedManifest);
      console.log('Playable items:', playableItems);

      setState(prev => ({
        ...prev,
        manifest: resolvedManifest,
        playableItems,
        isLoading: false
      }));

      if (playableItems.length > 0) {
        console.log('✓ Manifest loaded successfully, calling loadSCO(0)');
        console.log('Playable items count:', playableItems.length);
        loadSCO(0);
      } else {
        console.warn('⚠ No playable items found in manifest');
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



  const loadSCO = useCallback(async (itemIndex: number) => {
    if (!packageId) {
      toast({
        title: "No SCORM Package",
        description: "Please provide a valid SCORM package ID to load content",
        variant: "destructive"
      });
      return;
    }
    
    console.log('=== loadSCO called ===');
    console.log('Item index:', itemIndex);
    console.log('Playable items:', state.playableItems);
    console.log('Iframe ref:', iframeRef.current);
    
    if (!state.playableItems[itemIndex] || !iframeRef.current) {
      console.error('❌ Cannot load SCO - missing item or iframe ref');
      console.log('Item exists:', !!state.playableItems[itemIndex]);
      console.log('Iframe ref exists:', !!iframeRef.current);
      return;
    }

    const item = state.playableItems[itemIndex];
    
    try {
      let contentUrl: string;
      
      // If packageId is provided, load actual content from uploaded package
      if (packageId) {
        console.log('Loading SCO for item:', item);
        console.log('Looking for file:', item.href);
        
        // Enhanced file path resolution with better debugging
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
          decodeURIComponent(item.href), // Handle URL-encoded paths
          // Additional common patterns
          `assets/${item.href}`,
          `files/${item.href}`,
          `media/${item.href}`,
          // Try without any path prefix
          item.href.split('/').pop() || item.href
        ];
        
        let contentBlob: Blob | null = null;
        let foundPath = '';
        
        // First, let's get debug info to see what files are actually available
        const debugInfo = await SCORMPackageManager.getPackageDebugInfo(packageId);
        console.log('Available files in package:', debugInfo.fileList);
        
        for (const path of possiblePaths) {
          console.log('Trying path:', path);
          contentBlob = await SCORMPackageManager.getPackageFile(packageId, path);
          if (contentBlob) {
            foundPath = path;
            console.log('✓ Found content at path:', path);
            break;
          }
        }
        
        if (contentBlob) {
          // For HTML files, inject SCORM API and serve directly
          if (item.href.toLowerCase().includes('.html') || item.href.toLowerCase().includes('.htm')) {
            const text = await contentBlob.text();
            
            // Extract and log asset URLs for debugging
            const assetUrls = extractAssetUrls(text);
            console.log('Found assets in HTML:', assetUrls);
            
            // Check if this is Articulate Storyline content
            const isStorylineContent = text.includes('Articulate') || 
                                     text.includes('Storyline') || 
                                     text.includes('lms/scormdriver.js') ||
                                     text.includes('story_content/user.js');
            
            console.log('Content type detected:', isStorylineContent ? 'Storyline' : 'Standard HTML');
            
            // Enhanced SCORM 1.2 API injection with full compliance
            const scormApiScript = `
              <script>
                // Enhanced SCORM 1.2 API injection
                console.log('SCORM 1.2 API injection starting...');
                
                // Make APIs available immediately
                if (window.parent && window.parent.API) {
                  window.API = window.parent.API;
                  window.API_1484_11 = window.parent.API_1484_11;
                  console.log("✓ SCORM 1.2 API injected from parent");
                }
                
                // Standard SCORM API discovery per ADL specification
                window.findAPI = function(win) {
                  var findAttempts = 0;
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
                
                window.getAPI = function() {
                  return window.API || window.findAPI(window);
                };
                
                // Auto-initialize SCORM 1.2 when page loads
                function initializeSCORM() {
                  try {
                    const api = window.getAPI();
                    if (api) {
                      console.log('Initializing SCORM 1.2 session...');
                      const initResult = api.LMSInitialize('');
                      console.log('LMSInitialize result:', initResult);
                      
                      if (initResult === 'true') {
                        console.log('✓ SCORM 1.2 session initialized successfully');
                        // Set initial status per SCORM 1.2 spec
                        api.LMSSetValue('cmi.core.lesson_status', 'incomplete');
                        api.LMSCommit('');
                      } else {
                        console.warn('⚠ SCORM 1.2 initialization returned false');
                        // Check for errors
                        const errorCode = api.LMSGetLastError();
                        if (errorCode !== '0') {
                          const errorString = api.LMSGetErrorString(errorCode);
                          console.error('SCORM 1.2 initialization error:', errorCode, errorString);
                        }
                      }
                    } else {
                      console.warn('⚠ SCORM 1.2 API not available for initialization');
                    }
                  } catch (e) {
                    console.error('❌ SCORM 1.2 initialization failed:', e);
                  }
                }
                
                // Initialize when DOM is ready
                if (document.readyState === 'loading') {
                  document.addEventListener('DOMContentLoaded', initializeSCORM);
                } else {
                  initializeSCORM();
                }
                
                // Handle page unload for proper SCORM 1.2 termination
                function terminateSCORM() {
                  try {
                    const api = window.getAPI();
                    if (api) {
                      console.log('Terminating SCORM 1.2 session...');
                      const finishResult = api.LMSFinish('');
                      console.log('LMSFinish result:', finishResult);
                      
                      if (finishResult === 'true') {
                        console.log('✓ SCORM 1.2 session terminated successfully');
                      } else {
                        console.warn('⚠ SCORM 1.2 termination returned false');
                        const errorCode = api.LMSGetLastError();
                        if (errorCode !== '0') {
                          const errorString = api.LMSGetErrorString(errorCode);
                          console.error('SCORM 1.2 termination error:', errorCode, errorString);
                        }
                      }
                    }
                  } catch (e) {
                    console.error('❌ SCORM 1.2 termination failed:', e);
                  }
                }
                
                // Set up unload handlers
                window.addEventListener('beforeunload', terminateSCORM);
                window.addEventListener('unload', terminateSCORM);
                
                console.log('✓ SCORM 1.2 API injection completed');
              </script>
            `;
            
            // Inject API script into the HTML with better placement
            let modifiedHtml = text;
            
            // For Storyline content, we need to be more careful about script injection
            if (isStorylineContent) {
              console.log('✓ Detected Storyline content - using specialized injection');
              
              // Storyline-specific modifications
              // 1. Ensure SCORM API is available before any other scripts
              const storylineApiScript = `
                <script>
                  // Storyline-specific SCORM 1.2 API injection
                  console.log('Storyline SCORM 1.2 API injection starting...');
                  
                  // Make APIs available immediately for Storyline
                  if (window.parent && window.parent.API) {
                    window.API = window.parent.API;
                    window.API_1484_11 = window.parent.API_1484_11;
                    console.log("✓ Storyline SCORM 1.2 API injected from parent");
                  }
                  
                  // Standard SCORM API discovery for Storyline
                  window.findAPI = function(win) {
                    var findAttempts = 0;
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
                  
                  window.getAPI = function() {
                    return window.API || window.findAPI(window);
                  };
                  
                  // Storyline-specific initialization
                  function initializeStorylineSCORM() {
                    try {
                      const api = window.getAPI();
                      if (api) {
                        console.log('Initializing Storyline SCORM 1.2 session...');
                        
                        // Storyline often needs multiple initialization attempts
                        let initResult = api.LMSInitialize('');
                        console.log('Storyline LMSInitialize result:', initResult);
                        
                        if (initResult === 'true') {
                          console.log('✓ Storyline SCORM 1.2 session initialized successfully');
                          // Set initial status for Storyline
                          api.LMSSetValue('cmi.core.lesson_status', 'incomplete');
                          api.LMSCommit('');
                        } else {
                          console.warn('⚠ Storyline SCORM 1.2 initialization returned false, retrying...');
                          
                          // Retry with a delay - Storyline sometimes needs time to fully load
                          setTimeout(() => {
                            try {
                              console.log('Retrying Storyline SCORM 1.2 initialization...');
                              const retryResult = api.LMSInitialize('');
                              console.log('Storyline retry result:', retryResult);
                              
                              if (retryResult === 'true') {
                                console.log('✓ Storyline SCORM 1.2 session initialized on retry');
                                api.LMSSetValue('cmi.core.lesson_status', 'incomplete');
                                api.LMSCommit('');
                              } else {
                                console.warn('⚠ Storyline SCORM 1.2 retry also failed, trying alternative approach...');
                                
                                // Try alternative initialization approach for Storyline
                                setTimeout(() => {
                                  try {
                                    // Some Storyline content needs specific parameters
                                    const altResult = api.LMSInitialize('true');
                                    console.log('Storyline alternative init result:', altResult);
                                    
                                    if (altResult === 'true') {
                                      console.log('✓ Storyline SCORM 1.2 session initialized with alternative method');
                                      api.LMSSetValue('cmi.core.lesson_status', 'incomplete');
                                      api.LMSCommit('');
                                    } else {
                                      console.error('❌ All Storyline SCORM 1.2 initialization attempts failed');
                                    }
                                  } catch (e) {
                                    console.error('❌ Alternative Storyline initialization failed:', e);
                                  }
                                }, 1000);
                              }
                            } catch (e) {
                              console.error('❌ Storyline SCORM 1.2 retry failed:', e);
                            }
                          }, 2000); // Longer delay for Storyline
                        }
                      } else {
                        console.warn('⚠ Storyline SCORM 1.2 API not available for initialization');
                        
                        // Try to find API using alternative methods
                        setTimeout(() => {
                          try {
                            const foundAPI = window.findAPI(window);
                            if (foundAPI) {
                              console.log('✓ Found Storyline SCORM 1.2 API via alternative method');
                              initializeStorylineSCORM();
                            } else {
                              console.error('❌ Storyline SCORM 1.2 API not found via any method');
                            }
                          } catch (e) {
                            console.error('❌ Alternative API discovery failed:', e);
                          }
                        }, 1000);
                      }
                    } catch (e) {
                      console.error('❌ Storyline SCORM 1.2 initialization failed:', e);
                    }
                  }
                  
                  // Initialize when DOM is ready for Storyline
                  if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', initializeStorylineSCORM);
                  } else {
                    // For already loaded content, delay initialization to ensure Storyline is ready
                    setTimeout(initializeStorylineSCORM, 1000);
                  }
                  
                  console.log('✓ Storyline SCORM 1.2 API injection completed');
                </script>
              `;
              
              // Inject at the very beginning for Storyline content
              const assetHandlerScript = createStorylineAssetHandler(packageId);
              modifiedHtml = storylineApiScript + assetHandlerScript + text;
              
            } else {
              // Standard HTML content injection
              // Try to inject in head first
              if (text.includes('<head')) {
                modifiedHtml = text.replace(
                  /<head([^>]*)>/i,
                  `<head$1>${scormApiScript}`
                );
              } else if (text.includes('<body')) {
                // If no head, inject at start of body
                modifiedHtml = text.replace(
                  /<body([^>]*)>/i,
                  `<body$1>${scormApiScript}`
                );
              } else {
                // Last resort: inject at the very beginning
                modifiedHtml = scormApiScript + text;
              }
            }
            
            // Rewrite all asset URLs to point to our asset handler
            console.log('Rewriting asset URLs...');
            const rewrittenHtml = rewriteSCORMUrls(modifiedHtml, {
              packageId,
              baseUrl: window.location.origin,
              currentFilePath: item.href
            });
            
            // Create blob URL for the modified HTML
            const htmlBlob = new Blob([rewrittenHtml], { type: 'text/html; charset=utf-8' });
            contentUrl = URL.createObjectURL(htmlBlob);
            console.log('✓ HTML content prepared with SCORM 1.2 API injection and URL rewriting');
            
            // Also inject fetch override into the HTML content itself
            const htmlWithFetchOverride = rewrittenHtml.replace(
              /<head([^>]*)>/i,
              `<head$1>
                <script>
                  // Override fetch to intercept SCORM asset requests
                  const originalFetch = window.fetch;
                  window.fetch = async function(input, init) {
                    const url = typeof input === 'string' ? input : input.toString();
                    console.log('Iframe fetch called with URL:', url);
                    if (url.includes('/api/scorm-asset')) {
                      console.log('Iframe: Intercepting SCORM asset request to:', url);
                      // Use the parent window's fetch to ensure it goes through our mock API
                      if (window.parent && window.parent.fetch) {
                        console.log('Iframe: Using parent window fetch for SCORM asset');
                        return window.parent.fetch(input, init);
                      }
                    }
                    return originalFetch(input, init);
                  };
                  console.log('✓ Iframe fetch override installed');
                </script>
              `
            );
            
            const finalHtmlBlob = new Blob([htmlWithFetchOverride], { type: 'text/html; charset=utf-8' });
            contentUrl = URL.createObjectURL(finalHtmlBlob);
          } else {
            // For non-HTML files, serve directly
            contentUrl = URL.createObjectURL(contentBlob);
            console.log('✓ Non-HTML content served directly');
          }
        } else {
          console.error('❌ Content file not found. Tried paths:', possiblePaths);
          console.error('Available files:', debugInfo.fileList);
          
          // Try to find any HTML file as fallback
          const htmlFiles = debugInfo.fileList.filter(f => 
            f.toLowerCase().endsWith('.html') || f.toLowerCase().endsWith('.htm')
          );
          
          if (htmlFiles.length > 0) {
            console.log('Trying fallback HTML file:', htmlFiles[0]);
            const fallbackBlob = await SCORMPackageManager.getPackageFile(packageId, htmlFiles[0]);
            if (fallbackBlob) {
              const text = await fallbackBlob.text();
              const scormApiScript = `
                <script>
                  if (window.parent && window.parent.API) {
                    window.API = window.parent.API;
                    window.API_1484_11 = window.parent.API_1484_11;
                    console.log("✓ SCORM 1.2 API injected (fallback)");
                  }
                </script>
              `;
              let modifiedHtml = text.replace(
                /<head([^>]*)>/i,
                `<head$1>${scormApiScript}`
              );
              
              // Rewrite asset URLs for fallback HTML as well
              console.log('Rewriting asset URLs in fallback HTML...');
              const rewrittenHtml = rewriteSCORMUrls(modifiedHtml, {
                packageId,
                baseUrl: window.location.origin,
                currentFilePath: htmlFiles[0]
              });
              
              const htmlBlob = new Blob([rewrittenHtml], { type: 'text/html; charset=utf-8' });
              contentUrl = URL.createObjectURL(htmlBlob);
              console.log('✓ Using fallback HTML file with URL rewriting');
            } else {
              throw new Error(`Content file "${item.href}" not found in package. Available files: ${debugInfo.fileList.join(', ')}`);
            }
          } else {
            throw new Error(`Content file "${item.href}" not found in package. No HTML files available. Available files: ${debugInfo.fileList.join(', ')}`);
          }
        }
      }

      setState(prev => ({
        ...prev,
        currentItemIndex: itemIndex,
        isPlaying: true,
        lessonStatus: 'incomplete'
      }));

      // Load content into iframe with enhanced error handling
      if (iframeRef.current) {
        console.log('Loading content into iframe:', contentUrl);
        console.log('Content URL type:', typeof contentUrl);
        console.log('Content URL length:', contentUrl?.length);
        
        if (contentUrl) {
          iframeRef.current.src = contentUrl;
          console.log('✓ Iframe src set successfully');
        } else {
          console.error('❌ Content URL is empty or undefined');
          toast({
            title: "Content Load Error",
            description: "Failed to create content URL",
            variant: "destructive"
          });
        }
      } else {
        console.error('❌ Iframe reference is null');
      }

      // Enhanced iframe load handler with better API injection
      iframeRef.current.onload = () => {
        console.log('✓ Iframe loaded successfully');
        
        // Inject SCORM API immediately after load
        setTimeout(() => {
          if (iframeRef.current?.contentWindow) {
            try {
              // Inject APIs into iframe
              (iframeRef.current.contentWindow as any).API = (window as any).API;
              (iframeRef.current.contentWindow as any).API_1484_11 = (window as any).API_1484_11;
              (iframeRef.current.contentWindow as any).findAPI = (window as any).findAPI;
              (iframeRef.current.contentWindow as any).getAPI = (window as any).getAPI;
              
              // Also inject the fetch override into the iframe
              (iframeRef.current.contentWindow as any).fetch = window.fetch;
              
              // Debug: Check if fetch override is working
              console.log('✓ Fetch override injected into iframe');
              console.log('Iframe fetch function:', (iframeRef.current.contentWindow as any).fetch);
              console.log('Parent fetch function:', window.fetch);
              
              console.log('✓ SCORM 1.2 APIs injected immediately');
              setState(prev => ({ ...prev, apiStatus: 'connected' }));
              
              // Trigger initial SCORM session with retry logic
              setTimeout(() => {
                try {
                  if (iframeRef.current?.contentWindow) {
                    const iframeAPI = (iframeRef.current.contentWindow as any).API;
                    if (iframeAPI) {
                      console.log('Triggering initial SCORM 1.2 session...');
                      const initResult = iframeAPI.LMSInitialize('');
                      console.log('Initial LMSInitialize result:', initResult);
                      
                      if (initResult === 'true') {
                        setState(prev => ({ ...prev, apiStatus: 'active' }));
                        console.log('✓ SCORM 1.2 session activated');
                        
                        // Set initial status per SCORM 1.2 spec
                        iframeAPI.LMSSetValue('cmi.core.lesson_status', 'incomplete');
                        iframeAPI.LMSCommit('');
                      } else {
                        console.warn('⚠ SCORM 1.2 initialization returned false, will retry...');
                        // Retry with longer delay
                        setTimeout(() => {
                          try {
                            const retryResult = iframeAPI.LMSInitialize('');
                            if (retryResult === 'true') {
                              setState(prev => ({ ...prev, apiStatus: 'active' }));
                              console.log('✓ SCORM 1.2 session activated on retry');
                              iframeAPI.LMSSetValue('cmi.core.lesson_status', 'incomplete');
                              iframeAPI.LMSCommit('');
                            }
                          } catch (e) {
                            console.error('❌ SCORM 1.2 retry failed:', e);
                          }
                        }, 1000);
                      }
                    }
                  }
                } catch (e) {
                  console.error('❌ Failed to initialize SCORM 1.2 session:', e);
                }
              }, 200); // Increased delay to ensure content is ready
            } catch (e) {
              console.error('❌ Failed to inject SCORM 1.2 API:', e);
              setState(prev => ({ ...prev, apiStatus: 'disconnected' }));
            }
          }
        }, 100);
      };

      // Handle iframe load errors
      iframeRef.current.onerror = () => {
        console.error('❌ Iframe failed to load content');
        toast({
          title: "Content Load Error",
          description: "Failed to load the content into the iframe",
          variant: "destructive"
        });
      };

      toast({
        title: "Loading Content",
        description: `Now playing: ${item.title}`
      });
      
    } catch (error) {
      console.error('Error loading SCO:', error);
      toast({
        title: "Error Loading Content",
        description: error instanceof Error ? error.message : "Failed to load content",
        variant: "destructive"
      });
    }
  }, [packageId, state.playableItems, toast]);

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
    console.log('=== Testing SCORM 1.2 Connection ===');
    
    // Test window API
    if ((window as any).API) {
      console.log('✓ Window SCORM 1.2 API available');
      try {
        const initResult = (window as any).API.LMSInitialize('');
        console.log('✓ LMSInitialize result:', initResult);
        
        const studentName = (window as any).API.LMSGetValue('cmi.core.student_name');
        console.log('✓ Student name:', studentName);
        
        const lessonStatus = (window as any).API.LMSGetValue('cmi.core.lesson_status');
        console.log('✓ Lesson status:', lessonStatus);
        
        const setResult = (window as any).API.LMSSetValue('cmi.core.lesson_status', 'incomplete');
        console.log('✓ LMSSetValue result:', setResult);
        
        const commitResult = (window as any).API.LMSCommit('');
        console.log('✓ LMSCommit result:', commitResult);
        
        (window as any).API.LMSFinish('');
        console.log('✓ LMSFinish completed');
        
        // Update UI status to active
        setState(prev => ({ ...prev, apiStatus: 'active' }));
        toast({
          title: "SCORM 1.2 Test Successful",
          description: "All SCORM 1.2 API calls completed successfully"
        });
      } catch (e) {
        console.error('❌ Window SCORM 1.2 API test failed:', e);
        toast({
          title: "SCORM 1.2 Test Failed",
          description: "Error testing SCORM 1.2 API calls",
          variant: "destructive"
        });
      }
    } else {
      console.log('❌ Window SCORM 1.2 API not available');
      toast({
        title: "SCORM 1.2 API Not Available",
        description: "Window SCORM 1.2 API is not accessible",
        variant: "destructive"
      });
    }
    
    // Test iframe API
    if (iframeRef.current?.contentWindow) {
      console.log('✓ Iframe content window available');
      try {
        const iframeAPI = (iframeRef.current.contentWindow as any).API;
        if (iframeAPI) {
          console.log('✓ Iframe SCORM 1.2 API available');
          const initResult = iframeAPI.LMSInitialize('');
          console.log('✓ Iframe LMSInitialize result:', initResult);
          
          if (initResult === 'true') {
            setState(prev => ({ ...prev, apiStatus: 'active' }));
          }
        } else {
          console.log('❌ Iframe SCORM 1.2 API not available');
        }
      } catch (e) {
        console.error('❌ Iframe SCORM 1.2 API test failed:', e);
      }
    } else {
      console.log('❌ Iframe content window not available');
    }
    
    // Test SCORM adapter
    if (scormAdapterRef.current) {
      console.log('✓ SCORM 1.2 adapter available');
      console.log('SCORM 1.2 adapter state:', scormAdapterRef.current.getStudentData());
      scormAdapterRef.current.debug();
    } else {
      console.log('❌ SCORM 1.2 adapter not available');
    }
  };

  const debugContentLoading = async () => {
    console.log('=== Debugging SCORM 1.2 Content Loading ===');
    
    if (!packageId) {
      console.log('No packageId provided - cannot debug content loading');
      toast({
        title: "No Package ID",
        description: "Please provide a valid SCORM package ID to debug content loading",
        variant: "destructive"
      });
      return;
    }
    
    try {
      // Get package debug info
      const debugInfo = await SCORMPackageManager.getPackageDebugInfo(packageId);
      console.log('Package debug info:', debugInfo);
      
      if (!debugInfo.packageExists) {
        console.error('❌ Package not found in database');
        toast({
          title: "Package Not Found",
          description: debugInfo.error || "Package not found in database",
          variant: "destructive"
        });
        return;
      }
      
      // Check current item
      const currentItem = state.playableItems[state.currentItemIndex];
      if (!currentItem) {
        console.error('❌ No current item to debug');
        return;
      }
      
      console.log('Current item:', currentItem);
      console.log('Available files:', debugInfo.fileList);
      
      // Test file loading
      const testPaths = [
        currentItem.href,
        currentItem.href.replace(/^\/+/, ''),
        currentItem.href.toLowerCase(),
        currentItem.href.split('/').pop() || currentItem.href
      ];
      
      for (const path of testPaths) {
        console.log(`Testing path: ${path}`);
        const blob = await SCORMPackageManager.getPackageFile(packageId, path);
        if (blob) {
          console.log(`✓ Found file at: ${path} (${blob.size} bytes)`);
          
          if (path.toLowerCase().endsWith('.html') || path.toLowerCase().endsWith('.htm')) {
            const text = await blob.text();
            console.log(`✓ HTML content length: ${text.length} characters`);
            console.log(`✓ Contains <head>: ${text.includes('<head')}`);
            console.log(`✓ Contains <body>: ${text.includes('<body')}`);
            console.log(`✓ Contains <script>: ${text.includes('<script')}`);
            console.log(`✓ Contains SCORM references: ${text.includes('scorm') || text.includes('SCORM')}`);
            console.log(`✓ Contains API references: ${text.includes('API') || text.includes('api')}`);
          }
          break;
        } else {
          console.log(`❌ File not found at: ${path}`);
        }
      }
      
      // Check iframe state
      if (iframeRef.current) {
        console.log('Iframe src:', iframeRef.current.src);
        console.log('Iframe readyState:', iframeRef.current.contentDocument?.readyState);
        console.log('Iframe contentWindow available:', !!iframeRef.current.contentWindow);
        
        // Check if SCORM 1.2 API is available in iframe
        if (iframeRef.current.contentWindow) {
          const iframeAPI = (iframeRef.current.contentWindow as any).API;
          console.log('Iframe SCORM 1.2 API available:', !!iframeAPI);
          
          if (iframeAPI) {
            try {
              const initResult = iframeAPI.LMSInitialize('');
              console.log('Iframe SCORM 1.2 initialization result:', initResult);
            } catch (e) {
              console.error('Iframe SCORM 1.2 initialization error:', e);
            }
          }
        }
      }
      
      toast({
        title: "SCORM 1.2 Debug Complete",
        description: "Check console for detailed debug information"
      });
      
    } catch (error) {
      console.error('SCORM 1.2 Debug error:', error);
      toast({
        title: "SCORM 1.2 Debug Failed",
        description: error instanceof Error ? error.message : "Debug operation failed",
        variant: "destructive"
      });
    }
  };

  const testContentLoading = async () => {
    console.log('=== Testing SCORM 1.2 Content Loading ===');
    
    if (!packageId) {
      console.log('No packageId provided - cannot test content loading');
      toast({
        title: "No Package ID",
        description: "Please provide a valid SCORM package ID to test content loading",
        variant: "destructive"
      });
      return;
    }
    
    try {
      const debugInfo = await SCORMPackageManager.getPackageDebugInfo(packageId);
      console.log('Package test info:', {
        exists: debugInfo.packageExists,
        fileCount: debugInfo.fileCount,
        totalSize: debugInfo.totalSize,
        hasManifest: debugInfo.fileList.includes('imsmanifest.xml'),
        htmlFiles: debugInfo.fileList.filter(f => 
          f.toLowerCase().endsWith('.html') || f.toLowerCase().endsWith('.htm')
        )
      });
      
      if (!debugInfo.packageExists) {
        toast({
          title: "Package Not Found",
          description: "The specified package does not exist",
          variant: "destructive"
        });
        return;
      }
      
      // Test loading the first HTML file
      const htmlFiles = debugInfo.fileList.filter(f => 
        f.toLowerCase().endsWith('.html') || f.toLowerCase().endsWith('.htm')
      );
      
      if (htmlFiles.length === 0) {
        toast({
          title: "No HTML Files",
          description: "No HTML files found in the package",
          variant: "destructive"
        });
        return;
      }
      
      const testFile = htmlFiles[0];
      console.log('Testing SCORM 1.2 file:', testFile);
      
      const blob = await SCORMPackageManager.getPackageFile(packageId, testFile);
      if (blob) {
        const text = await blob.text();
        console.log('SCORM 1.2 file loaded successfully:', {
          size: blob.size,
          textLength: text.length,
          hasHead: text.includes('<head'),
          hasBody: text.includes('<body'),
          hasScript: text.includes('<script'),
          hasScormReferences: text.includes('scorm') || text.includes('SCORM'),
          hasApiReferences: text.includes('API') || text.includes('api')
        });
        
        toast({
          title: "SCORM 1.2 File Load Test Successful",
          description: `Successfully loaded ${testFile} (${blob.size} bytes)`
        });
      } else {
        toast({
          title: "SCORM 1.2 File Load Test Failed",
          description: `Failed to load ${testFile}`,
          variant: "destructive"
        });
      }
      
    } catch (error) {
      console.error('SCORM 1.2 Test error:', error);
      toast({
        title: "SCORM 1.2 Test Failed",
        description: error instanceof Error ? error.message : "Test operation failed",
        variant: "destructive"
      });
    }
  };

  const createStorylineAssetHandler = (packageId: string) => {
    return `
      <script>
        // Storyline Asset Handler
        window.storylineAssetHandler = {
          packageId: '${packageId}',
          
          // Intercept asset requests and serve from package
          getAsset: async function(path) {
            try {
              console.log('Storyline requesting asset:', path);
              
              // Use our client-side asset handler
              const assetUrl = '/api/scorm-asset?packageId=${packageId}&path=' + encodeURIComponent(path);
              console.log('Asset URL:', assetUrl);
              
              // For now, return the asset URL - the URL rewriting should handle this
              return assetUrl;
            } catch (e) {
              console.warn('Failed to load asset:', path, e);
              return path;
            }
          },
          
          // Override document.createElement to intercept script and link tags
          interceptAssetLoading: function() {
            const originalCreateElement = document.createElement;
            document.createElement = function(tagName) {
              const element = originalCreateElement.call(document, tagName);
              
              if (tagName.toLowerCase() === 'script' || tagName.toLowerCase() === 'link') {
                const originalSetAttribute = element.setAttribute;
                element.setAttribute = function(name, value) {
                  if (name === 'src' || name === 'href') {
                    // Handle asset paths
                    if (value && !value.startsWith('http') && !value.startsWith('data:')) {
                      console.log('Intercepting asset:', value);
                      // The URL rewriting should have already handled this
                    }
                  }
                  return originalSetAttribute.call(this, name, value);
                };
              }
              
              return element;
            };
          }
        };
        
        // Initialize asset handler
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', function() {
            window.storylineAssetHandler.interceptAssetLoading();
          });
        } else {
          window.storylineAssetHandler.interceptAssetLoading();
        }
      </script>
    `;
  };

  const debugStorylineContent = async () => {
    console.log('=== Debugging Storyline Content ===');
    
    if (!packageId) {
      console.log('No packageId - cannot debug Storyline content');
      return;
    }
    
    try {
      const debugInfo = await SCORMPackageManager.getPackageDebugInfo(packageId);
      console.log('Package debug info:', debugInfo);
      
      // Look for Storyline-specific files
      const storylineFiles = debugInfo.fileList.filter(f => 
        f.includes('lms/scormdriver.js') ||
        f.includes('story_content/') ||
        f.includes('html5/') ||
        f.includes('Articulate') ||
        f.includes('Storyline')
      );
      
      console.log('Storyline-specific files found:', storylineFiles);
      
      // Check for required Storyline assets
      const requiredAssets = [
        'lms/scormdriver.js',
        'story_content/user.js',
        'html5/data/css/output.min.css',
        'html5/lib/scripts/bootstrapper.min.js'
      ];
      
      const missingAssets = requiredAssets.filter(asset => 
        !debugInfo.fileList.some(f => f.includes(asset))
      );
      
      console.log('Missing required assets:', missingAssets);
      
      // Test loading the main HTML file
      const htmlFiles = debugInfo.fileList.filter(f => 
        f.toLowerCase().endsWith('.html') || f.toLowerCase().endsWith('.htm')
      );
      
      if (htmlFiles.length > 0) {
        const mainFile = htmlFiles[0];
        console.log('Testing main file:', mainFile);
        
        const blob = await SCORMPackageManager.getPackageFile(packageId, mainFile);
        if (blob) {
          const text = await blob.text();
          console.log('Main file analysis:', {
            size: blob.size,
            textLength: text.length,
            isStoryline: text.includes('Articulate') || text.includes('Storyline'),
            hasScormDriver: text.includes('lms/scormdriver.js'),
            hasStoryContent: text.includes('story_content/user.js'),
            hasHtml5Assets: text.includes('html5/'),
            hasBootstrapper: text.includes('bootstrapper.min.js')
          });
        }
      }
      
      toast({
        title: "Storyline Debug Complete",
        description: `Found ${storylineFiles.length} Storyline files, ${missingAssets.length} missing assets`
      });
      
    } catch (error) {
      console.error('Storyline debug error:', error);
      toast({
        title: "Storyline Debug Failed",
        description: error instanceof Error ? error.message : "Debug operation failed",
        variant: "destructive"
      });
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
                  SCORM 1.2 Active
                </>
              ) : state.apiStatus === 'connected' ? (
                <>
                  <div className="h-2 w-2 bg-yellow-500 rounded-full mr-1" />
                  SCORM 1.2 Ready
                </>
              ) : (
                <>
                  <div className="h-2 w-2 bg-red-500 rounded-full mr-1" />
                  SCORM 1.2 Disconnected
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

            {/* Debug Info Collapsible Pane */}
            <div className="border-b">
              <Button
                variant="ghost"
                className="w-full justify-between p-3 text-sm"
                onClick={() => setState(prev => ({ ...prev, showDebugInfo: !prev.showDebugInfo }))}
              >
                <span className="font-medium">SCORM 1.2 Debug Info</span>
                {state.showDebugInfo ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
              
              {state.showDebugInfo && (
                <div className="px-3 pb-3 space-y-2 text-xs">
                  <div className="bg-muted p-2 rounded">
                    <div className="font-semibold mb-1">Current Content</div>
                    <div>Playing: {currentItem?.title}</div>
                    <div>File: {currentItem?.href}</div>
                  </div>
                  
                  <div className="bg-muted p-2 rounded">
                    <div className="font-semibold mb-1">SCORM 1.2 API Status</div>
                    <div className={cn(
                      "inline-flex items-center gap-1 px-2 py-1 rounded text-xs",
                      state.apiStatus === 'active' ? 'bg-green-100 text-green-800' : 
                      state.apiStatus === 'connected' ? 'bg-yellow-100 text-yellow-800' : 
                      'bg-red-100 text-red-800'
                    )}>
                      <div className={cn(
                        "h-2 w-2 rounded-full",
                        state.apiStatus === 'active' ? 'bg-green-500' : 
                        state.apiStatus === 'connected' ? 'bg-yellow-500' : 
                        'bg-red-500'
                      )} />
                      {state.apiStatus.toUpperCase()}
                    </div>
                    {state.lastApiCall && (
                      <div className="mt-1 text-green-600">Last: {state.lastApiCall}</div>
                    )}
                  </div>
                  
                  <div className="bg-muted p-2 rounded">
                    <div className="font-semibold mb-1">Session Data</div>
                    <div>Time: {formatTime(state.sessionTime)}</div>
                    <div>Score: {state.score || 'N/A'}</div>
                    <div>Status: {state.lessonStatus}</div>
                  </div>
                  
                  <div className="space-y-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-xs"
                      onClick={testSCORMConnection}
                    >
                      Test SCORM 1.2 API
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-xs"
                      onClick={debugContentLoading}
                    >
                      Debug Content Loading
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-xs"
                      onClick={testContentLoading}
                    >
                      Test Content Loading
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-xs"
                      onClick={debugStorylineContent}
                    >
                      Debug Storyline Content
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-xs"
                      onClick={async () => {
                        if (!packageId) {
                          toast({
                            title: "No Package ID",
                            description: "Please provide a valid SCORM package ID to debug assets",
                            variant: "destructive"
                          });
                          return;
                        }
                        
                        try {
                          const assetInfo = await debugPackageAssets(packageId);
                          console.log('Package asset debug info:', assetInfo);
                          
                          if (assetInfo.packageExists) {
                            toast({
                              title: "Asset Debug Complete",
                              description: `Found ${assetInfo.fileCount} files, ${Object.keys(assetInfo.assetTypes).length} file types`
                            });
                          } else {
                            toast({
                              title: "Package Not Found",
                              description: "Package not found for asset debugging",
                              variant: "destructive"
                            });
                          }
                        } catch (error) {
                          console.error('Asset debug error:', error);
                          toast({
                            title: "Asset Debug Failed",
                            description: error instanceof Error ? error.message : "Debug operation failed",
                            variant: "destructive"
                          });
                        }
                      }}
                    >
                      Debug Package Assets
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-xs"
                      onClick={async () => {
                        if (!packageId) {
                          toast({
                            title: "No Package ID",
                            description: "Please provide a valid SCORM package ID to test API",
                            variant: "destructive"
                          });
                          return;
                        }
                        
                        try {
                          // Get debug info to find a test file
                          const debugInfo = await SCORMPackageManager.getPackageDebugInfo(packageId);
                          if (!debugInfo.packageExists) {
                            toast({
                              title: "Package Not Found",
                              description: "Package not found for API testing",
                              variant: "destructive"
                            });
                            return;
                          }
                          
                          // Test with the first file found
                          const testFile = debugInfo.fileList[0];
                          if (!testFile) {
                            toast({
                              title: "No Files",
                              description: "No files found in package for API testing",
                              variant: "destructive"
                            });
                            return;
                          }
                          
                          console.log(`Testing mock API with file: ${testFile}`);
                          const success = await testMockSCORMAPI(packageId, testFile);
                          
                          if (success) {
                            toast({
                              title: "Mock API Test Successful",
                              description: `Successfully served ${testFile} via mock API`
                            });
                          } else {
                            toast({
                              title: "Mock API Test Failed",
                              description: `Failed to serve ${testFile} via mock API`,
                              variant: "destructive"
                            });
                          }
                        } catch (error) {
                          console.error('Mock API test error:', error);
                          toast({
                            title: "Mock API Test Error",
                            description: error instanceof Error ? error.message : "Test failed",
                            variant: "destructive"
                          });
                        }
                      }}
                    >
                      Test Mock API
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-xs"
                      onClick={() => {
                        console.log('=== Testing URL Rewriting ===');
                        const results = testURLRewriting();
                        console.log('URL rewriting test results:', results);
                        toast({
                          title: "URL Rewriting Test",
                          description: `Test completed. Check console for details. Success: ${results.success}`
                        });
                      }}
                    >
                      Test URL Rewriting
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-xs"
                      onClick={async () => {
                        if (!packageId) {
                          toast({
                            title: "No Package ID",
                            description: "Please provide a valid SCORM package ID to test URL rewriting",
                            variant: "destructive"
                          });
                          return;
                        }
                        
                        try {
                          // Get debug info to find an HTML file
                          const debugInfo = await SCORMPackageManager.getPackageDebugInfo(packageId);
                          if (!debugInfo.packageExists) {
                            toast({
                              title: "Package Not Found",
                              description: "Package not found for URL rewriting test",
                              variant: "destructive"
                            });
                            return;
                          }
                          
                          // Find an HTML file to test with
                          const htmlFiles = debugInfo.fileList.filter(f => 
                            f.toLowerCase().endsWith('.html') || f.toLowerCase().endsWith('.htm')
                          );
                          
                          if (htmlFiles.length === 0) {
                            toast({
                              title: "No HTML Files",
                              description: "No HTML files found in package for URL rewriting test",
                              variant: "destructive"
                            });
                            return;
                          }
                          
                          const testFile = htmlFiles[0];
                          console.log(`Testing URL rewriting with file: ${testFile}`);
                          const results = await testURLRewritingWithPackage(packageId, testFile);
                          
                          if (results) {
                            toast({
                              title: "URL Rewriting Test Complete",
                              description: `Tested ${testFile}. Success: ${results.success}. Check console for details.`
                            });
                          } else {
                            toast({
                              title: "URL Rewriting Test Failed",
                              description: `Failed to test ${testFile}`,
                              variant: "destructive"
                            });
                          }
                        } catch (error) {
                          console.error('URL rewriting test error:', error);
                          toast({
                            title: "URL Rewriting Test Error",
                            description: error instanceof Error ? error.message : "Test failed",
                            variant: "destructive"
                          });
                        }
                      }}
                    >
                      Test URL Rewriting with Package
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-xs"
                      onClick={async () => {
                        console.log('=== Testing Path Resolution ===');
                        await testPathResolution();
                        toast({
                          title: "Path Resolution Test",
                          description: "Check console for path resolution test results"
                        });
                      }}
                    >
                      Test Path Resolution
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-xs"
                      onClick={async () => {
                        if (!packageId) {
                          toast({
                            title: "No Package ID",
                            description: "Please provide a valid SCORM package ID to list files",
                            variant: "destructive"
                          });
                          return;
                        }
                        
                        try {
                          const debugInfo = await SCORMPackageManager.getPackageDebugInfo(packageId);
                          console.log('=== Package Files ===');
                          console.log('Package ID:', packageId);
                          console.log('Total files:', debugInfo.fileCount);
                          console.log('All files:', debugInfo.fileList);
                          
                          // Look for shared files specifically
                          const sharedFiles = debugInfo.fileList.filter(f => f.includes('shared/'));
                          console.log('Shared files:', sharedFiles);
                          
                          // Look for JavaScript files
                          const jsFiles = debugInfo.fileList.filter(f => f.toLowerCase().endsWith('.js'));
                          console.log('JavaScript files:', jsFiles);
                          
                          toast({
                            title: "Package Files Listed",
                            description: `Found ${debugInfo.fileCount} files. Check console for details.`
                          });
                        } catch (error) {
                          console.error('Error listing package files:', error);
                          toast({
                            title: "Error Listing Files",
                            description: error instanceof Error ? error.message : "Failed to list files",
                            variant: "destructive"
                          });
                        }
                      }}
                    >
                      List Package Files
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-xs"
                      onClick={async () => {
                        if (!packageId) {
                          toast({
                            title: "No Package ID",
                            description: "Please provide a valid SCORM package ID to test file loading",
                            variant: "destructive"
                          });
                          return;
                        }
                        
                        try {
                          // Test loading the specific files that are failing
                          const testFiles = [
                            'shared/scormfunctions.js',
                            'shared/contentfunctions.js',
                            'shared/style.css'
                          ];
                          
                          console.log('=== Testing File Loading ===');
                          for (const filePath of testFiles) {
                            console.log(`Testing file: ${filePath}`);
                            const blob = await SCORMPackageManager.getPackageFile(packageId, filePath);
                            if (blob) {
                              console.log(`✅ Found: ${filePath} (${blob.size} bytes)`);
                            } else {
                              console.log(`❌ Not found: ${filePath}`);
                            }
                          }
                          
                          toast({
                            title: "File Loading Test Complete",
                            description: "Check console for file loading test results"
                          });
                        } catch (error) {
                          console.error('Error testing file loading:', error);
                          toast({
                            title: "File Loading Test Error",
                            description: error instanceof Error ? error.message : "Test failed",
                            variant: "destructive"
                          });
                        }
                      }}
                    >
                      Test File Loading
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-xs"
                      onClick={async () => {
                        if (!packageId) {
                          toast({
                            title: "No Package ID",
                            description: "Please provide a valid SCORM package ID to test mock API",
                            variant: "destructive"
                          });
                          return;
                        }
                        
                        try {
                          // Test the mock API directly
                          const testFiles = [
                            'shared/scormfunctions.js',
                            'shared/contentfunctions.js',
                            'shared/style.css'
                          ];
                          
                          console.log('=== Testing Mock API ===');
                          for (const filePath of testFiles) {
                            console.log(`Testing mock API for: ${filePath}`);
                            const success = await testMockSCORMAPI(packageId, filePath);
                            console.log(`Mock API result for ${filePath}: ${success ? 'SUCCESS' : 'FAILED'}`);
                          }
                          
                          toast({
                            title: "Mock API Test Complete",
                            description: "Check console for mock API test results"
                          });
                        } catch (error) {
                          console.error('Error testing mock API:', error);
                          toast({
                            title: "Mock API Test Error",
                            description: error instanceof Error ? error.message : "Test failed",
                            variant: "destructive"
                          });
                        }
                      }}
                    >
                      Test Mock API Directly
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-xs"
                      onClick={async () => {
                        if (!packageId) {
                          toast({
                            title: "No Package ID",
                            description: "Please provide a valid SCORM package ID to test fetch override",
                            variant: "destructive"
                          });
                          return;
                        }
                        
                        try {
                          // Test if fetch override is working
                          console.log('=== Testing Fetch Override ===');
                          console.log('Current fetch function:', window.fetch);
                          
                          // Test a direct fetch request
                          const testUrl = `/api/scorm-asset?packageId=${encodeURIComponent(packageId)}&path=shared%2Fscormfunctions.js`;
                          console.log('Testing fetch request to:', testUrl);
                          
                          const response = await fetch(testUrl);
                          console.log('Fetch response status:', response.status);
                          console.log('Fetch response ok:', response.ok);
                          
                          if (response.ok) {
                            const blob = await response.blob();
                            console.log('Fetch response blob size:', blob.size);
                            toast({
                              title: "Fetch Override Working",
                              description: `Successfully fetched file (${blob.size} bytes)`
                            });
                          } else {
                            const text = await response.text();
                            console.log('Fetch response error:', text);
                            toast({
                              title: "Fetch Override Failed",
                              description: `Failed to fetch file: ${response.status} ${response.statusText}`,
                              variant: "destructive"
                            });
                          }
                        } catch (error) {
                          console.error('Error testing fetch override:', error);
                          toast({
                            title: "Fetch Override Error",
                            description: error instanceof Error ? error.message : "Test failed",
                            variant: "destructive"
                          });
                        }
                      }}
                    >
                      Test Fetch Override
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-xs"
                      onClick={async () => {
                        if (!packageId) {
                          toast({
                            title: "No Package ID",
                            description: "Please provide a valid SCORM package ID to test global function",
                            variant: "destructive"
                          });
                          return;
                        }
                        
                        try {
                          // Test the global function
                          console.log('=== Testing Global Function ===');
                          const success = await (window as any).testMockSCORMAPI(packageId, 'shared/scormfunctions.js');
                          console.log('Global function result:', success);
                          
                          toast({
                            title: "Global Function Test",
                            description: success ? "Global function working" : "Global function failed",
                            variant: success ? "default" : "destructive"
                          });
                        } catch (error) {
                          console.error('Error testing global function:', error);
                          toast({
                            title: "Global Function Error",
                            description: error instanceof Error ? error.message : "Test failed",
                            variant: "destructive"
                          });
                        }
                      }}
                    >
                      Test Global Function
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-xs"
                      onClick={async () => {
                        if (!packageId) {
                          toast({
                            title: "No Package ID",
                            description: "Please provide a valid SCORM package ID to test iframe fetch",
                            variant: "destructive"
                          });
                          return;
                        }
                        
                        try {
                          // Test if the iframe can access the mock API
                          console.log('=== Testing Iframe Fetch Access ===');
                          if (iframeRef.current?.contentWindow) {
                            const testUrl = `/api/scorm-asset?packageId=${encodeURIComponent(packageId)}&path=shared%2Fscormfunctions.js`;
                            console.log('Testing iframe fetch with URL:', testUrl);
                            
                            const response = await (iframeRef.current.contentWindow as any).fetch(testUrl);
                            console.log('Iframe fetch response status:', response.status);
                            console.log('Iframe fetch response ok:', response.ok);
                            
                            if (response.ok) {
                              const blob = await response.blob();
                              console.log('Iframe fetch response blob size:', blob.size);
                              toast({
                                title: "Iframe Fetch Working",
                                description: `Successfully fetched file via iframe (${blob.size} bytes)`
                              });
                            } else {
                              const text = await response.text();
                              console.log('Iframe fetch response error:', text);
                              toast({
                                title: "Iframe Fetch Failed",
                                description: `Failed to fetch file via iframe: ${response.status} ${response.statusText}`,
                                variant: "destructive"
                              });
                            }
                          } else {
                            toast({
                              title: "No Iframe",
                              description: "No iframe available for testing",
                              variant: "destructive"
                            });
                          }
                        } catch (error) {
                          console.error('Error testing iframe fetch:', error);
                          toast({
                            title: "Iframe Fetch Error",
                            description: error instanceof Error ? error.message : "Test failed",
                            variant: "destructive"
                          });
                        }
                      }}
                    >
                      Test Iframe Fetch
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-xs"
                      onClick={async () => {
                        if (!packageId) {
                          toast({
                            title: "No Package ID",
                            description: "Please provide a valid SCORM package ID to test current iframe",
                            variant: "destructive"
                          });
                          return;
                        }
                        
                        try {
                          // Test the current iframe's fetch override
                          console.log('=== Testing Current Iframe Fetch Override ===');
                          if (iframeRef.current?.contentWindow) {
                            const iframeWindow = iframeRef.current.contentWindow as any;
                            console.log('Iframe fetch function:', iframeWindow.fetch);
                            console.log('Iframe fetch override installed:', iframeWindow.fetch !== window.fetch);
                            
                            // Test if the iframe's fetch is properly overridden
                            const testUrl = `/api/scorm-asset?packageId=${encodeURIComponent(packageId)}&path=shared%2Fscormfunctions.js`;
                            console.log('Testing current iframe fetch with URL:', testUrl);
                            
                            const response = await iframeWindow.fetch(testUrl);
                            console.log('Current iframe fetch response status:', response.status);
                            console.log('Current iframe fetch response ok:', response.ok);
                            
                            if (response.ok) {
                              const blob = await response.blob();
                              console.log('Current iframe fetch response blob size:', blob.size);
                              toast({
                                title: "Current Iframe Fetch Working",
                                description: `Successfully fetched file via current iframe (${blob.size} bytes)`
                              });
                            } else {
                              const text = await response.text();
                              console.log('Current iframe fetch response error:', text);
                              toast({
                                title: "Current Iframe Fetch Failed",
                                description: `Failed to fetch file via current iframe: ${response.status} ${response.statusText}`,
                                variant: "destructive"
                              });
                            }
                          } else {
                            toast({
                              title: "No Current Iframe",
                              description: "No current iframe available for testing",
                              variant: "destructive"
                            });
                          }
                        } catch (error) {
                          console.error('Error testing current iframe fetch:', error);
                          toast({
                            title: "Current Iframe Fetch Error",
                            description: error instanceof Error ? error.message : "Test failed",
                            variant: "destructive"
                          });
                        }
                      }}
                    >
                      Test Current Iframe Fetch
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-xs"
                      onClick={() => {
                        if (iframeRef.current?.contentWindow) {
                          try {
                            (iframeRef.current.contentWindow as any).API = (window as any).API;
                            (iframeRef.current.contentWindow as any).API_1484_11 = (window as any).API_1484_11;
                            (iframeRef.current.contentWindow as any).findAPI = (window as any).findAPI;
                            (iframeRef.current.contentWindow as any).getAPI = (window as any).getAPI;
                            
                            console.log('✓ Manual SCORM 1.2 API injection completed');
                            setState(prev => ({ ...prev, apiStatus: 'connected' }));
                            
                            // Also trigger initialization
                            const iframeAPI = (iframeRef.current.contentWindow as any).API;
                            if (iframeAPI) {
                              const initResult = iframeAPI.LMSInitialize('');
                              if (initResult === 'true') {
                                setState(prev => ({ ...prev, apiStatus: 'active' }));
                                toast({
                                  title: "SCORM 1.2 API Activated",
                                  description: "SCORM 1.2 API injected and activated successfully"
                                });
                              } else {
                                toast({
                                  title: "SCORM 1.2 API Injected",
                                  description: "SCORM 1.2 API injected but initialization failed"
                                });
                              }
                            }
                          } catch (e) {
                            console.error('❌ Manual SCORM 1.2 API injection failed:', e);
                            toast({
                              title: "SCORM 1.2 Injection Failed",
                              description: "Failed to inject SCORM 1.2 API",
                              variant: "destructive"
                            });
                          }
                        }
                      }}
                    >
                      Inject SCORM 1.2 API Manually
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-xs"
                      onClick={() => {
                        if (iframeRef.current?.contentWindow) {
                          try {
                            // Manually inject fetch override into iframe
                            const iframeWindow = iframeRef.current.contentWindow as any;
                            const originalFetch = iframeWindow.fetch;
                            
                            iframeWindow.fetch = async function(input: any, init?: any) {
                              const url = typeof input === 'string' ? input : input.toString();
                              console.log('Manual iframe fetch called with URL:', url);
                              if (url.includes('/api/scorm-asset')) {
                                console.log('Manual iframe: Intercepting SCORM asset request to:', url);
                                // Use the parent window's fetch to ensure it goes through our mock API
                                if (window.fetch) {
                                  console.log('Manual iframe: Using parent window fetch for SCORM asset');
                                  return window.fetch(input, init);
                                }
                              }
                              return originalFetch(input, init);
                            };
                            
                            console.log('✓ Manual fetch override injected into iframe');
                            toast({
                              title: "Fetch Override Injected",
                              description: "Manual fetch override injected into iframe"
                            });
                          } catch (e) {
                            console.error('❌ Manual fetch override injection failed:', e);
                            toast({
                              title: "Fetch Override Injection Failed",
                              description: "Failed to inject fetch override",
                              variant: "destructive"
                            });
                          }
                        }
                      }}
                    >
                      Inject Fetch Override Manually
                    </Button>
                  </div>
                </div>
              )}
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
              <iframe
                ref={iframeRef}
                title={DOMPurify.sanitize(currentItem.title, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] })}
                className="w-full h-full border-0 bg-white"
                sandbox="allow-scripts allow-forms allow-modals allow-same-origin allow-popups allow-top-navigation allow-downloads"
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