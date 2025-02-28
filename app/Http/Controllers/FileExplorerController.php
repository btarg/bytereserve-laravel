<?php

namespace App\Http\Controllers;

use App\Models\File;
use App\Models\Folder;
use App\Traits\S3Capable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Cache;

class FileExplorerController extends Controller
{
    use S3Capable;

    /**
     * Cache TTL in seconds
     */
    protected $cacheTtl = 300; // 5 minutes

    /**
     * Get files and folders for the explorer with caching
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
     * Store a new file record and invalidate cache
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

            // Invalidate cache for both the root folder and the folder this file was added to
            $this->invalidateExplorerCache('/');
            if ($validated['folder_id']) {
                $this->invalidateFolderCache($validated['folder_id']);
            }

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
     * Store a new folder and invalidate cache
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
            $parentId = null;

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
                    $parentId = $parentFolder->id;
                }
            } else if (isset($validated['parent_id'])) {
                // Or use directly provided parent_id
                $folder->parent_id = $validated['parent_id'];
                $parentId = $validated['parent_id'];
            }

            $folder->save();

            // Invalidate cache for both the root folder and the parent folder
            $this->invalidateExplorerCache('/');
            if ($parentId) {
                $this->invalidateFolderCache($parentId);
            }

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

            // Cache the download URL for this file
            $cacheKey = "file_download_{$file->id}";

            return Cache::remember($cacheKey, now()->addMinutes(5), function () use ($file) {
                // Generate a presigned URL for the file
                $downloadUrl = $file->getPresignedUrl(15); // 15 minutes expiry

                return response()->json([
                    'download_url' => $downloadUrl,
                    'name' => $file->name
                ]);
            });
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
     * Delete a file and invalidate cache
     */
    public function destroyFile(File $file)
    {
        try {
            // Check if user has access to this file
            if ($file->user_id !== Auth::id()) {
                return response()->json(['error' => 'Unauthorized'], 403);
            }

            // Get the folder ID before deleting the file
            $folderId = $file->folder_id;

            // Get the S3 key for deletion later if needed
            $s3Key = $file->path;

            // Delete the file record
            $file->delete();

            // Invalidate relevant caches
            $this->invalidateExplorerCache('/');
            if ($folderId) {
                $this->invalidateFolderCache($folderId);
            }
            Cache::forget("file_download_{$file->id}");

            // Delete from S3
            $s3Client = $this->getS3Client();
            if ($s3Client) {
                $s3Client->deleteObject([
                    'Bucket' => $this->getS3Bucket(),
                    'Key' => $s3Key
                ]);
            }



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
     * Delete a folder and invalidate cache
     */
    public function destroyFolder(Folder $folder)
    {
        try {
            // Check if user has access to this folder
            if ($folder->user_id !== Auth::id()) {
                return response()->json(['error' => 'Unauthorized'], 403);
            }

            // Store parent ID for cache invalidation
            $parentId = $folder->parent_id;

            // Recursively gather all folder IDs to invalidate their caches
            $folderIds = $this->getAllFolderIds($folder);

            // Get all file IDs within these folders to invalidate download caches
            $fileIds = File::whereIn('folder_id', $folderIds)->pluck('id')->toArray();

            // This will automatically delete all child files and folders
            // because of the cascadeOnDelete constraint in the migration
            $folder->delete();

            // Invalidate all related caches
            foreach ($folderIds as $folderId) {
                $this->invalidateFolderCache($folderId);
            }

            foreach ($fileIds as $fileId) {
                Cache::forget("file_download_{$fileId}");
            }

            $this->invalidateExplorerCache('/');
            if ($parentId) {
                $this->invalidateFolderCache($parentId);
            }

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

    /**
     * Helper method to invalidate explorer cache for a path
     */
    private function invalidateExplorerCache($path)
    {
        $userId = Auth::id();
        $cacheKey = "explorer_{$userId}_" . md5($path);
        Cache::forget($cacheKey);
    }

    /**
     * Helper method to invalidate cache for a specific folder
     */
    private function invalidateFolderCache($folderId)
    {
        $folder = Folder::find($folderId);
        if (!$folder) return;

        // Construct the path for this folder
        $path = $this->getFolderPath($folder);
        $this->invalidateExplorerCache($path);
    }

    /**
     * Get the full path string for a folder
     */
    private function getFolderPath(Folder $folder)
    {
        if (!$folder->parent_id) {
            return '/' . $folder->name;
        }

        $path = $folder->name;
        $parent = $folder->parent;

        while ($parent) {
            $path = $parent->name . '/' . $path;
            $parent = $parent->parent;
        }

        return '/' . $path;
    }

    /**
     * Recursively get all folder IDs (current folder and all descendants)
     */
    private function getAllFolderIds(Folder $folder)
    {
        $ids = [$folder->id];

        foreach ($folder->children as $child) {
            $ids = array_merge($ids, $this->getAllFolderIds($child));
        }

        return $ids;
    }
}
