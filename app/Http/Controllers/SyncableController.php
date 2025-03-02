<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Database\Eloquent\Model;

abstract class SyncableController extends Controller
{
    /**
     * The model class to use
     */
    protected $modelClass;

    /**
     * Sync changes since a timestamp
     */
    public function sync(Request $request)
    {
        $since = $request->input('since', 0);
        $timestamp = (int)$since;

        // Get model instance
        $model = new $this->modelClass;

        // Get items changed since last sync
        $items = $model::where('updated_at', '>', date('Y-m-d H:i:s', $timestamp / 1000))
            ->get()
            ->map(function ($item) {
                return $this->formatItemForSync($item);
            });

        // Include soft deleted items if model uses SoftDeletes
        if (in_array('Illuminate\Database\Eloquent\SoftDeletes', class_uses($this->modelClass))) {
            $deletedItems = $model::onlyTrashed()
                ->where('deleted_at', '>', date('Y-m-d H:i:s', $timestamp / 1000))
                ->get()
                ->map(function ($item) {
                    return [
                        'id' => $item->id,
                        'deleted' => true
                    ];
                });

            $items = $items->merge($deletedItems);
        }

        return response()->json([
            'items' => $items,
            'timestamp' => now()->timestamp * 1000 // Current timestamp in milliseconds
        ]);
    }

    /**
     * Format an item for sync response
     */
    protected function formatItemForSync(Model $item)
    {
        $data = $item->toArray();

        // Convert timestamps to milliseconds for JavaScript
        if (isset($data['created_at'])) {
            $data['created_at'] = strtotime($data['created_at']) * 1000;
        }

        if (isset($data['updated_at'])) {
            $data['updated_at'] = strtotime($data['updated_at']) * 1000;
        }

        return $data;
    }
}
