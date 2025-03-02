<?php

namespace App\Http\Controllers;

use App\Models\Folder;
use Illuminate\Database\Eloquent\Model;

class FolderSyncController extends SyncableController
{
    protected $modelClass = Folder::class;
    
    /**
     * Format an item for sync response
     */
    protected function formatItemForSync(Model $item)
    {
        $data = parent::formatItemForSync($item);
        
        // Add type property to ensure consistent type identification
        $data['type'] = 'folder';
        
        // Calculate folder path for proper navigation
        $path = $this->calculateFolderPath($item);
        $data['path'] = $path;
        
        return $data;
    }
    
    /**
     * Calculate the full path for a folder
     */
    private function calculateFolderPath(Folder $folder)
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
}