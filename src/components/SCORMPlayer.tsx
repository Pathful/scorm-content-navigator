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
        const result = API.lmsInitialize(param);
        if (result === 'true') {
          isInitialized = true;
        }
        return result;
      },
      LMSFinish: (param: string) => {
        console.log('SCORM: LMSFinish called');
        setState(prev => ({ ...prev, apiStatus: 'connected', lastApiCall: 'LMSFinish' }));
        const result = API.lmsFinish(param);
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
          // For HTML files, inject SCORM API and serve directly
          if (item.href.toLowerCase().includes('.html') || item.href.toLowerCase().includes('.htm')) {
            const text = await contentBlob.text();
            
            // Simple SCORM API injection - no complex asset processing
            const scormApiScript = `
              <script>
                // Simple SCORM API injection
                if (window.parent && window.parent.API) {
                  window.API = window.parent.API;
                  window.API_1484_11 = window.parent.API_1484_11;
                  console.log("✓ SCORM API injected");
                }
                
                // Standard SCORM API discovery
                window.findAPI = function(win) {
                  var findAttempts = 0;
                  while ((win.API == null) && (win.parent != null) && (win.parent != win)) {
                    findAttempts++;
                    if (findAttempts > 7) return null;
                    win = win.parent;
                  }
                  return win.API;
                };
                
                window.getAPI = function() {
                  return window.API || window.findAPI(window);
                };
              </script>
            `;
            
            // Inject API script into the HTML
            let modifiedHtml = text;
            if (text.includes('<head')) {
              modifiedHtml = text.replace(
                /<head([^>]*)>/i,
                `<head$1>${scormApiScript}`
              );
            } else {
              modifiedHtml = scormApiScript + text;
            }
            
            // Create blob URL for the modified HTML
            const htmlBlob = new Blob([modifiedHtml], { type: 'text/html; charset=utf-8' });
            contentUrl = URL.createObjectURL(htmlBlob);
          } else {
            // For non-HTML files, serve directly
            contentUrl = URL.createObjectURL(contentBlob);
          }
        } else {
          console.error('Content file not found. Tried paths:', possiblePaths);
          throw new Error(`Content file "${item.href}" not found in package.`);
        }
      } else {
        // Create demo content for demo mode
        const demoContent = createDemoContent(item);
        const blob = new Blob([demoContent], { type: 'text/html' });
        contentUrl = URL.createObjectURL(blob);
      }

      // Initialize SCORM session
      // Remove this section - let content handle its own initialization
      // if (scormAdapterRef.current) {
      //   scormAdapterRef.current.getSCORM12API().lmsInitialize('');
      //   scormAdapterRef.current.updateStudentData({
      //     lessonLocation: item.identifier,
      //     lessonStatus: 'incomplete'
      //   });
      // }

      setState(prev => ({
        ...prev,
        currentItemIndex: itemIndex,
        isPlaying: true,
        lessonStatus: 'incomplete'
      }));

      // Load content into iframe
      if (iframeRef.current) {
        iframeRef.current.src = contentUrl;
      }

      // Immediate API injection
      iframeRef.current.onload = () => {
        console.log('Iframe loaded successfully');
        
        // Inject SCORM API immediately
        if (iframeRef.current?.contentWindow) {
          try {
            (iframeRef.current.contentWindow as any).API = (window as any).API;
            (iframeRef.current.contentWindow as any).API_1484_11 = (window as any).API_1484_11;
            (iframeRef.current.contentWindow as any).findAPI = (window as any).findAPI;
            (iframeRef.current.contentWindow as any).getAPI = (window as any).getAPI;
            
            console.log('✓ SCORM APIs injected immediately');
            setState(prev => ({ ...prev, apiStatus: 'connected' }));
          } catch (e) {
            console.error('❌ Failed to inject SCORM API:', e);
            setState(prev => ({ ...prev, apiStatus: 'disconnected' }));
          }
        }
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
                sandbox="allow-scripts allow-forms allow-modals allow-same-origin"
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