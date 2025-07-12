# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
- `npm run dev` - Start the development server on port 8080
- `npm run build` - Build the production application
- `npm run build:dev` - Build the application in development mode
- `npm run preview` - Preview the production build
- `npm run lint` - Run ESLint to check code quality

### Installation
- `npm install` - Install all dependencies

## Architecture Overview

This is a SCORM Content Navigator application built with React, TypeScript, and Vite. The application provides tools for managing, authoring, and playing SCORM (Sharable Content Object Reference Model) educational content.

### Technology Stack
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite with SWC
- **UI Components**: shadcn-ui (built on Radix UI)
- **Styling**: Tailwind CSS with CSS variables for theming
- **State Management**: React Query (TanStack Query)
- **Routing**: React Router v6
- **Form Handling**: React Hook Form with Zod validation

### Core Architecture

The application follows a standard React SPA architecture with the following key components:

1. **SCORM API Layer** (`/src/lib/scorm-*.ts`)
   - `scorm-api.ts`: Implements the SCORM Runtime API with local data store
   - `scorm-manifest.ts`: Handles SCORM manifest (imsmanifest.xml) parsing and validation
   - `scorm-package-manager.ts`: Manages SCORM package operations (upload, extract, store)

2. **Page Components** (`/src/pages/`)
   - `Index.tsx`: Main page with SCORM player functionality
   - `PackageManager.tsx`: SCORM package upload and management interface
   - `ContentAuthor.tsx`: Template selection for content creation
   - `ContentBuilder.tsx`: Content building interface with template system

3. **SCORM Player** (`/src/components/SCORMPlayer.tsx`)
   - Embeds SCORM content in an iframe
   - Provides SCORM API implementation to content
   - Handles communication between content and LMS-like functionality

4. **UI Components** (`/src/components/ui/`)
   - Comprehensive set of 45+ shadcn-ui components
   - Consistent theming through CSS variables
   - Dark mode support via next-themes

### Important Patterns

1. **SCORM Communication**: The app implements the SCORM 1.2 API through the window object, allowing SCORM content to communicate with the player.

2. **Package Storage**: SCORM packages are stored in `/public/uploads/` after extraction from ZIP files.

3. **Routing Structure**:
   - `/` - Main player interface
   - `/packages` - Package management
   - `/author` - Content authoring
   - `/author/build/:templateId` - Content builder
   - `/player/:packageId?` - Direct player access

4. **TypeScript Configuration**: The project uses relaxed TypeScript settings (no strict mode) with path aliases configured (`@/*` maps to `./src/*`).

### Development Notes

- No testing framework is currently configured
- ESLint is configured for code quality checks
- The application was initially created with Lovable.dev
- All SCORM content is served from the public directory after extraction

### Important Rules

#### Samples Folder - Reference Only
The `/Samples/` folder contains reference SCORM content that is **NOT** part of this project and should **NEVER** be altered:

- **RuntimeMinimumCalls_SCORM12/**: Official SCORM 1.2 reference content from the organization responsible for SCORM standards
- **Computer and Technology Literacy_Demonstrating Computer and Technology Literacy/**: Complex SCORM content example for reference purposes

**Rule**: These samples are provided for reference and testing purposes only. They must remain unchanged to preserve their integrity as reference materials. Any modifications to these files are strictly prohibited.