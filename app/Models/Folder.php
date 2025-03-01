<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class Folder extends Model
{
    use HasFactory;

    protected $fillable = [
        'user_id',
        'parent_id',
        'name',
        'size',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function parent(): BelongsTo
    {
        return $this->belongsTo(Folder::class, 'parent_id');
    }

    public function children(): HasMany
    {
        return $this->hasMany(Folder::class, 'parent_id');
    }

    public function files(): HasMany
    {
        return $this->hasMany(File::class);
    }

    /**
     * Calculate the total size of this folder (files + subfolders)
     */
    public function calculateSize(): int
    {
        // Sum the size of all files in this folder
        $filesSize = $this->files()->sum('size');
        
        // Sum the size of all child folders
        $childFoldersSize = $this->children()->sum('size');
        
        // Total size is files + subfolders
        return $filesSize + $childFoldersSize;
    }
    
    /**
     * Update the size of this folder and all parent folders
     */
    public function updateSizeRecursive(): void
    {
        try {
            
            // Calculate and update this folder's size
            $newSize = $this->calculateSize();
            $this->size = $newSize;
            $this->save();
            
            // Update all parent folders recursively
            if ($this->parent_id) {
                $this->parent->updateSizeRecursive();
            }
            
        } catch (\Exception $e) {
            Log::error('Failed to update folder size', [
                'folder_id' => $this->id,
                'error' => $e->getMessage()
            ]);
        }
    }
    
    /**
     * Update folder size when a file is added
     */
    public function addFileSize(int $fileSize): void
    {
        try {
            // Update this folder's size
            $this->size += $fileSize;
            $this->save();
            
            // Update all parent folders recursively
            if ($this->parent_id) {
                $this->parent->addFileSize($fileSize);
            }
            
        } catch (\Exception $e) {
            Log::error('Failed to add file size to folder', [
                'folder_id' => $this->id,
                'file_size' => $fileSize,
                'error' => $e->getMessage()
            ]);
        }
    }
    
    /**
     * Update folder size when a file is removed
     */
    public function removeFileSize(int $fileSize): void
    {
        try {
            
            // Update this folder's size (prevent negative sizes)
            $this->size = max(0, $this->size - $fileSize);
            $this->save();
            
            // Update all parent folders recursively
            if ($this->parent_id) {
                $this->parent->removeFileSize($fileSize);
            }
            
        } catch (\Exception $e) {
            Log::error('Failed to remove file size from folder', [
                'folder_id' => $this->id,
                'file_size' => $fileSize,
                'error' => $e->getMessage()
            ]);
        }
    }
}