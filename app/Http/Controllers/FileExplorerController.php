<?php

namespace App\Http\Controllers;

use App\Models\File;
use App\Models\Folder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;

class FileExplorerController extends Controller
{
    /**
     * Get files and folders for the explorer
     */
    public function index(Request $request)
    {
        $path = $request->input('path', '/');
        $user = Auth::user();

        // Get current folder based on path
        $currentFolder = null;
        if ($path === '/') {
            // Root level - get files with no folder
            $currentFolderId = null;
            $files = File::where('user_id', $user->id)
                ->where('folder_id', null)
                ->get()
                ->map(function ($file) {
                    $file->type = 'file'; // Explicitly mark as file
                    return $file;
                });

            $folders = Folder::where('user_id', $user->id)
                ->where('parent_id', null)
                ->get()
                ->map(function ($folder) {
                    $folder->type = 'folder'; // Explicitly mark as folder
                    return $folder;
                });
        } else {
            // Find the folder by path
            $pathSegments = explode('/', trim($path, '/'));
            $folderName = end($pathSegments);

            $currentFolder = Folder::where('user_id', $user->id)
                ->where('name', $folderName)
                ->first();

            if (!$currentFolder) {
                return response()->json(['error' => 'Folder not found'], 404);
            }

            $currentFolderId = $currentFolder->id;
            $files = File::where('folder_id', $currentFolder->id)
                ->get()
                ->map(function ($file) {
                    $file->type = 'file'; // Explicitly mark as file
                    return $file;
                });

            $folders = Folder::where('parent_id', $currentFolder->id)
                ->get()
                ->map(function ($folder) {
                    $folder->type = 'folder'; // Explicitly mark as folder
                    return $folder;
                });
        }

        // Combine files and folders
        $items = $folders->concat($files);

        return response()->json([
            'items' => $items,
            'current_folder_id' => $currentFolderId ?? null
        ]);
    }

    /**
     * Store a new file record
     */
    public function storeFile(Request $request)
    {
        try {
            $validated = $request->validate([
                'name' => 'required|string|max:255',
                'path' => 'required|string|max:1000', // This is now both the display path and S3 key
                'mime_type' => 'required|string|max:255',
                'size' => 'required|integer',
                'folder_id' => 'nullable|exists:folders,id',
            ]);

            // Debug log what we received
            Log::info('File upload request received', $request->all());

            $file = new File();
            $file->user_id = Auth::id();
            $file->folder_id = $validated['folder_id'];
            $file->name = $validated['name'];
            $file->path = $validated['path']; // This is the S3 key
            $file->mime_type = $validated['mime_type'];
            $file->size = $validated['size'];

            $file->save();

            return response()->json($file);
        } catch (\Illuminate\Validation\ValidationException $e) {
            Log::error('File upload validation failed', [
                'errors' => $e->errors(),
                'request' => $request->all()
            ]);
            return response()->json(['message' => 'Validation failed', 'errors' => $e->errors()], 422);
        } catch (\Exception $e) {
            Log::error('File upload failed', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);
            return response()->json(['message' => 'File upload failed: ' . $e->getMessage()], 500);
        }
    }

    /**
     * Store a new folder
     */
    public function storeFolder(Request $request)
    {
        try {
            $validated = $request->validate([
                'name' => 'required|string|max:255',
                'parent_id' => 'nullable|exists:folders,id',
                'parent_path' => 'nullable|string|max:1000'
            ]);

            $user = Auth::user();
            $folder = new Folder();
            $folder->user_id = $user->id;
            $folder->name = $validated['name'];

            // Handle parent folder by path if provided
            if (isset($validated['parent_path']) && $validated['parent_path'] !== '/') {
                // Find the parent folder by path
                $pathSegments = explode('/', trim($validated['parent_path'], '/'));
                $parentFolderName = end($pathSegments);

                $parentFolder = Folder::where('user_id', $user->id)
                    ->where('name', $parentFolderName)
                    ->first();

                if ($parentFolder) {
                    $folder->parent_id = $parentFolder->id;
                }
            } else if (isset($validated['parent_id'])) {
                // Or use directly provided parent_id
                $folder->parent_id = $validated['parent_id'];
            }

            $folder->save();

            return response()->json($folder);
        } catch (\Exception $e) {
            Log::error('Failed to create folder', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);

            return response()->json([
                'message' => 'Failed to create folder: ' . $e->getMessage()
            ], 500);
        }
    }

    /**
     * Get a download URL for a file
     */
    public function download(File $file)
    {
        try {
            // Check if user has access to this file
            if ($file->user_id !== Auth::id()) {
                return response()->json(['error' => 'Unauthorized'], 403);
            }

            // Generate a presigned URL for the file
            $downloadUrl = $file->getPresignedUrl(15); // 15 minutes expiry

            return response()->json([
                'download_url' => $downloadUrl
            ]);
        } catch (\Exception $e) {
            Log::error('File download failed', [
                'error' => $e->getMessage(),
                'file_id' => $file->id,
                'trace' => $e->getTraceAsString()
            ]);

            return response()->json(['error' => 'Failed to generate download URL'], 500);
        }
    }

    /**
     * Delete a file
     */
    public function destroyFile(File $file)
    {
        try {
            // Check if user has access to this file
            if ($file->user_id !== Auth::id()) {
                return response()->json(['error' => 'Unauthorized'], 403);
            }

            // Get the S3 key for deletion later if needed
            $s3Key = $file->path;

            // Delete the file record
            $file->delete();

            // You could also add code here to delete the file from S3
            // using the $s3Key with the S3Capable trait

            return response()->json(['message' => 'File deleted successfully']);
        } catch (\Exception $e) {
            Log::error('File deletion failed', [
                'error' => $e->getMessage(),
                'file_id' => $file->id,
                'trace' => $e->getTraceAsString()
            ]);

            return response()->json(['error' => 'Failed to delete file'], 500);
        }
    }

    /**
     * Delete a folder
     */
    public function destroyFolder(Folder $folder)
    {
        try {
            // Check if user has access to this folder
            if ($folder->user_id !== Auth::id()) {
                return response()->json(['error' => 'Unauthorized'], 403);
            }

            // This will automatically delete all child files and folders
            // because of the cascadeOnDelete constraint in the migration
            $folder->delete();

            return response()->json(['message' => 'Folder deleted successfully']);
        } catch (\Exception $e) {
            Log::error('Folder deletion failed', [
                'error' => $e->getMessage(),
                'folder_id' => $folder->id,
                'trace' => $e->getTraceAsString()
            ]);

            return response()->json(['error' => 'Failed to delete folder'], 500);
        }
    }

}
