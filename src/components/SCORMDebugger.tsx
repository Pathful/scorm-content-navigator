import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { SCORMPackageManager } from '@/lib/scorm-package-manager';
import { FileText, Package, AlertCircle, CheckCircle2, Info } from 'lucide-react';

interface SCORMDebuggerProps {
  packageId: string;
}

export function SCORMDebugger({ packageId }: SCORMDebuggerProps) {
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    debugPackage();
  }, [packageId]);

  const debugPackage = async () => {
    try {
      setLoading(true);
      
      // Get debug info from the package manager
      const info = await SCORMPackageManager.getPackageDebugInfo(packageId);
      
      if (!info.packageExists) {
        setDebugInfo({ error: info.error || 'Package not found' });
        return;
      }

      // Get the package details
      const pkg = await SCORMPackageManager.getPackageById(packageId);
      if (!pkg) {
        setDebugInfo({ error: 'Package metadata not found' });
        return;
      }

      const manifest = pkg.manifest;
      const resources = manifest.resources || [];
      const items = manifest.organizations?.[0]?.items || [];
      
      // Check for index_lms.html specifically (but don't require it)
      const hasIndexLms = info.fileList.some(f => 
        f.toLowerCase().includes('index_lms.html') || 
        f.toLowerCase().includes('index_lms.htm')
      );

      // Find actual entry points from manifest and check if they exist
      const entryPoints = resources
        .filter(r => r.href)
        .map(r => {
          const href = r.href;
          const normalizedHref = href.replace(/^\/+/, ''); // Remove leading slashes
          const exists = info.fileList.some(f => 
            f.toLowerCase() === href.toLowerCase() ||
            f.toLowerCase() === normalizedHref.toLowerCase() ||
            f.toLowerCase() === '/' + normalizedHref.toLowerCase()
          );
          
          return {
            id: r.identifier,
            href: r.href,
            type: r.type,
            exists
          };
        });

      // Check if any entry points from manifest actually exist
      const hasValidEntryPoints = entryPoints.some(ep => ep.exists);

      // Find files that look like they could be entry points (only if no valid entry points)
      const potentialEntryFiles = !hasValidEntryPoints ? info.fileList.filter(f => 
        (f.toLowerCase().includes('index') || 
         f.toLowerCase().includes('start') || 
         f.toLowerCase().includes('launch')) &&
        (f.toLowerCase().endsWith('.html') || f.toLowerCase().endsWith('.htm'))
      ) : [];

      setDebugInfo({
        packageId,
        title: manifest.title,
        totalFiles: info.fileCount,
        totalSize: SCORMPackageManager.formatFileSize(info.totalSize),
        hasManifest: info.fileList.includes('imsmanifest.xml'),
        hasIndexLms,
        hasValidEntryPoints,
        entryPoints,
        fileList: info.fileList,
        potentialEntryFiles,
        items: items.map(item => ({
          title: item.title,
          href: item.href,
          identifier: item.identifier
        }))
      });
    } catch (error) {
      console.error('Debug error:', error);
      setDebugInfo({ error: error instanceof Error ? error.message : 'Debug failed' });
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="p-4 text-center">Loading debug info...</div>;
  }

  if (debugInfo?.error) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-2 text-destructive">
          <AlertCircle className="h-5 w-5" />
          <span>Error: {debugInfo.error}</span>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          <Package className="h-5 w-5" />
          Package Overview
        </h3>
        
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Title:</span>
            <span className="font-medium">{debugInfo.title}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Total Files:</span>
            <span className="font-medium">{debugInfo.totalFiles}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Total Size:</span>
            <span className="font-medium">{debugInfo.totalSize}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Manifest:</span>
            {debugInfo.hasManifest ? 
              <Badge variant="default"><CheckCircle2 className="h-3 w-3 mr-1" />Found</Badge> : 
              <Badge variant="destructive"><AlertCircle className="h-3 w-3 mr-1" />Missing</Badge>
            }
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">index_lms.html:</span>
            {debugInfo.hasIndexLms ? 
              <Badge variant="default"><CheckCircle2 className="h-3 w-3 mr-1" />Found</Badge> : 
              <Badge variant="secondary"><AlertCircle className="h-3 w-3 mr-1" />Not Found</Badge>
            }
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Entry Points:</span>
            {debugInfo.hasValidEntryPoints ? 
              <Badge variant="default"><CheckCircle2 className="h-3 w-3 mr-1" />Valid</Badge> : 
              <Badge variant="destructive"><AlertCircle className="h-3 w-3 mr-1" />Missing</Badge>
            }
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="font-semibold mb-4">Entry Points from Manifest</h3>
        {debugInfo.entryPoints.length === 0 ? (
          <p className="text-sm text-muted-foreground">No entry points defined in manifest</p>
        ) : (
          <div className="space-y-2">
            {debugInfo.entryPoints.map((ep: any) => (
              <div key={ep.id} className="flex items-center justify-between text-sm p-2 bg-muted rounded">
                <span className="font-mono">{ep.href}</span>
                {ep.exists ? 
                  <Badge variant="default">Exists</Badge> : 
                  <Badge variant="destructive">Missing</Badge>
                }
              </div>
            ))}
          </div>
        )}
              </Card>

      {debugInfo.hasValidEntryPoints && (
        <Card className="p-4 border-green-200 bg-green-50">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5" />
            <div className="space-y-2">
              <p className="text-sm font-medium text-green-900">
                Valid Entry Points Found
              </p>
              <p className="text-sm text-green-800">
                Your SCORM package has valid entry points defined in the manifest and the files exist.
              </p>
            </div>
          </div>
        </Card>
      )}

      {!debugInfo.hasValidEntryPoints && debugInfo.potentialEntryFiles.length > 0 && (
        <Card className="p-4 border-amber-200 bg-amber-50">
          <div className="flex items-start gap-2">
            <Info className="h-5 w-5 text-amber-600 mt-0.5" />
            <div className="space-y-2">
              <p className="text-sm font-medium text-amber-900">
                Potential Entry Files Found
              </p>
              <p className="text-sm text-amber-800">
                No valid entry points were found in your manifest. These files might be what you're looking for:
              </p>
              <div className="space-y-1">
                {debugInfo.potentialEntryFiles.map((file: string) => (
                  <div key={file} className="text-sm font-mono bg-amber-100 rounded px-2 py-1">
                    {file}
                  </div>
                ))}
              </div>
              <p className="text-xs text-amber-700 mt-2">
                Update your imsmanifest.xml to point to one of these files.
              </p>
            </div>
          </div>
        </Card>
      )}

      <Card className="p-4">
        <h3 className="font-semibold mb-4">All Files in Package</h3>
        <ScrollArea className="h-64 border rounded p-2">
          <div className="space-y-1">
            {debugInfo.fileList.length === 0 ? (
              <p className="text-sm text-muted-foreground p-4 text-center">
                No files found in package - upload may have failed
              </p>
            ) : (
              debugInfo.fileList.map((file: string) => (
                <div key={file} className="text-sm font-mono flex items-center gap-2 hover:bg-muted px-2 py-1 rounded">
                  <FileText className="h-3 w-3 text-muted-foreground" />
                  {file}
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </Card>
    </div>
  );
}