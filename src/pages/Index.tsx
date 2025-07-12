import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Package, Upload, FileText } from 'lucide-react';
import { SCORMPlayer } from '@/components/SCORMPlayer';

const Index = () => {
  const { packageId } = useParams();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 dark:from-slate-950 dark:via-blue-950 dark:to-indigo-950">
      {/* Header Navigation */}
      <div className="bg-slate-900 text-white shadow-lg border-b border-slate-700">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img 
                src="/lovable-uploads/2d90e592-5f80-484d-b3c7-2baacd1b6118.png" 
                alt="Pathful" 
                className="h-8 w-auto"
              />
              <div>
                <h1 className="text-2xl font-bold">SCORM Content Manager</h1>
                <p className="text-sm text-slate-300">Internal Team Tool</p>
              </div>
            </div>
            <Button 
              onClick={() => navigate('/packages')}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700"
            >
              <Upload className="h-4 w-4" />
              Upload SCORM File
            </Button>
          </div>
        </div>
      </div>

      {packageId ? (
        // Show SCORM Player when packageId is provided
        <SCORMPlayer packageId={packageId} />
      ) : (
        // Show welcome screen when no package is selected
        <div className="container mx-auto px-6 py-16">
          <div className="max-w-5xl mx-auto">
            {/* Team Dashboard Header */}
            <div className="text-center mb-12">
              <div className="inline-flex items-center gap-2 bg-slate-800 text-white px-4 py-2 rounded-full text-sm font-medium mb-6">
                <Package className="h-4 w-4" />
                Pathful Team Dashboard
              </div>
              <h2 className="text-4xl font-bold mb-4 text-white">
                SCORM Content Management System
              </h2>
              <p className="text-xl text-slate-600 max-w-3xl mx-auto">
                Upload, validate, and deploy SCORM packages for iframe integration across the Pathful platform
              </p>
            </div>
            
            {/* Action Cards */}
            <div className="grid md:grid-cols-3 gap-6 mb-12">
              <Card className="border-2 border-emerald-200 bg-emerald-50 hover:border-emerald-300 transition-colors">
                <div className="p-8 text-left">
                  <div className="bg-emerald-600 rounded-lg p-3 w-fit mb-4">
                    <Upload className="h-8 w-8 text-white" />
                  </div>
                  <h3 className="text-xl font-semibold mb-3">Upload & Validate</h3>
                  <p className="text-slate-600 mb-4">
                    Upload SCORM packages, validate manifest files, and prepare content for platform deployment
                  </p>
                  <Button 
                    onClick={() => navigate('/packages')}
                    className="w-full bg-emerald-600 hover:bg-emerald-700"
                  >
                    Upload SCORM File
                  </Button>
                </div>
              </Card>
              
              <Card className="border-2 border-blue-200 bg-blue-50 hover:border-blue-300 transition-colors">
                <div className="p-8 text-left">
                  <div className="bg-blue-600 rounded-lg p-3 w-fit mb-4">
                    <Package className="h-8 w-8 text-white" />
                  </div>
                  <h3 className="text-xl font-semibold mb-3">Manage Packages</h3>
                  <p className="text-slate-600 mb-4">
                    View, test, and manage uploaded SCORM packages in the package manager
                  </p>
                  <Button 
                    variant="outline"
                    onClick={() => navigate('/packages')}
                    className="w-full border-blue-600 text-blue-600 hover:bg-blue-600 hover:text-white"
                  >
                    Package Manager
                  </Button>
                </div>
              </Card>

              <Card className="border-2 border-purple-200 bg-purple-50 hover:border-purple-300 transition-colors">
                <div className="p-8 text-left">
                  <div className="bg-purple-600 rounded-lg p-3 w-fit mb-4">
                    <FileText className="h-8 w-8 text-white" />
                  </div>
                  <h3 className="text-xl font-semibold mb-3">Create New Content</h3>
                  <p className="text-slate-600 mb-4">
                    Build interactive quizzes, assessments, and training modules from templates
                  </p>
                  <Button 
                    onClick={() => navigate('/author')}
                    className="w-full bg-purple-600 hover:bg-purple-700 text-white"
                  >
                    Content Authoring Studio
                  </Button>
                </div>
              </Card>
            </div>

            {/* Team Features */}
            <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-8">
              <h4 className="text-xl font-semibold mb-6 text-center">Content Creation Capabilities</h4>
              <div className="grid md:grid-cols-4 gap-6">
                <div className="text-center">
                  <div className="bg-emerald-100 rounded-full p-3 w-fit mx-auto mb-3">
                    <svg className="h-6 w-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <h5 className="font-semibold text-sm">Interactive Quizzes</h5>
                  <p className="text-xs text-slate-600 mt-1">Multiple Choice & True/False</p>
                </div>
                <div className="text-center">
                  <div className="bg-blue-100 rounded-full p-3 w-fit mx-auto mb-3">
                    <svg className="h-6 w-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                    </svg>
                  </div>
                  <h5 className="font-semibold text-sm">Drag & Drop</h5>
                  <p className="text-xs text-slate-600 mt-1">Interactive Sorting</p>
                </div>
                <div className="text-center">
                  <div className="bg-purple-100 rounded-full p-3 w-fit mx-auto mb-3">
                    <svg className="h-6 w-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                  </div>
                  <h5 className="font-semibold text-sm">Matching Games</h5>
                  <p className="text-xs text-slate-600 mt-1">Connect Related Items</p>
                </div>
                <div className="text-center">
                  <div className="bg-orange-100 rounded-full p-3 w-fit mx-auto mb-3">
                    <svg className="h-6 w-6 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                  </div>
                  <h5 className="font-semibold text-sm">Auto SCORM Generation</h5>
                  <p className="text-xs text-slate-600 mt-1">Compliant Package Creation</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Index;
