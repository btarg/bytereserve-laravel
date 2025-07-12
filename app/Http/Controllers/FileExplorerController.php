<?php

namespace App\Http\Controllers;

use App\Models\File;
use App\Models\Folder;
use App\Models\FileShare;
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
                ->valid() // Only include non-expired files
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
                ->valid() // Only include non-expired files
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
     * Store a new file record, update folder sizes, and invalidate cache
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
                'hash' => 'required|string|max:64',
                'expires_at' => 'nullable|date|after:now',
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
            $file->hash = $validated['hash'];
            $file->expires_at = $validated['expires_at'] ?? null;
            $file->save();

            // Update the folder size if this file is in a folder
            if ($validated['folder_id']) {
                $folder = Folder::find($validated['folder_id']);
                if ($folder) {
                    $folder->addFileSize($validated['size']);
                }
            }

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
     * Store a new folder and update parent folder sizes
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
            $folder->size = 0; // New folders start with size 0
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

            // Always generate a fresh presigned URL (no caching)
            // This ensures we never serve expired URLs
            $cacheMinutes = (int)env('PRESIGNED_URL_CACHE_MINUTES', 15);
            $downloadUrl = $file->getPresignedUrl($cacheMinutes);

            return response()->json([
                'download_url' => $downloadUrl,
                'name' => $file->name
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
     * Delete a file, update folder sizes, and invalidate cache
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
            $fileSize = $file->size;

            // Get the folder reference if it exists
            $folder = $folderId ? Folder::find($folderId) : null;

            // Get the S3 key for deletion later if needed
            $s3Key = $file->path;

            // Delete the file record
            $file->delete();

            // Update folder size if the file was in a folder
            if ($folder) {
                $folder->removeFileSize($fileSize);
            }

            // Invalidate relevant caches
            $this->invalidateExplorerCache('/');
            if ($folderId) {
                $this->invalidateFolderCache($folderId);
            }

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
     * Delete a folder and update parent folder sizes
     */
    public function destroyFolder(Folder $folder)
    {
        try {
            // Check if user has access to this folder
            if ($folder->user_id !== Auth::id()) {
                return response()->json(['error' => 'Unauthorized'], 403);
            }

            // Store parent ID for cache invalidation and size updates
            $parentId = $folder->parent_id;
            $parentFolder = $parentId ? Folder::find($parentId) : null;
            $folderSize = $folder->size;

            // Recursively gather all folder IDs to invalidate their caches
            $folderIds = $this->getAllFolderIds($folder);

            // Get all file IDs within these folders to invalidate download caches
            $fileIds = File::whereIn('folder_id', $folderIds)->pluck('id')->toArray();

            // This will automatically delete all child files and folders
            // because of the cascadeOnDelete constraint in the migration
            $folder->delete();

            // Update parent folder size if it exists
            if ($parentFolder) {
                $parentFolder->removeFileSize($folderSize);
            }

            // Invalidate all related caches
            foreach ($folderIds as $folderId) {
                $this->invalidateFolderCache($folderId);
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
     * Create a share link for a file
     */
    public function shareFile(Request $request, File $file)
    {
        try {
            // Check if user has access to this file
            if ($file->user_id !== Auth::id()) {
                return response()->json(['error' => 'Unauthorized'], 403);
            }

            // Validate request
            $validated = $request->validate([
                'expires_at' => 'nullable|date|after:now',
                'max_downloads' => 'nullable|integer|min:1'
            ]);

            // Create new share (always create new for different expiration settings)
            $shareData = [
                'file_id' => $file->id,
                'user_id' => Auth::id(),
                'token' => FileShare::generateToken(),
                'is_active' => true,
            ];

            // Add expiration if provided
            if (isset($validated['expires_at'])) {
                $shareData['expires_at'] = $validated['expires_at'];
            }

            // Add download limit if provided
            if (isset($validated['max_downloads'])) {
                $shareData['max_downloads'] = $validated['max_downloads'];
            }

            $share = FileShare::create($shareData);

            return response()->json([
                'share_token' => $share->token,
                'share_url' => route('share.show', $share->token),
                'file_name' => $file->name,
                'expires_at' => $share->expires_at?->toISOString(),
                'max_downloads' => $share->max_downloads
            ]);
        } catch (\Exception $e) {
            Log::error('File share creation failed', [
                'error' => $e->getMessage(),
                'file_id' => $file->id,
                'trace' => $e->getTraceAsString()
            ]);

            return response()->json(['error' => 'Failed to create share link'], 500);
        }
    }

    /**
     * Show the shared file download page
     */
    public function showSharedFile($token)
    {
        $share = FileShare::where('token', $token)->with('file')->first();
        
        if (!$share || !$share->isValid()) {
            return response()->view('errors.404', [], 404);
        }

        return inertia('SharedFile', [
            'share_token' => $token,
            'file_name' => $share->file->name,
            'file_size' => $share->file->size,
            'mime_type' => $share->file->mime_type
        ]);
    }

    /**
     * Download a shared file
     */
    public function downloadSharedFile($token)
    {
        try {
            $share = FileShare::where('token', $token)->with('file')->first();
            
            if (!$share || !$share->isValid()) {
                return response()->json(['error' => 'Share link not found or expired'], 404);
            }

            $file = $share->file;
            
            // Generate presigned URL
            $cacheMinutes = (int)env('PRESIGNED_URL_CACHE_MINUTES', 15);
            $downloadUrl = $file->getPresignedUrl($cacheMinutes);

            // Increment download count
            $share->incrementDownloadCount();

            return response()->json([
                'download_url' => $downloadUrl,
                'name' => $file->name
            ]);
        } catch (\Exception $e) {
            Log::error('Shared file download failed', [
                'error' => $e->getMessage(),
                'token' => $token,
                'trace' => $e->getTraceAsString()
            ]);

            return response()->json(['error' => 'Failed to generate download URL'], 500);
        }
    }

    /**
     * Get preview URL for a shared file
     */
    public function getSharedFilePreviewUrl($token)
    {
        try {
            $share = FileShare::where('token', $token)->with('file')->first();
            
            if (!$share || !$share->isValid()) {
                return response()->json(['error' => 'Share link not found or expired'], 404);
            }

            $file = $share->file;
            
            // Generate presigned URL for preview (inline display)
            $cacheMinutes = (int)env('PRESIGNED_URL_CACHE_MINUTES', 15);
            $previewUrl = $file->getPreviewUrl($cacheMinutes);

            return response()->json([
                'preview_url' => $previewUrl,
                'name' => $file->name
            ]);
        } catch (\Exception $e) {
            Log::error('Shared file preview URL failed', [
                'error' => $e->getMessage(),
                'token' => $token,
                'trace' => $e->getTraceAsString()
            ]);

            return response()->json(['error' => 'Failed to generate preview URL'], 500);
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
