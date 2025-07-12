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
    
    // Wrap API methods to track activity
    const wrappedAPI = {
      LMSInitialize: (param: string) => {
        console.log('SCORM: LMSInitialize called');
        if (isInitialized) {
          console.log('SCORM: Already initialized, returning false');
          setState(prev => ({ ...prev, lastApiCall: 'LMSInitialize (already initialized)' }));
          return 'false'; // ✅ Return 'false' per SCORM spec
        }
        setState(prev => ({ ...prev, apiStatus: 'active', lastApiCall: 'LMSInitialize' }));
        const result = API.lmsInitialize();
        if (result === 'true') {
          isInitialized = true;
        }
        return result;
      },
      LMSFinish: (param: string) => {
        console.log('SCORM: LMSFinish called');
        setState(prev => ({ ...prev, apiStatus: 'connected', lastApiCall: 'LMSFinish' }));
        const result = API.lmsFinish();
        if (result === 'true') {
          isInitialized = false; // Reset initialization state
        }
        return result;
      },
      LMSGetValue: (element: string) => {
        console.log(`SCORM: LMSGetValue("${element}")`);
        setState(prev => ({ ...prev, apiStatus: 'active', lastApiCall: `LMSGetValue: ${element}` }));
        
        // Add validation for required elements
        if (!element || typeof element !== 'string') {
          return '';
        }
        
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
        return API.lmsCommit();
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

  const loadSCO = useCallback(async (itemIndex: number) => {
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
            
            // Check if this is Articulate Storyline content
            const isStorylineContent = text.includes('Articulate') || 
                                     text.includes('Storyline') || 
                                     text.includes('lms/scormdriver.js') ||
                                     text.includes('story_content/user.js');
            
            console.log('Content type detected:', isStorylineContent ? 'Storyline' : 'Standard HTML');
            
            // Enhanced SCORM API injection with better error handling
            const scormApiScript = `
              <script>
                // Enhanced SCORM API injection
                console.log('SCORM API injection starting...');
                
                // Make APIs available immediately
                if (window.parent && window.parent.API) {
                  window.API = window.parent.API;
                  window.API_1484_11 = window.parent.API_1484_11;
                  console.log("✓ SCORM API injected from parent");
                }
                
                // Standard SCORM API discovery
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
                
                // Auto-initialize SCORM when page loads
                function initializeSCORM() {
                  try {
                    const api = window.getAPI();
                    if (api) {
                      console.log('Initializing SCORM session...');
                      const initResult = api.LMSInitialize('');
                      console.log('LMSInitialize result:', initResult);
                      
                      if (initResult === 'true') {
                        console.log('✓ SCORM session initialized successfully');
                        // Set initial status
                        api.LMSSetValue('cmi.core.lesson_status', 'incomplete');
                        api.LMSCommit('');
                      } else {
                        console.warn('⚠ SCORM initialization returned false');
                      }
                    } else {
                      console.warn('⚠ SCORM API not available for initialization');
                    }
                  } catch (e) {
                    console.error('❌ SCORM initialization failed:', e);
                  }
                }
                
                // Initialize when DOM is ready
                if (document.readyState === 'loading') {
                  document.addEventListener('DOMContentLoaded', initializeSCORM);
                } else {
                  initializeSCORM();
                }
                
                console.log('✓ SCORM API injection completed');
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
                  // Storyline-specific SCORM API injection
                  console.log('Storyline SCORM API injection starting...');
                  
                  // Make APIs available immediately for Storyline
                  if (window.parent && window.parent.API) {
                    window.API = window.parent.API;
                    window.API_1484_11 = window.parent.API_1484_11;
                    console.log("✓ Storyline SCORM API injected from parent");
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
                        console.log('Initializing Storyline SCORM session...');
                        
                        // Storyline often needs multiple initialization attempts
                        let initResult = api.LMSInitialize('');
                        console.log('Storyline LMSInitialize result:', initResult);
                        
                        if (initResult === 'true') {
                          console.log('✓ Storyline SCORM session initialized successfully');
                          // Set initial status for Storyline
                          api.LMSSetValue('cmi.core.lesson_status', 'incomplete');
                          api.LMSCommit('');
                        } else {
                          console.warn('⚠ Storyline SCORM initialization returned false, retrying...');
                          
                          // Retry with a delay - Storyline sometimes needs time to fully load
                          setTimeout(() => {
                            try {
                              console.log('Retrying Storyline SCORM initialization...');
                              const retryResult = api.LMSInitialize('');
                              console.log('Storyline retry result:', retryResult);
                              
                              if (retryResult === 'true') {
                                console.log('✓ Storyline SCORM session initialized on retry');
                                api.LMSSetValue('cmi.core.lesson_status', 'incomplete');
                                api.LMSCommit('');
                              } else {
                                console.warn('⚠ Storyline SCORM retry also failed, trying alternative approach...');
                                
                                // Try alternative initialization approach for Storyline
                                setTimeout(() => {
                                  try {
                                    // Some Storyline content needs specific parameters
                                    const altResult = api.LMSInitialize('true');
                                    console.log('Storyline alternative init result:', altResult);
                                    
                                    if (altResult === 'true') {
                                      console.log('✓ Storyline SCORM session initialized with alternative method');
                                      api.LMSSetValue('cmi.core.lesson_status', 'incomplete');
                                      api.LMSCommit('');
                                    } else {
                                      console.error('❌ All Storyline SCORM initialization attempts failed');
                                    }
                                  } catch (e) {
                                    console.error('❌ Alternative Storyline initialization failed:', e);
                                  }
                                }, 1000);
                              }
                            } catch (e) {
                              console.error('❌ Storyline SCORM retry failed:', e);
                            }
                          }, 2000); // Longer delay for Storyline
                        }
                      } else {
                        console.warn('⚠ Storyline SCORM API not available for initialization');
                        
                        // Try to find API using alternative methods
                        setTimeout(() => {
                          try {
                            const foundAPI = window.findAPI(window);
                            if (foundAPI) {
                              console.log('✓ Found Storyline SCORM API via alternative method');
                              initializeStorylineSCORM();
                            } else {
                              console.error('❌ Storyline SCORM API not found via any method');
                            }
                          } catch (e) {
                            console.error('❌ Alternative API discovery failed:', e);
                          }
                        }, 1000);
                      }
                    } catch (e) {
                      console.error('❌ Storyline SCORM initialization failed:', e);
                    }
                  }
                  
                  // Initialize when DOM is ready for Storyline
                  if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', initializeStorylineSCORM);
                  } else {
                    // For already loaded content, delay initialization to ensure Storyline is ready
                    setTimeout(initializeStorylineSCORM, 1000);
                  }
                  
                  console.log('✓ Storyline SCORM API injection completed');
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
            
            // Create blob URL for the modified HTML
            const htmlBlob = new Blob([modifiedHtml], { type: 'text/html; charset=utf-8' });
            contentUrl = URL.createObjectURL(htmlBlob);
            console.log('✓ HTML content prepared with SCORM API injection');
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
                    console.log("✓ SCORM API injected (fallback)");
                  }
                </script>
              `;
              const modifiedHtml = text.replace(
                /<head([^>]*)>/i,
                `<head$1>${scormApiScript}`
              );
              const htmlBlob = new Blob([modifiedHtml], { type: 'text/html; charset=utf-8' });
              contentUrl = URL.createObjectURL(htmlBlob);
              console.log('✓ Using fallback HTML file');
            } else {
              throw new Error(`Content file "${item.href}" not found in package. Available files: ${debugInfo.fileList.join(', ')}`);
            }
          } else {
            throw new Error(`Content file "${item.href}" not found in package. No HTML files available. Available files: ${debugInfo.fileList.join(', ')}`);
          }
        }
      } else {
        // Create demo content for demo mode
        const demoContent = createDemoContent(item);
        const blob = new Blob([demoContent], { type: 'text/html' });
        contentUrl = URL.createObjectURL(blob);
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
              
              console.log('✓ SCORM APIs injected immediately');
              setState(prev => ({ ...prev, apiStatus: 'connected' }));
              
              // Trigger initial SCORM session with retry logic
              setTimeout(() => {
                try {
                  if (iframeRef.current?.contentWindow) {
                    const iframeAPI = (iframeRef.current.contentWindow as any).API;
                    if (iframeAPI) {
                      console.log('Triggering initial SCORM session...');
                      const initResult = iframeAPI.LMSInitialize('');
                      console.log('Initial LMSInitialize result:', initResult);
                      
                      if (initResult === 'true') {
                        setState(prev => ({ ...prev, apiStatus: 'active' }));
                        console.log('✓ SCORM session activated');
                        
                        // Set initial status
                        iframeAPI.LMSSetValue('cmi.core.lesson_status', 'incomplete');
                        iframeAPI.LMSCommit('');
                      } else {
                        console.warn('⚠ SCORM initialization returned false, will retry...');
                        // Retry with longer delay
                        setTimeout(() => {
                          try {
                            const retryResult = iframeAPI.LMSInitialize('');
                            if (retryResult === 'true') {
                              setState(prev => ({ ...prev, apiStatus: 'active' }));
                              console.log('✓ SCORM session activated on retry');
                              iframeAPI.LMSSetValue('cmi.core.lesson_status', 'incomplete');
                              iframeAPI.LMSCommit('');
                            }
                          } catch (e) {
                            console.error('❌ SCORM retry failed:', e);
                          }
                        }, 1000);
                      }
                    }
                  }
                } catch (e) {
                  console.error('❌ Failed to initialize SCORM session:', e);
                }
              }, 200); // Increased delay to ensure content is ready
            } catch (e) {
              console.error('❌ Failed to inject SCORM API:', e);
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
                    try {
                        window.API.LMSSetValue('cmi.core.score.raw', progress.toString());
                        window.API.LMSCommit('');
                    } catch (e) {
                        console.error('❌ Failed to update progress:', e);
                    }
                }
            }
            
            function updateSessionTime() {
                const elapsed = Math.floor((new Date() - startTime) / 1000);
                const hours = Math.floor(elapsed / 3600).toString().padStart(2, '0');
                const minutes = Math.floor((elapsed % 3600) / 60).toString().padStart(2, '0');
                const seconds = (elapsed % 60).toString().padStart(2, '0');
                
                document.getElementById('sessionTime').textContent = hours + ':' + minutes + ':' + seconds;
                
                if (window.API) {
                    try {
                        window.API.LMSSetValue('cmi.core.session_time', hours + ':' + minutes + ':' + seconds);
                    } catch (e) {
                        console.error('❌ Failed to update session time:', e);
                    }
                }
            }
            
            function completeLesson() {
                if (window.API) {
                    try {
                        window.API.LMSSetValue('cmi.core.lesson_status', 'completed');
                        window.API.LMSSetValue('cmi.core.score.raw', '100');
                        window.API.LMSCommit('');
                        window.API.LMSFinish('');
                        console.log('✓ Lesson completed successfully via SCORM API');
                    } catch (e) {
                        console.error('❌ Failed to complete lesson via SCORM API:', e);
                    }
                }
                
                document.getElementById('status').textContent = 'Completed';
                document.getElementById('progressBar').style.width = '100%';
                alert('Lesson completed successfully!');
            }
            
            // Initialize SCORM
            function initializeSCORM() {
                if (window.API) {
                    try {
                        console.log('Initializing SCORM session...');
                        const initResult = window.API.LMSInitialize('');
                        console.log('LMSInitialize result:', initResult);
                        
                        if (initResult === 'true') {
                            window.API.LMSSetValue('cmi.core.lesson_status', 'incomplete');
                            console.log('✓ SCORM session initialized successfully');
                        } else {
                            console.warn('⚠ SCORM initialization returned false');
                        }
                    } catch (e) {
                        console.error('❌ SCORM initialization failed:', e);
                    }
                } else {
                    console.warn('⚠ SCORM API not available for initialization');
                }
            }
            
            // Initialize when page loads
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', initializeSCORM);
            } else {
                initializeSCORM();
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
        
        // Update UI status to active
        setState(prev => ({ ...prev, apiStatus: 'active' }));
        toast({
          title: "SCORM Test Successful",
          description: "All SCORM API calls completed successfully"
        });
      } catch (e) {
        console.error('❌ Window API test failed:', e);
        toast({
          title: "SCORM Test Failed",
          description: "Error testing SCORM API calls",
          variant: "destructive"
        });
      }
    } else {
      console.log('❌ Window API not available');
      toast({
        title: "SCORM API Not Available",
        description: "Window SCORM API is not accessible",
        variant: "destructive"
      });
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
          
          if (initResult === 'true') {
            setState(prev => ({ ...prev, apiStatus: 'active' }));
          }
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

  const debugContentLoading = async () => {
    console.log('=== Debugging Content Loading ===');
    
    if (!packageId) {
      console.log('No packageId provided - running in demo mode');
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
      }
      
      toast({
        title: "Debug Complete",
        description: "Check console for detailed debug information"
      });
      
    } catch (error) {
      console.error('Debug error:', error);
      toast({
        title: "Debug Failed",
        description: error instanceof Error ? error.message : "Debug operation failed",
        variant: "destructive"
      });
    }
  };

  const testContentLoading = async () => {
    console.log('=== Testing Content Loading ===');
    
    if (!packageId) {
      console.log('No packageId - testing demo mode');
      // Test demo content loading
      const demoItem = {
        identifier: 'test',
        title: 'Test Content',
        href: 'test.html',
        isVisible: true,
        children: []
      };
      
      const demoContent = createDemoContent(demoItem);
      const blob = new Blob([demoContent], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      
      console.log('Demo content URL:', url);
      console.log('Demo content length:', demoContent.length);
      
      toast({
        title: "Demo Test Complete",
        description: "Demo content created successfully"
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
      console.log('Testing file:', testFile);
      
      const blob = await SCORMPackageManager.getPackageFile(packageId, testFile);
      if (blob) {
        const text = await blob.text();
        console.log('File loaded successfully:', {
          size: blob.size,
          textLength: text.length,
          hasHead: text.includes('<head'),
          hasBody: text.includes('<body'),
          hasScript: text.includes('<script')
        });
        
        toast({
          title: "File Load Test Successful",
          description: `Successfully loaded ${testFile} (${blob.size} bytes)`
        });
      } else {
        toast({
          title: "File Load Test Failed",
          description: `Failed to load ${testFile}`,
          variant: "destructive"
        });
      }
      
    } catch (error) {
      console.error('Test error:', error);
      toast({
        title: "Test Failed",
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
              
              // Try to get the asset from the package
              const response = await fetch('/api/scorm-asset?packageId=${packageId}&path=' + encodeURIComponent(path));
              if (response.ok) {
                const blob = await response.blob();
                return URL.createObjectURL(blob);
              }
              
              // Fallback to original path
              return path;
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
                      // For now, let it load normally but log it
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

            {/* Debug Info Collapsible Pane */}
            <div className="border-b">
              <Button
                variant="ghost"
                className="w-full justify-between p-3 text-sm"
                onClick={() => setState(prev => ({ ...prev, showDebugInfo: !prev.showDebugInfo }))}
              >
                <span className="font-medium">SCORM Debug Info</span>
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
                    <div className="font-semibold mb-1">API Status</div>
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
                      Test SCORM API
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
                      onClick={() => {
                        if (iframeRef.current?.contentWindow) {
                          try {
                            (iframeRef.current.contentWindow as any).API = (window as any).API;
                            (iframeRef.current.contentWindow as any).API_1484_11 = (window as any).API_1484_11;
                            (iframeRef.current.contentWindow as any).findAPI = (window as any).findAPI;
                            (iframeRef.current.contentWindow as any).getAPI = (window as any).getAPI;
                            
                            console.log('✓ Manual API injection completed');
                            setState(prev => ({ ...prev, apiStatus: 'connected' }));
                            
                            // Also trigger initialization
                            const iframeAPI = (iframeRef.current.contentWindow as any).API;
                            if (iframeAPI) {
                              const initResult = iframeAPI.LMSInitialize('');
                              if (initResult === 'true') {
                                setState(prev => ({ ...prev, apiStatus: 'active' }));
                                toast({
                                  title: "API Activated",
                                  description: "SCORM API injected and activated successfully"
                                });
                              } else {
                                toast({
                                  title: "API Injected",
                                  description: "SCORM API injected but initialization failed"
                                });
                              }
                            }
                          } catch (e) {
                            console.error('❌ Manual API injection failed:', e);
                            toast({
                              title: "Injection Failed",
                              description: "Failed to inject SCORM API",
                              variant: "destructive"
                            });
                          }
                        }
                      }}
                    >
                      Inject API Manually
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