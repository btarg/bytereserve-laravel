<?php

namespace App\Http\Controllers;

use App\Models\File;
use Illuminate\Database\Eloquent\Model;

class FileSyncController extends SyncableController
{
    protected $modelClass = File::class;
    
    /**
     * Format an item for sync response
     */
    protected function formatItemForSync(Model $item)
    {
        $data = parent::formatItemForSync($item);
        
        // Add type property to ensure consistent type identification
        $data['type'] = 'file';
        
        return $data;
    }
}