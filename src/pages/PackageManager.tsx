import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Upload, 
  FileText, 
  Calendar, 
  HardDrive, 
  Trash2, 
  Play, 
  Download,
  Package,
  AlertCircle,
  CheckCircle2,
  ArrowLeft,
  Bug
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { SCORMPackageManager, type SCORMPackage, type UploadProgress } from '@/lib/scorm-package-manager';
import { SCORMDebugger } from '@/components/SCORMDebugger';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function PackageManager() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [packages, setPackages] = useState<SCORMPackage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [debugPackageId, setDebugPackageId] = useState<string | null>(null);

  useEffect(() => {
    loadPackages();
  }, []);

  const loadPackages = async () => {
    try {
      setIsLoading(true);
      const storedPackages = await SCORMPackageManager.getStoredPackages();
      setPackages(storedPackages);
    } catch (error) {
      console.error('Failed to load packages:', error);
      toast({
        title: "Error",
        description: "Failed to load SCORM packages",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadProgress(null);

    try {
      const newPackage = await SCORMPackageManager.uploadPackage(
        file,
        (progress) => setUploadProgress(progress)
      );

      setPackages(prev => [newPackage, ...prev]);
      
      toast({
        title: "Upload Successful",
        description: `${newPackage.name} has been uploaded successfully`,
      });

      // Reset file input
      event.target.value = '';
      
    } catch (error) {
      console.error('Upload failed:', error);
      toast({
        title: "Upload Failed",
        description: error instanceof Error ? error.message : "Failed to upload package",
        variant: "destructive"
      });
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  }, [toast]);

  const handleDeletePackage = async (packageId: string) => {
    try {
      await SCORMPackageManager.deletePackage(packageId);
      setPackages(prev => prev.filter(pkg => pkg.id !== packageId));
      
      toast({
        title: "Package Deleted",
        description: "SCORM package has been removed",
      });
    } catch (error) {
      toast({
        title: "Delete Failed",
        description: "Failed to delete package",
        variant: "destructive"
      });
    }
  };

  const handlePlayPackage = (pkg: SCORMPackage) => {
    // Navigate to player with package ID
    navigate(`/player/${pkg.id}`);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading packages...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-slate-900 text-white shadow-lg border-b border-slate-700">
        <div className="container mx-auto p-6">
          <div className="flex items-center gap-4 mb-2">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => navigate('/')}
              className="flex items-center gap-2 border-slate-600 text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Dashboard
            </Button>
          </div>
          <div className="flex items-center gap-4">
            <img 
              src="/lovable-uploads/2d90e592-5f80-484d-b3c7-2baacd1b6118.png" 
              alt="Pathful" 
              className="h-10 w-auto"
            />
            <div>
              <h1 className="text-3xl font-bold">Content Library Manager</h1>
              <p className="text-slate-300 mt-1">Upload, validate, and manage SCORM packages for platform deployment</p>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto p-6">

        {/* Upload Section */}
        <Card className="mb-8 border-emerald-200 shadow-lg">
          <CardHeader className="bg-emerald-50 border-b border-emerald-200">
            <CardTitle className="flex items-center gap-2 text-emerald-800">
              <Upload className="h-5 w-5" />
              Upload SCORM Package
            </CardTitle>
            <CardDescription className="text-emerald-700">
              Upload ZIP files containing SCORM 1.2 or SCORM 2004 content packages for platform deployment
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="space-y-4">
              <div className="border-2 border-dashed border-emerald-300 bg-emerald-50 rounded-lg p-8 text-center">
                <div className="bg-emerald-600 rounded-full p-4 w-fit mx-auto mb-4">
                  <Package className="h-8 w-8 text-white" />
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium text-emerald-800">Choose SCORM package to upload</p>
                  <p className="text-xs text-emerald-600">
                    Supports ZIP files up to 100MB containing imsmanifest.xml • Ready for iframe integration
                  </p>
                </div>
                <input
                  type="file"
                  accept=".zip"
                  onChange={handleFileUpload}
                  disabled={uploading}
                  className="hidden"
                  id="scorm-upload"
                />
                <Button
                  variant="default"
                  className="mt-4 bg-emerald-600 hover:bg-emerald-700"
                  disabled={uploading}
                  onClick={() => document.getElementById('scorm-upload')?.click()}
                >
                  {uploading ? 'Processing Package...' : 'Select ZIP File'}
                </Button>
              </div>

              {/* Upload Progress */}
              {uploadProgress && (
                <Card className="border-emerald-200 bg-emerald-50">
                  <CardContent className="pt-6">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium capitalize text-emerald-800">
                          {uploadProgress.stage.replace('_', ' ')}
                        </span>
                        <span className="text-sm text-emerald-600">
                          {uploadProgress.progress}%
                        </span>
                      </div>
                      <Progress value={uploadProgress.progress} className="h-2" />
                      <p className="text-xs text-emerald-600">
                        {uploadProgress.message}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Package List */}
        <Card className="shadow-lg">
          <CardHeader className="bg-slate-50 border-b">
            <CardTitle className="flex items-center gap-2 text-slate-800">
              <FileText className="h-5 w-5" />
              Content Library ({packages.length} packages)
            </CardTitle>
            <CardDescription className="text-slate-600">
              Manage uploaded SCORM packages • Ready for iframe deployment
            </CardDescription>
          </CardHeader>
          <CardContent>
            {packages.length === 0 ? (
              <div className="text-center py-12">
                <div className="bg-slate-100 rounded-full p-6 w-fit mx-auto mb-4">
                  <Package className="h-12 w-12 text-slate-400" />
                </div>
                <h3 className="text-lg font-medium mb-2 text-slate-700">No packages in library</h3>
                <p className="text-slate-500 mb-4">
                  Upload your first SCORM package to start building your content library
                </p>
              </div>
            ) : (
              <ScrollArea className="h-[400px]">
                <div className="space-y-4">
                  {packages.map((pkg) => (
                    <Card key={pkg.id} className="transition-all hover:shadow-md">
                      <CardContent className="pt-6">
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-3 mb-2">
                              <FileText className="h-5 w-5 text-primary flex-shrink-0" />
                              <h3 className="font-semibold truncate">{pkg.name}</h3>
                              <Badge variant="secondary" className="ml-auto">
                                {pkg.manifest.version || 'SCORM 1.2'}
                              </Badge>
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4 text-sm text-muted-foreground">
                              <div className="flex items-center gap-2">
                                <Calendar className="h-4 w-4" />
                                <span>
                                  {pkg.uploadDate.toLocaleDateString()}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <HardDrive className="h-4 w-4" />
                                <span>
                                  {SCORMPackageManager.formatFileSize(pkg.size)}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <CheckCircle2 className="h-4 w-4 text-green-500" />
                                <span>Ready to play</span>
                              </div>
                            </div>

                            {pkg.manifest.title && (
                              <p className="text-sm text-muted-foreground mb-3">
                                {pkg.manifest.title}
                              </p>
                            )}

                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                onClick={() => handlePlayPackage(pkg)}
                                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700"
                              >
                                <Play className="h-4 w-4" />
                                Test Package
                              </Button>
                              
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setDebugPackageId(pkg.id)}
                                className="flex items-center gap-2"
                              >
                                <Bug className="h-4 w-4" />
                                Debug
                              </Button>
                              
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleDeletePackage(pkg.id)}
                                className="flex items-center gap-2 text-destructive hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                                Delete
                              </Button>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Debug Dialog */}
      <Dialog open={!!debugPackageId} onOpenChange={(open) => !open && setDebugPackageId(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>SCORM Package Debugger</DialogTitle>
          </DialogHeader>
          {debugPackageId && <SCORMDebugger packageId={debugPackageId} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}